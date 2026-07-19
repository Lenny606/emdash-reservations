import { describe, expect, it } from "vitest";
import {
	renderCancellationEmail,
	renderNewReservationEmail,
	renderReservationConfirmedEmail,
	renderStatusChangeEmail,
} from "./notifications";
import type { Reservation } from "./model";

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
	return {
		id: "2026-08-03_10:00",
		slotKey: "2026-08-03_10:00",
		date: "2026-08-03",
		startTime: "10:00",
		durationMinutes: 30,
		name: "Jane Doe",
		email: "jane@example.com",
		status: "confirmed",
		createdAt: "2026-07-19T00:00:00.000Z",
		updatedAt: "2026-07-19T00:00:00.000Z",
		meta: {},
		...overrides,
	};
}

describe("renderNewReservationEmail", () => {
	it("includes phone and note when present", () => {
		const email = renderNewReservationEmail(makeReservation({ phone: "555-1234", note: "Window seat" }));
		expect(email.subject).toContain("2026-08-03");
		expect(email.text).toContain("555-1234");
		expect(email.text).toContain("Window seat");
	});

	it("omits phone/note lines when absent", () => {
		const email = renderNewReservationEmail(makeReservation());
		expect(email.text).not.toContain("Telefon");
		expect(email.text).not.toContain("Poznámka");
	});
});

describe("renderStatusChangeEmail", () => {
	it("mentions the new status", () => {
		const email = renderStatusChangeEmail(makeReservation({ status: "confirmed" }));
		expect(email.text).toContain("confirmed");
	});
});

describe("renderReservationConfirmedEmail", () => {
	it("greets the customer by name and includes the slot", () => {
		const email = renderReservationConfirmedEmail(makeReservation({ name: "Jane" }));
		expect(email.text).toContain("Hi Jane,");
		expect(email.text).toContain("2026-08-03 at 10:00");
	});

	it("includes the note when present, omits the line otherwise", () => {
		const withNote = renderReservationConfirmedEmail(makeReservation({ note: "Allergic to peanuts" }));
		expect(withNote.text).toContain("Note: Allergic to peanuts");

		const withoutNote = renderReservationConfirmedEmail(makeReservation());
		expect(withoutNote.text).not.toContain("Note:");
	});
});

describe("renderCancellationEmail", () => {
	it("greets the customer and states the cancelled slot", () => {
		const email = renderCancellationEmail(makeReservation({ name: "Jane", date: "2026-08-03", startTime: "10:00" }));
		expect(email.subject).toBe("Reservation cancelled: 2026-08-03 10:00");
		expect(email.text).toContain("Hi Jane,");
		expect(email.text).toContain("2026-08-03 at 10:00");
		expect(email.text).toContain("cancelled");
	});
});
