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

/** Business rules for a reservation request: correct grid, opening hours, active day,
 * not in the past, not beyond the configured booking horizon. */
export function validateReservationRequest(
	slotKey: string,
	settings: ReservationSettings,
	now: Date,
): ReservationRequestValidation {
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

	const maxDate = new Date(now);
	maxDate.setDate(maxDate.getDate() + settings.maxDaysAhead);
	if (slotDate.getTime() > maxDate.getTime()) {
		return { ok: false, reason: "beyond_max_days_ahead" };
	}

	return { ok: true };
}
