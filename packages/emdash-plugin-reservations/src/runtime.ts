import { definePlugin, PluginRouteError, type StorageCollection } from "emdash";
import {
	AdminListFilterDto,
	AdminReservationIdDto,
	AdminReservationUpdateDto,
	AdminSettingsUpdateDto,
	AdminUpsertReservationDto,
	AvailabilityQueryDto,
	CreateReservationDto,
	type AvailabilityResponseDto,
	type ReserveResponseDto,
	type SlotDto,
	type SlotStatus,
} from "./shared/dto";
import { addDays, generateWeekSlots, isValidDate, mondayOf, parseSlotKey } from "./shared/slots";
import type { Reservation } from "./server/model";
import { toReservation, toSlotDto, type ReservationMeta } from "./server/mappers";
import { loadSettings, persistDefaultSettings } from "./server/settings";
import { sanitizeText, validateReservationRequest } from "./server/validation";
import { notifyNewReservation } from "./server/notifications";
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
import {
	cancelReservation,
	confirmReservation,
	createReservation,
	deleteReservation,
	getOverview,
	getReservationDetail,
	getSettings,
	listReservations,
	saveSettings,
	updateReservation,
} from "./server/admin-api";

// Pojmenovaný export je povinný -- emdash 0.28.1 generuje `import { createPlugin } from entrypoint`
// (dist/astro/index.mjs:1159). `export default` shodí načtení virtual:emdash/plugins a s ním
// celý web (ověřeno na src/poc/runtime.ts, viz NATIVE_SPEC.md N0-8).
export function createPlugin() {
	return definePlugin({
		id: "reservations",
		version: "0.2.0",
		capabilities: ["email:send"],
		// This emdash version's PluginDescriptor only supports flat single-field indexes
		// (no composite tuples) -- availability queries filter by `date` and sort
		// slotKey/startTime in memory instead of relying on a composite index.
		storage: {
			reservations: {
				indexes: ["date", "status", "email", "createdAt"],
			},
			reservations_history: {
				indexes: ["date", "status", "email", "createdAt"],
			},
		},

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
				handler: async (ctx) => {
					const secret = await getOrCreateCsrfSecret(ctx);
					return issueCsrfToken(secret);
				},
			},

			"public/availability": {
				public: true,
				// GET requests never reach the framework's JSON-body `input` validation in this
				// emdash version (the dispatcher only parses a JSON body, so query params aren't
				// picked up) -- parse and validate the query string ourselves instead.
				handler: async (ctx) => {
					const url = new URL(ctx.request.url);
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
				handler: async (ctx): Promise<ReserveResponseDto> => {
					const dto = ctx.input;
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

					const csrfSecret = await getOrCreateCsrfSecret(ctx);
					const ipHash = await hashIp(ctx.requestMeta.ip ?? "unknown", csrfSecret);

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
					const meta: ReservationMeta = { ipHash, userAgent: ctx.requestMeta.userAgent ?? undefined, requestNonce };
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

			// Admin routes (NATIVE_PLAN N2). None are `public: true` -- protected by admin
			// session + `X-EmDash-Request` header (verified live, NATIVE_SPEC N0-9). All POST,
			// including reads: GET requests never reach `input:` Zod validation in this emdash
			// version (N0-10), so a mixed GET/POST admin API would silently misbehave on GET.
			// Mutation/lookup handlers return `AdminActionResult` (a normal 200 `{ ok, ... }`
			// payload) instead of throwing `PluginRouteError` -- this workspace's pnpm layout
			// resolves the plugin's own "emdash" import to a different peer-driven instance
			// than the host's dispatcher, so `instanceof PluginRouteError` fails across that
			// boundary and every throw silently degrades to a generic 500 (NATIVE_SPEC N0-11).
			"admin/settings-get": {
				handler: async (ctx) => getSettings(ctx),
			},

			"admin/settings-save": {
				input: AdminSettingsUpdateDto,
				handler: async (ctx) => saveSettings(ctx, ctx.input),
			},

			"admin/overview": {
				handler: async (ctx) => getOverview(ctx),
			},

			"admin/reservations-list": {
				input: AdminListFilterDto,
				handler: async (ctx) => listReservations(ctx, ctx.input),
			},

			"admin/reservation-detail": {
				input: AdminReservationIdDto,
				handler: async (ctx) => getReservationDetail(ctx, ctx.input.id, ctx.input.fromHistory),
			},

			"admin/reservation-confirm": {
				input: AdminReservationIdDto,
				handler: async (ctx) => confirmReservation(ctx, ctx.input.id),
			},

			"admin/reservation-cancel": {
				input: AdminReservationIdDto,
				handler: async (ctx) => cancelReservation(ctx, ctx.input.id),
			},

			"admin/reservation-delete": {
				input: AdminReservationIdDto,
				handler: async (ctx) => deleteReservation(ctx, ctx.input.id, ctx.input.fromHistory),
			},

			"admin/reservation-create": {
				input: AdminUpsertReservationDto,
				handler: async (ctx) => createReservation(ctx, ctx.input),
			},

			"admin/reservation-update": {
				input: AdminReservationUpdateDto,
				handler: async (ctx) => {
					const { id, ...dto } = ctx.input;
					return updateReservation(ctx, id, dto);
				},
			},
		},
	});
}
