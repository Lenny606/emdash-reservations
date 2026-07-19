import { ulid, type PluginContext, type QueryOptions, type StorageCollection } from "emdash";
import type {
	AdminActionResult,
	AdminListFilterDto,
	AdminListResponseDto,
	AdminOverviewDto,
	AdminReservationDetailDto,
	AdminReservationSummaryDto,
	AdminSettingsUpdateDto,
	AdminUpsertReservationDto,
} from "../shared/dto";
import { addDays, makeSlotKey, mondayOf } from "../shared/slots";
import type { Reservation, ReservationSettings } from "./model";
import { loadSettings, saveSettings as persistSettings } from "./settings";
import { notifyCancellation, notifyCustomerReservationConfirmed, notifyStatusChange } from "./notifications";
import { sanitizeAdminUpsert, validateReservationRequest } from "./validation";

type WhereClause = NonNullable<QueryOptions["where"]>;

function reservations(ctx: PluginContext): StorageCollection<Reservation> {
	return ctx.storage.reservations as StorageCollection<Reservation>;
}

function history(ctx: PluginContext): StorageCollection<Reservation> {
	return ctx.storage.reservations_history as StorageCollection<Reservation>;
}

function ok<T>(data: T): AdminActionResult<T> {
	return { ok: true, data };
}

function fail<T>(code: "not_found" | "slot_taken" | "validation_error", message: string): AdminActionResult<T> {
	return { ok: false, code, message };
}

export function toAdminDetailDto(id: string, r: Reservation, fromHistory: boolean): AdminReservationDetailDto {
	return {
		id,
		slotKey: r.slotKey,
		date: r.date,
		startTime: r.startTime,
		name: r.name,
		email: r.email,
		phone: r.phone,
		note: r.note,
		status: r.status,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		meta: { ipHash: r.meta.ipHash, userAgent: r.meta.userAgent },
		fromHistory,
	};
}

export function toAdminSummaryDto(id: string, r: Reservation, fromHistory: boolean): AdminReservationSummaryDto {
	return { id, date: r.date, startTime: r.startTime, name: r.name, email: r.email, status: r.status, createdAt: r.createdAt, fromHistory };
}

export async function getSettings(ctx: PluginContext): Promise<ReservationSettings> {
	return loadSettings(ctx);
}

export async function saveSettings(ctx: PluginContext, patch: AdminSettingsUpdateDto): Promise<ReservationSettings> {
	return persistSettings(ctx, patch);
}

export async function getOverview(ctx: PluginContext): Promise<AdminOverviewDto> {
	const weekStart = mondayOf(new Date().toISOString().slice(0, 10));
	const weekEnd = addDays(weekStart, 6);
	const [thisWeek, pending, confirmed, cancelled] = await Promise.all([
		reservations(ctx).count({ date: { gte: weekStart, lte: weekEnd } }),
		reservations(ctx).count({ status: "pending" }),
		reservations(ctx).count({ status: "confirmed" }),
		history(ctx).count({ status: "cancelled" }),
	]);
	return { thisWeek, pending, confirmed, cancelled };
}

/** Combines status/date-range/email filters into a single flat `where` -- each key hits
 * its own index (SPEC §2: no composite indexes in this emdash version). When browsing
 * history, `status` is dropped: every history row is already "cancelled". */
export async function listReservations(ctx: PluginContext, filter: AdminListFilterDto): Promise<AdminListResponseDto> {
	const collection = filter.showCancelled ? history(ctx) : reservations(ctx);

	const where: WhereClause = {};
	if (filter.status && !filter.showCancelled) where.status = filter.status;
	if (filter.dateFrom || filter.dateTo) {
		where.date = {
			...(filter.dateFrom ? { gte: filter.dateFrom } : {}),
			...(filter.dateTo ? { lte: filter.dateTo } : {}),
		};
	}
	if (filter.email) where.email = filter.email;

	const result = await collection.query({
		where,
		orderBy: { createdAt: "desc" },
		limit: 20,
		cursor: filter.cursor,
	});

	return {
		items: result.items.map((item) => toAdminSummaryDto(item.id, item.data, filter.showCancelled)),
		cursor: result.cursor,
		hasMore: result.hasMore,
	};
}

export async function getReservationDetail(
	ctx: PluginContext,
	id: string,
	fromHistory: boolean,
): Promise<AdminActionResult<AdminReservationDetailDto>> {
	const collection = fromHistory ? history(ctx) : reservations(ctx);
	const reservation = await collection.get(id);
	if (!reservation) return fail("not_found", "Reservation not found");
	return ok(toAdminDetailDto(id, reservation, fromHistory));
}

export async function confirmReservation(ctx: PluginContext, id: string): Promise<AdminActionResult<AdminReservationDetailDto>> {
	const existing = await reservations(ctx).get(id);
	if (!existing || existing.status !== "pending") return fail("not_found", "Reservation not found or not pending");

	const updated: Reservation = { ...existing, status: "confirmed", updatedAt: new Date().toISOString() };
	await reservations(ctx).put(id, updated);

	const settings = await loadSettings(ctx);
	notifyStatusChange(ctx, settings, updated);
	ctx.log.info("reservations: admin confirmed reservation", { id });
	return ok(toAdminDetailDto(id, updated, false));
}

/** Moves an active reservation to history as cancelled. Mechanics carried over unchanged
 * from the Block Kit admin (PLAN.md phase 5); customer notification added in NATIVE_PLAN N6
 * (ADMIN_SPEC §5/§6). */
export async function cancelReservation(ctx: PluginContext, id: string): Promise<AdminActionResult<AdminReservationDetailDto>> {
	const existing = await reservations(ctx).get(id);
	if (!existing) return fail("not_found", "Reservation not found");

	const cancelled: Reservation = { ...existing, status: "cancelled", updatedAt: new Date().toISOString() };
	const historyId = ulid();
	await history(ctx).put(historyId, cancelled);
	await reservations(ctx).delete(id);

	const settings = await loadSettings(ctx);
	notifyCancellation(ctx, settings, cancelled);
	ctx.log.info("reservations: admin cancelled reservation", { id, historyId });
	return ok(toAdminDetailDto(historyId, cancelled, true));
}

export async function deleteReservation(
	ctx: PluginContext,
	id: string,
	fromHistory: boolean,
): Promise<AdminActionResult<{ deleted: true }>> {
	const collection = fromHistory ? history(ctx) : reservations(ctx);
	const deleted = await collection.delete(id);
	if (!deleted) return fail("not_found", "Reservation not found");
	ctx.log.info("reservations: admin deleted reservation", { id, fromHistory });
	return ok({ deleted: true });
}

/** Admin create: bypasses the public security pipeline (CSRF/captcha/honeypot/rate-limit
 * -- the route is behind admin auth) and the public booking horizon/enabled gate
 * (ADMIN_SPEC §5 Vytvořit) -- opening hours and active days still apply. */
export async function createReservation(
	ctx: PluginContext,
	dto: AdminUpsertReservationDto,
): Promise<AdminActionResult<AdminReservationDetailDto>> {
	const settings = await loadSettings(ctx);
	const sanitized = sanitizeAdminUpsert(dto);

	const slotKey = makeSlotKey(sanitized.date, sanitized.startTime);
	const validation = validateReservationRequest(slotKey, settings, new Date(), { enforceMaxDaysAhead: false });
	if (!validation.ok) return fail("validation_error", `That slot can't be booked (${validation.reason}).`);

	const collection = reservations(ctx);
	if (await collection.exists(slotKey)) return fail("slot_taken", "That slot is already booked");

	const now = new Date().toISOString();
	const reservation: Reservation = {
		id: slotKey,
		slotKey,
		date: sanitized.date,
		startTime: sanitized.startTime,
		durationMinutes: 30,
		name: sanitized.name,
		email: sanitized.email,
		phone: sanitized.phone,
		note: sanitized.note,
		status: sanitized.status,
		createdAt: now,
		updatedAt: now,
		meta: {},
	};
	await collection.put(slotKey, reservation);

	// Customer-facing confirmation, not the admin-facing `notifyNewReservation` -- the admin
	// doesn't need telling about a reservation they just created themselves (ADMIN_SPEC §5/§6).
	notifyCustomerReservationConfirmed(ctx, settings, reservation);
	ctx.log.info("reservations: admin created reservation", { slotKey });
	return ok(toAdminDetailDto(slotKey, reservation, false));
}

/** Admin edit. Same slot: in-place update of contact fields/status. Different slot:
 * re-key (id === slotKey for active reservations) -- put under the new key, then delete
 * the old one; a collision on the new slot leaves the existing record untouched
 * (ADMIN_SPEC §5 Upravit). Only reachable for active reservations -- history rows aren't
 * editable. */
export async function updateReservation(
	ctx: PluginContext,
	id: string,
	dto: AdminUpsertReservationDto,
): Promise<AdminActionResult<AdminReservationDetailDto>> {
	const collection = reservations(ctx);
	const existing = await collection.get(id);
	if (!existing) return fail("not_found", "Reservation not found");

	const settings = await loadSettings(ctx);
	const sanitized = sanitizeAdminUpsert(dto);

	const newSlotKey = makeSlotKey(sanitized.date, sanitized.startTime);
	const validation = validateReservationRequest(newSlotKey, settings, new Date(), { enforceMaxDaysAhead: false });
	if (!validation.ok) return fail("validation_error", `That slot can't be booked (${validation.reason}).`);

	const updated: Reservation = {
		...existing,
		slotKey: newSlotKey,
		date: sanitized.date,
		startTime: sanitized.startTime,
		name: sanitized.name,
		email: sanitized.email,
		phone: sanitized.phone,
		note: sanitized.note,
		status: sanitized.status,
		updatedAt: new Date().toISOString(),
	};

	if (newSlotKey === id) {
		await collection.put(id, updated);
		ctx.log.info("reservations: admin updated reservation", { id });
		return ok(toAdminDetailDto(id, updated, false));
	}

	if (await collection.exists(newSlotKey)) return fail("slot_taken", "That slot is already booked");

	await collection.put(newSlotKey, { ...updated, id: newSlotKey });
	await collection.delete(id);
	ctx.log.info("reservations: admin updated reservation (re-keyed)", { from: id, to: newSlotKey });
	return ok(toAdminDetailDto(newSlotKey, updated, false));
}
