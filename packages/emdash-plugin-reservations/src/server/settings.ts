import type { PluginContext } from "emdash";
import { DEFAULT_SETTINGS, type ReservationSettings } from "./model";

const SETTINGS_KEYS = [
	"enabled",
	"colorFree",
	"colorReserved",
	"colorPending",
	"colorClosed",
	"openingTime",
	"closingTime",
	"activeDays",
	"maxDaysAhead",
	"autoConfirm",
	"captchaPluginId",
	"notifyEnabled",
	"notifyEmail",
] as const;

function parseActiveDays(raw: string | null): number[] | null {
	if (!raw) return null;
	const days = raw
		.split(",")
		.map((d) => Number(d.trim()))
		.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
	return days.length > 0 ? days : null;
}

export async function loadSettings(ctx: PluginContext): Promise<ReservationSettings> {
	const values = await Promise.all(SETTINGS_KEYS.map((key) => ctx.kv.get<unknown>(`settings:${key}`)));
	const raw = Object.fromEntries(SETTINGS_KEYS.map((key, i) => [key, values[i]])) as Record<
		(typeof SETTINGS_KEYS)[number],
		unknown
	>;

	const settings: ReservationSettings = {
		enabled: (raw.enabled as boolean | null) ?? DEFAULT_SETTINGS.enabled,
		colorFree: (raw.colorFree as string | null) ?? DEFAULT_SETTINGS.colorFree,
		colorReserved: (raw.colorReserved as string | null) ?? DEFAULT_SETTINGS.colorReserved,
		colorPending: (raw.colorPending as string | null) ?? DEFAULT_SETTINGS.colorPending,
		colorClosed: (raw.colorClosed as string | null) ?? DEFAULT_SETTINGS.colorClosed,
		openingTime: (raw.openingTime as string | null) ?? DEFAULT_SETTINGS.openingTime,
		closingTime: (raw.closingTime as string | null) ?? DEFAULT_SETTINGS.closingTime,
		activeDays: parseActiveDays(raw.activeDays as string | null) ?? DEFAULT_SETTINGS.activeDays,
		maxDaysAhead: (raw.maxDaysAhead as number | null) ?? DEFAULT_SETTINGS.maxDaysAhead,
		autoConfirm: (raw.autoConfirm as boolean | null) ?? DEFAULT_SETTINGS.autoConfirm,
		captchaPluginId: (raw.captchaPluginId as string | null) ?? DEFAULT_SETTINGS.captchaPluginId,
		notifyEnabled: (raw.notifyEnabled as boolean | null) ?? DEFAULT_SETTINGS.notifyEnabled,
		notifyEmail: (raw.notifyEmail as string | null) ?? DEFAULT_SETTINGS.notifyEmail,
	};

	if (settings.openingTime >= settings.closingTime) {
		ctx.log.warn("reservations: openingTime >= closingTime in settings, falling back to defaults");
		settings.openingTime = DEFAULT_SETTINGS.openingTime;
		settings.closingTime = DEFAULT_SETTINGS.closingTime;
	}

	return settings;
}

/** Persists a partial settings update (admin API, NATIVE_PLAN N2) and returns the
 * resulting settings. Only provided keys are written; `activeDays` is joined the same
 * way `persistDefaultSettings` stores it. */
export async function saveSettings(ctx: PluginContext, patch: Partial<ReservationSettings>): Promise<ReservationSettings> {
	const entries = Object.entries(patch) as [keyof ReservationSettings, ReservationSettings[keyof ReservationSettings]][];
	await Promise.all(
		entries
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => {
				const stored = key === "activeDays" ? (value as number[]).join(",") : value;
				return ctx.kv.set(`settings:${key}`, stored);
			}),
	);
	return loadSettings(ctx);
}

export async function persistDefaultSettings(ctx: PluginContext): Promise<void> {
	await Promise.all([
		ctx.kv.set("settings:enabled", DEFAULT_SETTINGS.enabled),
		ctx.kv.set("settings:colorFree", DEFAULT_SETTINGS.colorFree),
		ctx.kv.set("settings:colorReserved", DEFAULT_SETTINGS.colorReserved),
		ctx.kv.set("settings:colorPending", DEFAULT_SETTINGS.colorPending),
		ctx.kv.set("settings:colorClosed", DEFAULT_SETTINGS.colorClosed),
		ctx.kv.set("settings:openingTime", DEFAULT_SETTINGS.openingTime),
		ctx.kv.set("settings:closingTime", DEFAULT_SETTINGS.closingTime),
		ctx.kv.set("settings:activeDays", DEFAULT_SETTINGS.activeDays.join(",")),
		ctx.kv.set("settings:maxDaysAhead", DEFAULT_SETTINGS.maxDaysAhead),
		ctx.kv.set("settings:autoConfirm", DEFAULT_SETTINGS.autoConfirm),
		ctx.kv.set("settings:captchaPluginId", DEFAULT_SETTINGS.captchaPluginId),
		ctx.kv.set("settings:notifyEnabled", DEFAULT_SETTINGS.notifyEnabled),
		ctx.kv.set("settings:notifyEmail", DEFAULT_SETTINGS.notifyEmail),
	]);
}
