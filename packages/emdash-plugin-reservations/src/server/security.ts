import type { PluginContext } from "emdash";

const CSRF_TOKEN_TTL_MS = 15 * 60 * 1000;

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Generates a fresh CSRF signing secret. */
export function generateCsrfSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

/** Get-or-create the plugin's CSRF secret from KV. `plugin:install` seeds it up front,
 * but this install hook is only observed to fire for marketplace/sandboxed installs in
 * this emdash version -- not reliably for config-declared (`plugins: []`) trusted
 * plugins like this one. Lazily creating it here on first use makes CSRF issuance work
 * regardless of whether the install hook ran. */
export async function getOrCreateCsrfSecret(ctx: PluginContext): Promise<string> {
	const existing = await ctx.kv.get<string>("state:csrfSecret");
	if (existing) return existing;
	const secret = generateCsrfSecret();
	await ctx.kv.set("state:csrfSecret", secret);
	return secret;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export interface CsrfTokenPayload {
	iat: number;
	exp: number;
	nonce: string;
}

/** Stateless signed CSRF token: base64url(payload) + "." + HMAC-SHA256(payload, secret). */
export async function issueCsrfToken(secret: string): Promise<{ token: string; expiresAt: number }> {
	const nonce = crypto.randomUUID();
	const iat = Date.now();
	const exp = iat + CSRF_TOKEN_TTL_MS;
	const payload: CsrfTokenPayload = { iat, exp, nonce };
	const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
	const key = await importHmacKey(secret);
	const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
	const token = `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
	return { token, expiresAt: exp };
}

export async function verifyCsrfToken(secret: string, token: string): Promise<boolean> {
	const parts = token.split(".");
	if (parts.length !== 2) return false;
	const [payloadPart, signaturePart] = parts;
	if (!payloadPart || !signaturePart) return false;

	let payload: CsrfTokenPayload;
	try {
		payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
	} catch {
		return false;
	}
	if (typeof payload.exp !== "number" || Date.now() > payload.exp) return false;

	const key = await importHmacKey(secret);
	const expectedSignature = fromBase64Url(signaturePart);
	const payloadBytes = fromBase64Url(payloadPart);
	return crypto.subtle.verify("HMAC", key, expectedSignature, payloadBytes);
}

/** SHA-256(ip + secret) -- never store raw IPs. */
export async function hashIp(ip: string, secret: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}:${secret}`));
	return toBase64Url(new Uint8Array(digest));
}

export interface RateLimitResult {
	allowed: boolean;
}

export const RESERVE_RATE_LIMIT = { perMinute: 5, perHour: 20 };

/** Per-IP minute + hour bucket counters in KV. Best-effort cleanup: buckets carry the
 * time window in their key, so stale ones just age out without needing a sweep job. */
export async function checkRateLimit(
	ctx: PluginContext,
	ipHash: string,
	limits: { perMinute: number; perHour: number },
): Promise<RateLimitResult> {
	const now = Date.now();
	const minuteBucket = Math.floor(now / 60_000);
	const hourBucket = Math.floor(now / 3_600_000);

	const minuteKey = `state:rl:${ipHash}:m:${minuteBucket}`;
	const hourKey = `state:rl:${ipHash}:h:${hourBucket}`;

	const [minuteCount, hourCount] = await Promise.all([
		ctx.kv.get<number>(minuteKey),
		ctx.kv.get<number>(hourKey),
	]);

	const nextMinuteCount = (minuteCount ?? 0) + 1;
	const nextHourCount = (hourCount ?? 0) + 1;

	if (nextMinuteCount > limits.perMinute || nextHourCount > limits.perHour) {
		return { allowed: false };
	}

	await Promise.all([ctx.kv.set(minuteKey, nextMinuteCount), ctx.kv.set(hourKey, nextHourCount)]);
	return { allowed: true };
}

/** Delegates captcha verification to a separately installed captcha plugin's verify route
 * (SPEC §10). Empty `captchaPluginId` means captcha is off -- pass. An installed but
 * unreachable/misconfigured captcha plugin fails closed rather than silently letting
 * everything through. */
export async function verifyCaptchaViaPlugin(
	ctx: PluginContext,
	captchaPluginId: string,
	captchaToken: string | undefined,
	remoteIpHash: string,
): Promise<boolean> {
	if (!captchaPluginId) return true;
	if (!captchaToken) return false;

	try {
		const verifyUrl = ctx.url(`/_emdash/api/plugins/${captchaPluginId}/verify`);
		const response = await fetch(verifyUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: captchaToken, remoteIpHash }),
		});
		if (!response.ok) {
			ctx.log.warn("reservations: captcha verify route returned non-OK status", {
				status: response.status,
			});
			return false;
		}
		// Plugin routes are wrapped in `{ data: <handler return value> }` by the host.
		const body = (await response.json()) as { data?: { ok?: boolean } };
		return body.data?.ok === true;
	} catch (error) {
		ctx.log.warn("reservations: captcha verify call failed", { error: String(error) });
		return false;
	}
}
