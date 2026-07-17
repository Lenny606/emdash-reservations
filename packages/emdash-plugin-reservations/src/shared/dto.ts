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
