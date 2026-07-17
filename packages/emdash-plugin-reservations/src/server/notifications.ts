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

/** Fire-and-forget: never throws, never blocks or fails the reservation flow. */
export function notifyNewReservation(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendIfConfigured(ctx, settings, renderNewReservationEmail(reservation));
}

export function notifyStatusChange(ctx: PluginContext, settings: ReservationSettings, reservation: Reservation): void {
	void sendIfConfigured(ctx, settings, renderStatusChangeEmail(reservation));
}
