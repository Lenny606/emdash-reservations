import { blocks, elements, type Block } from "@emdash-cms/blocks";
import type { ReservationListItemDto } from "../shared/dto";
import type { ReservationSettings } from "./model";

export function buildSettingsFormBlocks(settings: ReservationSettings): Block[] {
	return [
		blocks.header("Settings"),
		blocks.form({
			blockId: "settings-form",
			fields: [
				elements.toggle("enabled", "Enabled", { initialValue: settings.enabled }),
				elements.textInput("openingTime", "Opening time (HH:mm)", { initialValue: settings.openingTime }),
				elements.textInput("closingTime", "Closing time (HH:mm)", { initialValue: settings.closingTime }),
				elements.textInput("activeDays", "Active days (1=Mon..7=Sun, comma-separated)", {
					initialValue: settings.activeDays.join(","),
				}),
				elements.numberInput("maxDaysAhead", "Max days ahead", {
					initialValue: settings.maxDaysAhead,
					min: 1,
					max: 365,
				}),
				elements.toggle("autoConfirm", "Auto-confirm new reservations", { initialValue: settings.autoConfirm }),
				elements.textInput("colorFree", `Free slot color (currently ${settings.colorFree})`, {
					initialValue: settings.colorFree,
				}),
				elements.textInput("colorReserved", `Reserved slot color (currently ${settings.colorReserved})`, {
					initialValue: settings.colorReserved,
				}),
				elements.textInput("colorPending", `Pending slot color (currently ${settings.colorPending})`, {
					initialValue: settings.colorPending,
				}),
				elements.textInput("colorClosed", `Closed slot color (currently ${settings.colorClosed})`, {
					initialValue: settings.colorClosed,
				}),
				elements.textInput("captchaPluginId", "Captcha plugin ID (leave empty to disable)", {
					initialValue: settings.captchaPluginId,
				}),
				elements.toggle("notifyEnabled", "Email notifications", { initialValue: settings.notifyEnabled }),
				elements.textInput("notifyEmail", "Notification email", { initialValue: settings.notifyEmail }),
			],
			submit: { label: "Save settings", actionId: "save_settings" },
		}),
	];
}

export interface OverviewStats {
	thisWeek: number;
	pending: number;
	confirmed: number;
	cancelled: number;
}

export function buildOverviewBlocks(stats: OverviewStats): Block[] {
	return [
		blocks.header("Overview"),
		blocks.stats([
			{ label: "This week", value: stats.thisWeek },
			{ label: "Pending", value: stats.pending },
			{ label: "Confirmed", value: stats.confirmed },
			{ label: "Cancelled", value: stats.cancelled },
		]),
	];
}

/** The installed Block Kit's `table` block has no per-row action buttons -- only
 * `section.accessory` (single element) and `actions` (multiple buttons) support
 * interactive elements. Actionable pending reservations are rendered as a
 * section+actions pair per row instead of a table row. */
export function buildPendingListBlocks(items: ReservationListItemDto[]): Block[] {
	const result: Block[] = [blocks.header("Pending confirmations")];
	if (items.length === 0) {
		result.push(blocks.context("No pending reservations."));
		return result;
	}
	for (const item of items) {
		result.push(
			blocks.section(`${item.date} ${item.startTime} — ${item.name} (${item.email})`),
			blocks.actions([
				elements.button("confirm", "Confirm", { style: "primary", value: item.slotKey }),
				elements.button("cancel", "Cancel", {
					style: "danger",
					value: item.slotKey,
					confirm: {
						title: "Cancel this reservation?",
						text: `${item.date} ${item.startTime} — ${item.name}`,
						confirm: "Cancel reservation",
						deny: "Keep it",
						style: "danger",
					},
				}),
			]),
		);
	}
	return result;
}

export function buildReservationsTableBlocks(items: ReservationListItemDto[]): Block[] {
	return [
		blocks.header("Recent reservations"),
		blocks.table({
			pageActionId: "reservations_page",
			emptyText: "No reservations yet.",
			columns: [
				{ key: "date", label: "Date", format: "text" },
				{ key: "startTime", label: "Time", format: "text" },
				{ key: "name", label: "Name", format: "text" },
				{ key: "email", label: "Email", format: "text" },
				{ key: "status", label: "Status", format: "badge" },
				{ key: "createdAt", label: "Created", format: "relative_time" },
			],
			rows: items.map((item) => ({ ...item })),
		}),
	];
}
