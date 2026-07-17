/** Pure slot/calendar math shared between client and server. No ctx dependency. */

export const SLOT_STEP_MINUTES = 30;

export function makeSlotKey(date: string, time: string): string {
	return `${date}_${time}`;
}

export function parseSlotKey(slotKey: string): { date: string; time: string } {
	const [date, time] = slotKey.split("_");
	return { date: date ?? "", time: time ?? "" };
}

export function isValidSlotTime(time: string): boolean {
	return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

export function isValidDate(date: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const d = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** ISO day of week: 1 = Monday .. 7 = Sunday. */
export function isoDayOfWeek(date: string): number {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

/** Monday ("YYYY-MM-DD") of the week containing `date`. */
export function mondayOf(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	const day = d.getUTCDay();
	const diff = (day === 0 ? -6 : 1) - day;
	d.setUTCDate(d.getUTCDate() + diff);
	return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export interface WeekSlotsSettings {
	openingTime: string;
	closingTime: string;
	activeDays: number[];
}

export interface GeneratedSlot {
	date: string;
	startTime: string;
	slotKey: string;
	dayOfWeek: number;
}

function timesBetween(openingTime: string, closingTime: string): string[] {
	const times: string[] = [];
	const [openH = 0, openM = 0] = openingTime.split(":").map(Number);
	const [closeH = 0, closeM = 0] = closingTime.split(":").map(Number);
	let h = openH;
	let m = openM;
	while (h < closeH || (h === closeH && m < closeM)) {
		times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
		m += SLOT_STEP_MINUTES;
		if (m >= 60) {
			m -= 60;
			h += 1;
		}
	}
	return times;
}

/** Generates all slots for the 7-day week starting Monday `weekStart`. */
export function generateWeekSlots(weekStart: string, settings: WeekSlotsSettings): GeneratedSlot[] {
	const slots: GeneratedSlot[] = [];
	for (let i = 0; i < 7; i++) {
		const date = addDays(weekStart, i);
		const dayOfWeek = i + 1;
		if (!settings.activeDays.includes(dayOfWeek)) continue;
		for (const startTime of timesBetween(settings.openingTime, settings.closingTime)) {
			slots.push({ date, startTime, slotKey: makeSlotKey(date, startTime), dayOfWeek });
		}
	}
	return slots;
}
