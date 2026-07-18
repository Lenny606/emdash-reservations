import { z } from "astro/zod";

export const AvailabilityQueryDto = z.object({
	weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart must be YYYY-MM-DD"),
});
export type AvailabilityQueryDto = z.infer<typeof AvailabilityQueryDto>;

export const SlotStatus = z.enum(["free", "reserved", "pending", "closed", "past"]);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const SlotDto = z.object({
	slotKey: z.string(),
	date: z.string(),
	startTime: z.string(),
	status: SlotStatus,
});
export type SlotDto = z.infer<typeof SlotDto>;

export const AvailabilityResponseDto = z.object({
	weekStart: z.string(),
	days: z.array(z.object({ date: z.string(), dayOfWeek: z.number() })),
	slots: z.array(SlotDto),
	config: z.object({
		openingTime: z.string(),
		closingTime: z.string(),
		activeDays: z.array(z.number()),
		maxDaysAhead: z.number(),
		colors: z.object({
			free: z.string(),
			reserved: z.string(),
			pending: z.string(),
			closed: z.string(),
		}),
	}),
	captchaRequired: z.boolean(),
	enabled: z.boolean(),
});
export type AvailabilityResponseDto = z.infer<typeof AvailabilityResponseDto>;

/** `website` is the honeypot field -- validated as a plain string, not rejected at the
 * schema layer, so a filled-in value reaches the handler and can be silently discarded
 * rather than surfacing a 400 that would tip off a bot. */
export const CreateReservationDto = z.object({
	slotKey: z.string(),
	name: z.string().min(1).max(200),
	email: z.string().email(),
	phone: z.string().max(50).optional(),
	note: z.string().max(1000).optional(),
	csrfToken: z.string(),
	captchaToken: z.string().optional(),
	website: z.string().max(500).optional().default(""),
});
export type CreateReservationDto = z.infer<typeof CreateReservationDto>;

export const ReservationErrorCode = z.enum([
	"slot_taken",
	"invalid_csrf",
	"captcha_failed",
	"rate_limited",
	"disabled",
	"validation_error",
]);
export type ReservationErrorCode = z.infer<typeof ReservationErrorCode>;

export interface ReservationCreatedDto {
	ok: true;
	reservationId: string;
	slot: SlotDto;
}

export interface ReservationErrorDto {
	ok: false;
	code: ReservationErrorCode;
	message: string;
}

export type ReserveResponseDto = ReservationCreatedDto | ReservationErrorDto;

/** Full data for the admin Block Kit table -- never sent to the public availability route. */
export interface ReservationListItemDto {
	id: string;
	slotKey: string;
	date: string;
	startTime: string;
	name: string;
	email: string;
	phone?: string;
	note?: string;
	status: "pending" | "confirmed" | "cancelled";
	createdAt: string;
}

// --- Native admin API (NATIVE_PLAN N2) ---------------------------------------------

export const AdminListFilterDto = z.object({
	status: z.enum(["pending", "confirmed"]).optional(),
	dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	email: z.string().optional(),
	showCancelled: z.boolean().default(false),
	cursor: z.string().optional(),
});
export type AdminListFilterDto = z.infer<typeof AdminListFilterDto>;

export const AdminUpsertReservationDto = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
	startTime: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "startTime must be HH:00 or HH:30"),
	name: z.string().min(1).max(200),
	email: z.string().email(),
	phone: z.string().max(50).optional(),
	note: z.string().max(1000).optional(),
	status: z.enum(["pending", "confirmed"]).default("confirmed"),
});
export type AdminUpsertReservationDto = z.infer<typeof AdminUpsertReservationDto>;

export const AdminReservationIdDto = z.object({
	id: z.string().min(1),
	fromHistory: z.boolean().optional().default(false),
});
export type AdminReservationIdDto = z.infer<typeof AdminReservationIdDto>;

export const AdminReservationUpdateDto = AdminUpsertReservationDto.extend({
	id: z.string().min(1),
});
export type AdminReservationUpdateDto = z.infer<typeof AdminReservationUpdateDto>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex color");
const gridTime = z.string().regex(/^([01]\d|2[0-3]):(00|30)$/, "must be HH:00 or HH:30");

export const AdminSettingsUpdateDto = z.object({
	enabled: z.boolean().optional(),
	colorFree: hexColor.optional(),
	colorReserved: hexColor.optional(),
	colorPending: hexColor.optional(),
	colorClosed: hexColor.optional(),
	openingTime: gridTime.optional(),
	closingTime: gridTime.optional(),
	activeDays: z.array(z.number().int().min(1).max(7)).optional(),
	maxDaysAhead: z.number().int().min(1).max(365).optional(),
	autoConfirm: z.boolean().optional(),
	captchaPluginId: z.string().optional(),
	notifyEnabled: z.boolean().optional(),
	notifyEmail: z.union([z.literal(""), z.string().email()]).optional(),
});
export type AdminSettingsUpdateDto = z.infer<typeof AdminSettingsUpdateDto>;

/** Full data for a single reservation in the admin detail view -- PII and meta included.
 * Never sent to public routes. `fromHistory` tells the caller which collection the id
 * belongs to (active reservations key by slotKey, history keys by ULID), so follow-up
 * detail/delete/update calls know where to look. */
export interface AdminReservationDetailDto {
	id: string;
	slotKey: string;
	date: string;
	startTime: string;
	name: string;
	email: string;
	phone?: string;
	note?: string;
	status: "pending" | "confirmed" | "cancelled";
	createdAt: string;
	updatedAt: string;
	meta: { ipHash?: string; userAgent?: string };
	fromHistory: boolean;
}

/** Lightweight row shape for the admin list view -- no phone/note/meta. */
export interface AdminReservationSummaryDto {
	id: string;
	date: string;
	startTime: string;
	name: string;
	email: string;
	status: "pending" | "confirmed" | "cancelled";
	createdAt: string;
	fromHistory: boolean;
}

export interface AdminListResponseDto {
	items: AdminReservationSummaryDto[];
	cursor?: string;
	hasMore: boolean;
}

export interface AdminOverviewDto {
	thisWeek: number;
	pending: number;
	confirmed: number;
	cancelled: number;
}

/** Discriminated result for admin mutation/lookup routes. Always returned as a normal
 * `{ data: ... }` 200 response (never a thrown `PluginRouteError`) -- this workspace's pnpm
 * layout resolves the plugin's own "emdash" import to a different peer-dependency-driven
 * instance than the one the host's route dispatcher uses internally, so `instanceof
 * PluginRouteError` fails across that boundary and every thrown PluginRouteError silently
 * degrades to a generic 500 (see NATIVE_SPEC N0-11). Same shape `public/reserve` already
 * used for its error cases, extended to the admin routes. */
export type AdminActionErrorCode = "not_found" | "slot_taken" | "validation_error";

export interface AdminActionError {
	ok: false;
	code: AdminActionErrorCode;
	message: string;
}

export interface AdminActionSuccess<T> {
	ok: true;
	data: T;
}

export type AdminActionResult<T> = AdminActionSuccess<T> | AdminActionError;
