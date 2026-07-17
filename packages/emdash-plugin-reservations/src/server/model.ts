export interface Reservation {
	/** Active reservation: id === slotKey. History: ULID. */
	id: string;
	slotKey: string;
	date: string;
	startTime: string;
	durationMinutes: 30;
	name: string;
	email: string;
	phone?: string;
	note?: string;
	status: "pending" | "confirmed" | "cancelled";
	createdAt: string;
	updatedAt: string;
	meta: {
		ipHash?: string;
		userAgent?: string;
		/** Written on create, re-read after `put` to detect a concurrent write to the same
		 * slotKey (id = slotKey, so the loser's write silently overwrites the winner's). */
		requestNonce?: string;
	};
}

export interface ReservationSettings {
	enabled: boolean;
	colorFree: string;
	colorReserved: string;
	colorPending: string;
	colorClosed: string;
	openingTime: string;
	closingTime: string;
	activeDays: number[];
	maxDaysAhead: number;
	autoConfirm: boolean;
	captchaPluginId: string;
	notifyEnabled: boolean;
	notifyEmail: string;
}

export const DEFAULT_SETTINGS: ReservationSettings = {
	enabled: true,
	colorFree: "#22c55e",
	colorReserved: "#ef4444",
	colorPending: "#f59e0b",
	colorClosed: "#e5e7eb",
	openingTime: "08:00",
	closingTime: "18:00",
	activeDays: [1, 2, 3, 4, 5],
	maxDaysAhead: 28,
	autoConfirm: false,
	captchaPluginId: "",
	notifyEnabled: false,
	notifyEmail: "",
};
