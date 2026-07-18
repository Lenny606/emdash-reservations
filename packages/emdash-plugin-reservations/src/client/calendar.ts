import type { AvailabilityResponseDto, SlotDto, ReservationErrorCode } from "../shared/dto";
import { addDays, mondayOf } from "../shared/slots";
import { createReservation, getAvailability, getCsrfToken, type ApiError } from "./api-client";

const ERROR_MESSAGES: Record<ReservationErrorCode | "unknown_error" | "network_error" | "aborted", string> = {
	slot_taken: "Sorry, that slot was just taken. Please pick another one.",
	invalid_csrf: "This form has expired. Please try again.",
	captcha_failed: "Bot verification failed. Please try again.",
	rate_limited: "Too many attempts. Please try again in a moment.",
	disabled: "Reservations are currently unavailable.",
	validation_error: "That slot can't be booked.",
	unknown_error: "Something went wrong.",
	network_error: "Couldn't reach the server.",
	aborted: "Request cancelled.",
};

function errorMessage(error: ApiError): string {
	return ERROR_MESSAGES[error.code as keyof typeof ERROR_MESSAGES] ?? error.message;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarState {
	weekStart: string;
	data: AvailabilityResponseDto | null;
	loading: boolean;
	error: ApiError | null;
	selectedSlot: SlotDto | null;
	submitting: boolean;
	formError: string | null;
	formSuccess: string | null;
}

export function initReservationCalendar(root: HTMLElement): void {
	const appEl = root.querySelector<HTMLElement>("[data-rsv-app]");
	if (!appEl) return;
	const app: HTMLElement = appEl;
	app.hidden = false;

	const state: CalendarState = {
		weekStart: mondayOf(new Date().toISOString().slice(0, 10)),
		data: null,
		loading: true,
		error: null,
		selectedSlot: null,
		submitting: false,
		formError: null,
		formSuccess: null,
	};

	function setState(patch: Partial<CalendarState>): void {
		Object.assign(state, patch);
		render();
	}

	async function load(force = false): Promise<void> {
		setState({ loading: true, error: null });
		try {
			const data = await getAvailability(state.weekStart, { force });
			root.style.setProperty("--rsv-free", data.config.colors.free);
			root.style.setProperty("--rsv-reserved", data.config.colors.reserved);
			root.style.setProperty("--rsv-pending", data.config.colors.pending);
			root.style.setProperty("--rsv-closed", data.config.colors.closed);
			setState({ data, loading: false });
		} catch (error) {
			if ((error as ApiError).code === "aborted") return;
			setState({ loading: false, error: error as ApiError });
		}
	}

	function goToWeek(weekStart: string): void {
		setState({ weekStart, selectedSlot: null, formError: null, formSuccess: null });
		void load();
	}

	function selectSlot(slot: SlotDto): void {
		if (slot.status !== "free") return;
		setState({ selectedSlot: slot, formError: null, formSuccess: null });
	}

	async function submitForm(form: HTMLFormElement): Promise<void> {
		if (!state.selectedSlot || !state.data) return;
		const formData = new FormData(form);
		const captchaRequired = state.data.captchaRequired;
		const captchaToken = String(formData.get("captchaToken") ?? "");
		if (captchaRequired && !captchaToken) {
			setState({ formError: "Please complete the bot-verification challenge." });
			return;
		}

		setState({ submitting: true, formError: null });
		try {
			const { token: csrfToken } = await getCsrfToken();
			const result = await createReservation({
				slotKey: state.selectedSlot.slotKey,
				name: String(formData.get("name") ?? ""),
				email: String(formData.get("email") ?? ""),
				phone: String(formData.get("phone") ?? "") || undefined,
				note: String(formData.get("note") ?? "") || undefined,
				csrfToken,
				captchaToken: captchaToken || undefined,
				website: String(formData.get("website") ?? ""),
			});

			if (!result.ok) {
				setState({ submitting: false, formError: errorMessage({ code: result.code, message: result.message }) });
				return;
			}

			setState({
				submitting: false,
				selectedSlot: null,
				formSuccess: "Your reservation request has been sent. We'll be in touch shortly.",
			});
			await load(true);
		} catch (error) {
			setState({ submitting: false, formError: errorMessage(error as ApiError) });
		}
	}

	function render(): void {
		app.replaceChildren();
		app.append(renderToolbar());

		if (state.loading && !state.data) {
			app.append(el("p", { class: "rsv-message" }, "Loading available slots…"));
			return;
		}
		if (state.error) {
			const retry = el("button", { type: "button", class: "rsv-button" }, "Try again");
			retry.addEventListener("click", () => void load());
			app.append(el("p", { class: "rsv-message rsv-message--error" }, errorMessage(state.error)), retry);
			return;
		}
		if (!state.data) return;

		app.append(renderGrid(state.data));

		if (state.formSuccess) {
			app.append(el("p", { class: "rsv-message rsv-message--success" }, state.formSuccess));
		}
		if (state.selectedSlot) {
			app.append(renderForm(state.data, state.selectedSlot));
		}
	}

	function renderToolbar(): HTMLElement {
		// Don't offer weeks that start beyond the booking horizon -- every slot there
		// would render as closed anyway (YYYY-MM-DD strings compare lexicographically).
		const nextWeekStart = addDays(state.weekStart, 7);
		const lastBookableDate = state.data
			? addDays(new Date().toISOString().slice(0, 10), state.data.config.maxDaysAhead)
			: null;
		const nextDisabled = lastBookableDate !== null && nextWeekStart > lastBookableDate;

		const prevBtn = el("button", { type: "button", class: "rsv-button", "aria-label": "Previous week" }, "‹");
		const todayBtn = el("button", { type: "button", class: "rsv-button" }, "Today");
		const nextBtn = el(
			"button",
			{
				type: "button",
				class: "rsv-button",
				"aria-label": "Next week",
				disabled: nextDisabled ? "true" : undefined,
			},
			"›",
		);

		prevBtn.addEventListener("click", () => goToWeek(addDays(state.weekStart, -7)));
		todayBtn.addEventListener("click", () => goToWeek(mondayOf(new Date().toISOString().slice(0, 10))));
		if (!nextDisabled) {
			nextBtn.addEventListener("click", () => goToWeek(nextWeekStart));
		}

		if (state.data && !state.data.enabled) {
			return el(
				"div",
				{ class: "rsv-toolbar" },
				el("p", { class: "rsv-message rsv-message--error" }, "Reservations are currently unavailable."),
			);
		}

		return el(
			"div",
			{ class: "rsv-toolbar" },
			prevBtn,
			el("span", { class: "rsv-week-label" }, formatWeekLabel(state.weekStart)),
			todayBtn,
			nextBtn,
		);
	}

	function renderGrid(data: AvailabilityResponseDto): HTMLElement {
		const times = Array.from(new Set(data.slots.map((slot) => slot.startTime))).sort();
		const slotsByKey = new Map(data.slots.map((slot) => [`${slot.date}_${slot.startTime}`, slot]));

		const grid = el("div", { class: "rsv-grid" });

		grid.append(el("div", { class: "rsv-cell rsv-cell--corner" }, ""));
		for (const day of data.days) {
			grid.append(
				el(
					"div",
					{ class: "rsv-cell rsv-day-label" },
					el("span", {}, DAY_LABELS[day.dayOfWeek - 1] ?? ""),
					el("span", { class: "rsv-day-date" }, formatDayDate(day.date)),
				),
			);
		}

		for (const time of times) {
			grid.append(el("div", { class: "rsv-cell rsv-time-label" }, time));
			for (const day of data.days) {
				const slot = slotsByKey.get(`${day.date}_${time}`);
				if (!slot) {
					grid.append(el("div", { class: "rsv-cell rsv-slot rsv-slot--closed" }));
					continue;
				}
				const cell = el(
					"button",
					{
						type: "button",
						class: `rsv-cell rsv-slot rsv-slot--${slot.status}`,
						disabled: slot.status !== "free" ? "true" : undefined,
						"aria-label": `${formatDayDate(day.date)} ${slot.startTime}`,
					},
					"",
				);
				if (slot.status === "free") {
					cell.addEventListener("click", () => selectSlot(slot));
				}
				grid.append(cell);
			}
		}

		return grid;
	}

	function renderForm(data: AvailabilityResponseDto, slot: SlotDto): HTMLElement {
		const form = el("form", { class: "rsv-form" }) as HTMLFormElement;
		form.append(
			el("h3", {}, `Reservation: ${formatDayDate(slot.date)} ${slot.startTime}`),
			formField("name", "Name", "text", true),
			formField("email", "Email", "email", true),
			formField("phone", "Phone", "tel", false),
			formField("note", "Note", "textarea", false),
		);

		// Honeypot: visually hidden, kept out of the tab order. A filled-in value is a bot signal.
		const honeypot = el("input", {
			type: "text",
			name: "website",
			autocomplete: "off",
			tabindex: "-1",
			class: "rsv-honeypot",
			"aria-hidden": "true",
		});
		form.append(honeypot);

		if (data.captchaRequired) {
			const captchaSlot = el("div", { "data-rsv-captcha": "true" });
			const hiddenToken = el("input", { type: "hidden", name: "captchaToken" });
			form.append(captchaSlot, hiddenToken);
		}

		if (state.formError) {
			form.append(el("p", { class: "rsv-message rsv-message--error" }, state.formError));
		}

		const actions = el("div", { class: "rsv-form-actions" });
		const submitBtn = el(
			"button",
			{ type: "submit", class: "rsv-button rsv-button--primary", disabled: state.submitting ? "true" : undefined },
			state.submitting ? "Submitting…" : "Reserve",
		);
		const cancelBtn = el("button", { type: "button", class: "rsv-button" }, "Cancel");
		cancelBtn.addEventListener("click", () => setState({ selectedSlot: null, formError: null }));
		actions.append(submitBtn, cancelBtn);
		form.append(actions);

		form.addEventListener("submit", (event) => {
			event.preventDefault();
			void submitForm(form);
		});

		return form;
	}

	void load();
}

function formField(name: string, label: string, type: string, required: boolean): HTMLElement {
	const inputEl =
		type === "textarea"
			? el("textarea", { name, rows: "3" })
			: el("input", { type, name, required: required ? "true" : undefined });
	return el("label", { class: "rsv-form-field" }, el("span", {}, label), inputEl);
}

function formatWeekLabel(weekStart: string): string {
	const end = addDays(weekStart, 6);
	return `${formatDayDate(weekStart)} – ${formatDayDate(end)}`;
}

function formatDayDate(date: string): string {
	const [, month, day] = date.split("-");
	return `${day}.${month}.`;
}

type ElChildren = Array<HTMLElement | string>;

function el(tag: string, attrs: Record<string, string | undefined> = {}, ...children: ElChildren): HTMLElement {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined) continue;
		if (key === "style") node.setAttribute("style", value);
		else node.setAttribute(key, value);
	}
	for (const child of children) {
		node.append(typeof child === "string" ? document.createTextNode(child) : child);
	}
	return node;
}
