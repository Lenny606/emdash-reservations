import type { PluginContext } from "emdash";
import type { Reservation, ReservationSettings } from "./model";

export interface EmailTemplate {
	subject: string;
	text: string;
}

export function renderNewReservationEmail(reservation: Reservation): EmailTemplate {
	return {
		subject: `Nová rezervace: ${reservation.date} ${reservation.startTime}`,
		text: [
			`Nová rezervace od ${reservation.name} (${reservation.email}).`,
			`Termín: ${reservation.date} ${reservation.startTime}`,
			reservation.phone ? `Telefon: ${reservation.phone}` : null,
			reservation.note ? `Poznámka: ${reservation.note}` : null,
			`Stav: ${reservation.status}`,
		]
			.filter((line): line is string => line !== null)
			.join("\n"),
	};
}

export function renderStatusChangeEmail(reservation: Reservation): EmailTemplate {
	return {
		subject: `Rezervace ${reservation.date} ${reservation.startTime}: ${reservation.status}`,
		text: `Rezervace od ${reservation.name} (${reservation.email}) na ${reservation.date} ${reservation.startTime} má nový stav: ${reservation.status}.`,
	};
}

/** Customer-facing (English, matches the public site's language -- unlike the admin-facing
 * templates above, which stay Czech per PLAN.md's documented deviation). Sent for manual
 * admin-created reservations (ADMIN_SPEC §5/§6): the customer wasn't part of the booking
 * flow, so they need their own confirmation instead of the admin-facing "new reservation"
 * email (the admin already knows -- they just created it). */
export function renderReservationConfirmedEmail(reservation: Reservation): EmailTemplate {
	return {
		subject: `Reservation confirmed: ${reservation.date} ${reservation.startTime}`,
		text: [
			`Hi ${reservation.name},`,
			"",
			`Your reservation has been confirmed for ${reservation.date} at ${reservation.startTime}.`,
			reservation.note ? `Note: ${reservation.note}` : null,
			"",
			"See you then!",
		]
			.filter((line): line is string => line !== null)
			.join("\n"),
	};
}

/** Customer-facing (English) -- sent on Storno (ADMIN_SPEC §5/§6). Distinct from
 * `renderStatusChangeEmail` above (admin-facing, Czech, generic status-change text): the
 * customer gets a dedicated, clearer "this is cancelled" message. */
export function renderCancellationEmail(reservation: Reservation): EmailTemplate {
	return {
		subject: `Reservation cancelled: ${reservation.date} ${reservation.startTime}`,
		text: [
			`Hi ${reservation.name},`,
			"",
			`Your reservation for ${reservation.date} at ${reservation.startTime} has been cancelled.`,
			"If this wasn't expected, please get in touch and we'll help sort it out.",
		].join("\n"),
	};
}

async function sendIfConfigured(ctx: PluginContext, settings: ReservationSettings, template: EmailTemplate): Promise<void> {
	if (!settings.notifyEnabled || !settings.notifyEmail) {
		ctx.log.info("reservations: notifications disabled or no notifyEmail set, skipping");
		return;
	}
	if (!ctx.email) {
		ctx.log.info("reservations: email transport not configured, skipping notification");
		return;
	}
	try {
		await ctx.email.send({ to: settings.notifyEmail, subject: template.subject, text: template.text });
	} catch (error) {
		ctx.log.warn("reservations: failed to send notification email", { error: String(error) });
	}
}

/** Same `notifyEnabled` guard as `sendIfConfigured`, but sends to the reservation's own
 * email instead of the admin's configured `notifyEmail` -- there's always a destination
 * (the reservation itself), so unlike `sendIfConfigured` this doesn't also require
 * `notifyEmail` to be set. */
async function sendToCustomer(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation, template: EmailTemplate): Promise<void> {
	if (!settings.notifyEnabled) {
		ctx.log.info("reservations: notifications disabled, skipping customer email");
		return;
	}
	if (!ctx.email) {
		ctx.log.info("reservations: email transport not configured, skipping customer email");
		return;
	}
	try {
		await ctx.email.send({ to: reservation.email, subject: template.subject, text: template.text });
	} catch (error) {
		ctx.log.warn("reservations: failed to send customer email", { error: String(error) });
	}
}

/** Fire-and-forget: never throws, never blocks or fails the reservation flow. */
export function notifyNewReservation(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendIfConfigured(ctx, settings, renderNewReservationEmail(reservation));
}

export function notifyStatusChange(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendIfConfigured(ctx, settings, renderStatusChangeEmail(reservation));
}

/** Manual admin creation only (ADMIN_SPEC §5/§6) -- replaces the admin-facing
 * `notifyNewReservation` for that one call site (the admin doesn't need to be told about a
 * reservation they just created themselves). */
export function notifyCustomerReservationConfirmed(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendToCustomer(ctx, settings, reservation, renderReservationConfirmedEmail(reservation));
}

/** Storno (ADMIN_SPEC §5/§6) -- fire-and-forget, same pattern as the other `notify*`
 * functions. `reservation` here is the record as moved into history (status already
 * "cancelled"), matching what `cancelReservation` in `admin-api.ts` has on hand. */
export function notifyCancellation(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendToCustomer(ctx, settings, reservation, renderCancellationEmail(reservation));
}
