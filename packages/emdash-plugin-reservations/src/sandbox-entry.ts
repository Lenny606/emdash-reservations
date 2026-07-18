import { PluginRouteError, ulid, type PluginContext, type StorageCollection } from "emdash";
import type { SandboxedPlugin } from "emdash/plugin";
import type { Block, BlockInteraction, BlockResponse } from "@emdash-cms/blocks";
import {
	AvailabilityQueryDto,
	CreateReservationDto,
	type AvailabilityResponseDto,
	type ReserveResponseDto,
	type SlotDto,
	type SlotStatus,
} from "./shared/dto";
import { addDays, generateWeekSlots, isValidDate, mondayOf, parseSlotKey } from "./shared/slots";
import type { Reservation, ReservationSettings } from "./server/model";
import { toReservation, toSlotDto, toListItemDto, type ReservationMeta } from "./server/mappers";
import { loadSettings, persistDefaultSettings } from "./server/settings";
import { sanitizeText, validateReservationRequest } from "./server/validation";
import { notifyNewReservation, notifyStatusChange } from "./server/notifications";
import {
	buildOverviewBlocks,
	buildPendingListBlocks,
	buildReservationsTableBlocks,
	buildSettingsFormBlocks,
} from "./server/admin-ui";
import {
	RESERVE_RATE_LIMIT,
	checkRateLimit,
	generateCsrfSecret,
	getOrCreateCsrfSecret,
	hashIp,
	issueCsrfToken,
	verifyCaptchaViaPlugin,
	verifyCsrfToken,
} from "./server/security";

interface NormalizedRequestMeta {
	ip: string | null;
	userAgent: string | null;
}

function readRequestMeta(requestMeta: unknown): NormalizedRequestMeta {
	const meta = requestMeta as Partial<NormalizedRequestMeta> | undefined;
	return { ip: meta?.ip ?? null, userAgent: meta?.userAgent ?? null };
}

export default {
	hooks: {
		"plugin:install": {
			handler: async (_event, ctx) => {
				await ctx.kv.set("state:csrfSecret", generateCsrfSecret());
				await persistDefaultSettings(ctx);
				ctx.log.info("reservations: plugin installed, defaults persisted");
			},
		},
		"plugin:activate": {
			handler: async (_event, ctx) => {
				ctx.log.info("reservations: plugin activated");
			},
		},
		"plugin:deactivate": {
			handler: async (_event, ctx) => {
				ctx.log.info("reservations: plugin deactivated");
			},
		},
		"plugin:uninstall": {
			handler: async (event, ctx) => {
				if (!event.deleteData) return;
				const [reservations, history] = await Promise.all([
					ctx.storage.reservations.query({ limit: 1000 }),
					ctx.storage.reservations_history.query({ limit: 1000 }),
				]);
				await Promise.all([
					ctx.storage.reservations.deleteMany(reservations.items.map((item) => item.id)),
					ctx.storage.reservations_history.deleteMany(history.items.map((item) => item.id)),
				]);
				for (const entry of await ctx.kv.list()) {
					await ctx.kv.delete(entry.key);
				}
				ctx.log.info("reservations: plugin data deleted on uninstall");
			},
		},
	},

	routes: {
		"public/csrf": {
			public: true,
			handler: async (_routeCtx, ctx) => {
				const secret = await getOrCreateCsrfSecret(ctx);
				return issueCsrfToken(secret);
			},
		},

		"public/availability": {
			public: true,
			// GET requests never reach the framework's JSON-body `input` validation in this
			// emdash version (the dispatcher only parses a JSON body, so query params aren't
			// picked up) -- parse and validate the query string ourselves instead.
			handler: async (routeCtx, ctx) => {
				const url = new URL(routeCtx.request.url);
				const parsed = AvailabilityQueryDto.safeParse({ weekStart: url.searchParams.get("weekStart") });
				if (!parsed.success) {
					throw PluginRouteError.badRequest("weekStart is required, as YYYY-MM-DD");
				}
				const { weekStart } = parsed.data;
				if (!isValidDate(weekStart) || mondayOf(weekStart) !== weekStart) {
					throw PluginRouteError.badRequest("weekStart must be the Monday of a week, as YYYY-MM-DD");
				}

				const settings = await loadSettings(ctx);
				const now = new Date();
				const weekEnd = addDays(weekStart, 6);
				// Same horizon computation as validateReservationRequest, so slots the server
				// would reject as beyond_max_days_ahead never render as bookable.
				const maxDate = new Date(now);
				maxDate.setDate(maxDate.getDate() + settings.maxDaysAhead);

				const reservationsCollection = ctx.storage.reservations as StorageCollection<Reservation>;
				const weekReservations = await reservationsCollection.query({
					where: { date: { gte: weekStart, lte: weekEnd } },
					limit: 500,
				});
				const bySlotKey = new Map(weekReservations.items.map((item) => [item.id, item.data]));

				const generated = generateWeekSlots(weekStart, settings);
				const slots: SlotDto[] = generated.map((slot) => {
					let status: SlotStatus;
					if (!settings.enabled) {
						status = "closed";
					} else {
						const slotDateTime = new Date(`${slot.date}T${slot.startTime}:00`);
						if (slotDateTime.getTime() < now.getTime()) {
							status = "past";
						} else if (slotDateTime.getTime() > maxDate.getTime()) {
							status = "closed";
						} else {
							const reservation = bySlotKey.get(slot.slotKey);
							status = reservation ? (reservation.status === "pending" ? "pending" : "reserved") : "free";
						}
					}
					return toSlotDto(slot.slotKey, slot.date, slot.startTime, status);
				});

				const days = Array.from({ length: 7 }, (_, i) => ({
					date: addDays(weekStart, i),
					dayOfWeek: i + 1,
				}));

				const response: AvailabilityResponseDto = {
					weekStart,
					days,
					slots,
					config: {
						openingTime: settings.openingTime,
						closingTime: settings.closingTime,
						activeDays: settings.activeDays,
						maxDaysAhead: settings.maxDaysAhead,
						colors: {
							free: settings.colorFree,
							reserved: settings.colorReserved,
							pending: settings.colorPending,
							closed: settings.colorClosed,
						},
					},
					captchaRequired: settings.captchaPluginId !== "",
					enabled: settings.enabled,
				};
				return response;
			},
		},

		"public/reserve": {
			public: true,
			input: CreateReservationDto,
			handler: async (routeCtx, ctx): Promise<ReserveResponseDto> => {
				const dto = routeCtx.input as CreateReservationDto;
				const settings = await loadSettings(ctx);

				if (!settings.enabled) {
					return { ok: false, code: "disabled", message: "Reservations are currently unavailable." };
				}

				// Honeypot: silent fake success. Never reveal detection to the caller.
				if (dto.website !== "") {
					ctx.log.warn("reservations: honeypot field filled in, discarding request silently");
					const { date, time } = parseSlotKey(dto.slotKey);
					return {
						ok: true,
						reservationId: dto.slotKey,
						slot: toSlotDto(dto.slotKey, date, time, settings.autoConfirm ? "reserved" : "pending"),
					};
				}

				const requestMeta = readRequestMeta(routeCtx.requestMeta);
				const csrfSecret = await getOrCreateCsrfSecret(ctx);
				const ipHash = await hashIp(requestMeta.ip ?? "unknown", csrfSecret);

				const rateLimit = await checkRateLimit(ctx, ipHash, RESERVE_RATE_LIMIT);
				if (!rateLimit.allowed) {
					return { ok: false, code: "rate_limited", message: "Too many requests, please try again later." };
				}

				const csrfValid = await verifyCsrfToken(csrfSecret, dto.csrfToken);
				if (!csrfValid) {
					return {
						ok: false,
						code: "invalid_csrf",
						message: "Invalid or expired security token, please reload the page.",
					};
				}

				const captchaOk = await verifyCaptchaViaPlugin(ctx, settings.captchaPluginId, dto.captchaToken, ipHash);
				if (!captchaOk) {
					return { ok: false, code: "captcha_failed", message: "Bot verification failed." };
				}

				const sanitizedDto: CreateReservationDto = {
					...dto,
					name: sanitizeText(dto.name, 200),
					email: dto.email.trim().toLowerCase(),
					phone: dto.phone ? sanitizeText(dto.phone, 50) : undefined,
					note: dto.note ? sanitizeText(dto.note, 1000) : undefined,
				};

				const now = new Date();
				const validation = validateReservationRequest(sanitizedDto.slotKey, settings, now);
				if (!validation.ok) {
					return { ok: false, code: "validation_error", message: `That slot can't be booked (${validation.reason}).` };
				}

				const reservationsCollection = ctx.storage.reservations as StorageCollection<Reservation>;
				const alreadyExists = await reservationsCollection.exists(sanitizedDto.slotKey);
				if (alreadyExists) {
					return { ok: false, code: "slot_taken", message: "That slot is already booked." };
				}

				const requestNonce = crypto.randomUUID();
				const status = settings.autoConfirm ? "confirmed" : "pending";
				const meta: ReservationMeta = { ipHash, userAgent: requestMeta.userAgent ?? undefined, requestNonce };
				const reservation = toReservation(sanitizedDto, meta, now.toISOString(), status);

				await reservationsCollection.put(sanitizedDto.slotKey, reservation);
				const verify = await reservationsCollection.get(sanitizedDto.slotKey);
				if (!verify || verify.meta.requestNonce !== requestNonce) {
					return { ok: false, code: "slot_taken", message: "That slot was just booked by someone else." };
				}

				notifyNewReservation(ctx, settings, reservation);

				return {
					ok: true,
					reservationId: reservation.id,
					slot: toSlotDto(reservation.slotKey, reservation.date, reservation.startTime, status === "pending" ? "pending" : "reserved"),
				};
			},
		},

		admin: {
			handler: async (routeCtx, ctx): Promise<BlockResponse> => {
				const interaction = routeCtx.input as BlockInteraction;
				const settings = await loadSettings(ctx);

				if (interaction.type === "form_submit" && interaction.action_id === "save_settings") {
					await saveSettingsFromForm(ctx, interaction.values);
					return {
						blocks: await buildAdminPageBlocks(ctx, await loadSettings(ctx)),
						toast: { message: "Settings saved", type: "success" },
					};
				}

				if (interaction.type === "block_action" && interaction.action_id === "confirm") {
					const changed = await confirmReservation(ctx, String(interaction.value ?? ""), settings);
					return {
						blocks: await buildAdminPageBlocks(ctx, settings),
						toast: changed
							? { message: "Reservation confirmed", type: "success" }
							: { message: "Reservation not found", type: "error" },
					};
				}

				if (interaction.type === "block_action" && interaction.action_id === "cancel") {
					const changed = await cancelReservation(ctx, String(interaction.value ?? ""), settings);
					return {
						blocks: await buildAdminPageBlocks(ctx, settings),
						toast: changed
							? { message: "Reservation cancelled", type: "success" }
							: { message: "Reservation not found", type: "error" },
					};
				}

				// page_load, or any interaction we don't recognize: render the current state.
				return { blocks: await buildAdminPageBlocks(ctx, settings) };
			},
		},
	},
} satisfies SandboxedPlugin;

async function buildAdminPageBlocks(ctx: PluginContext, settings: ReservationSettings): Promise<Block[]> {
	const reservations = ctx.storage.reservations as StorageCollection<Reservation>;
	const history = ctx.storage.reservations_history as StorageCollection<Reservation>;

	const weekStart = mondayOf(new Date().toISOString().slice(0, 10));
	const weekEnd = addDays(weekStart, 6);

	const [thisWeek, pending, confirmed, cancelled, pendingResult, recentResult] = await Promise.all([
		reservations.count({ date: { gte: weekStart, lte: weekEnd } }),
		reservations.count({ status: "pending" }),
		reservations.count({ status: "confirmed" }),
		history.count({ status: "cancelled" }),
		reservations.query({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, limit: 20 }),
		reservations.query({ orderBy: { createdAt: "desc" }, limit: 50 }),
	]);

	const pendingItems = pendingResult.items.map((item) => toListItemDto(item.id, item.data));
	const recentItems = recentResult.items.map((item) => toListItemDto(item.id, item.data));

	return [
		...buildSettingsFormBlocks(settings),
		...buildOverviewBlocks({ thisWeek, pending, confirmed, cancelled }),
		...buildPendingListBlocks(pendingItems),
		...buildReservationsTableBlocks(recentItems),
	];
}

const SETTINGS_FORM_KEYS = [
	"enabled",
	"openingTime",
	"closingTime",
	"activeDays",
	"maxDaysAhead",
	"autoConfirm",
	"colorFree",
	"colorReserved",
	"colorPending",
	"colorClosed",
	"captchaPluginId",
	"notifyEnabled",
	"notifyEmail",
] as const;

async function saveSettingsFromForm(ctx: PluginContext, values: Record<string, unknown>): Promise<void> {
	await Promise.all(
		SETTINGS_FORM_KEYS.map(async (key) => {
			const value = values[key];
			if (value !== undefined) await ctx.kv.set(`settings:${key}`, value);
		}),
	);
}

async function confirmReservation(ctx: PluginContext, slotKey: string, settings: ReservationSettings): Promise<boolean> {
	if (!slotKey) return false;
	const reservations = ctx.storage.reservations as StorageCollection<Reservation>;
	const existing = await reservations.get(slotKey);
	if (!existing || existing.status !== "pending") return false;
	const updated: Reservation = { ...existing, status: "confirmed", updatedAt: new Date().toISOString() };
	await reservations.put(slotKey, updated);
	notifyStatusChange(ctx, settings, updated);
	return true;
}

async function cancelReservation(ctx: PluginContext, slotKey: string, settings: ReservationSettings): Promise<boolean> {
	if (!slotKey) return false;
	const reservations = ctx.storage.reservations as StorageCollection<Reservation>;
	const history = ctx.storage.reservations_history as StorageCollection<Reservation>;
	const existing = await reservations.get(slotKey);
	if (!existing) return false;
	const cancelled: Reservation = { ...existing, status: "cancelled", updatedAt: new Date().toISOString() };
	await history.put(ulid(), cancelled);
	await reservations.delete(slotKey);
	notifyStatusChange(ctx, settings, cancelled);
	return true;
}
