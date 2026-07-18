import { isValidDate, isValidSlotTime, isoDayOfWeek, parseSlotKey } from "../shared/slots";
import type { ReservationSettings } from "./model";

export function sanitizeText(input: string, maxLength: number): string {
	return input
		.replace(/[\x00-\x1f\x7f]/g, "")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, maxLength);
}

export type ReservationRequestRejection =
	| "invalid_slot_format"
	| "outside_opening_hours"
	| "inactive_day"
	| "in_past"
	| "beyond_max_days_ahead";

export interface ReservationRequestValidation {
	ok: boolean;
	reason?: ReservationRequestRejection;
}

export interface ValidateReservationOptions {
	/** Admin-created/edited reservations aren't bound by the public booking horizon
	 * (ADMIN_SPEC §9.1) -- opening hours and active days still apply. Defaults to `true`
	 * so the existing public call site's behavior is unchanged. */
	enforceMaxDaysAhead?: boolean;
}

/** Business rules for a reservation request: correct grid, opening hours, active day,
 * not in the past, and (unless disabled for the admin call site) not beyond the
 * configured booking horizon. Shared between the public reserve route and the admin
 * create/update routes (NATIVE_PLAN N2). */
export function validateReservationRequest(
	slotKey: string,
	settings: ReservationSettings,
	now: Date,
	options: ValidateReservationOptions = {},
): ReservationRequestValidation {
	const { enforceMaxDaysAhead = true } = options;
	const { date, time } = parseSlotKey(slotKey);
	if (!isValidDate(date) || !isValidSlotTime(time)) {
		return { ok: false, reason: "invalid_slot_format" };
	}
	if (time < settings.openingTime || time >= settings.closingTime) {
		return { ok: false, reason: "outside_opening_hours" };
	}
	if (!settings.activeDays.includes(isoDayOfWeek(date))) {
		return { ok: false, reason: "inactive_day" };
	}

	const slotDate = new Date(`${date}T${time}:00`);
	if (slotDate.getTime() < now.getTime()) {
		return { ok: false, reason: "in_past" };
	}

	if (enforceMaxDaysAhead) {
		const maxDate = new Date(now);
		maxDate.setDate(maxDate.getDate() + settings.maxDaysAhead);
		if (slotDate.getTime() > maxDate.getTime()) {
			return { ok: false, reason: "beyond_max_days_ahead" };
		}
	}

	return { ok: true };
}

/** Shared sanitization for admin create/update payloads -- same rules as the public
 * reserve route (`sandbox-entry.ts`/`runtime.ts`), applied to the admin upsert shape. */
export function sanitizeAdminUpsert<T extends { name: string; email: string; phone?: string; note?: string }>(
	dto: T,
): T {
	return {
		...dto,
		name: sanitizeText(dto.name, 200),
		email: dto.email.trim().toLowerCase(),
		phone: dto.phone ? sanitizeText(dto.phone, 50) : undefined,
		note: dto.note ? sanitizeText(dto.note, 1000) : undefined,
	};
}
