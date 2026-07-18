import { apiFetch, parseApiResponse } from "@emdash-cms/admin";
import type {
	AdminActionResult,
	AdminListFilterDto,
	AdminListResponseDto,
	AdminOverviewDto,
	AdminReservationDetailDto,
	AdminSettingsUpdateDto,
	AdminUpsertReservationDto,
} from "../shared/dto";
import type { ReservationSettings } from "../server/model";

const BASE_URL = "/_emdash/api/plugins/reservations/admin";

/** All admin routes are POST (NATIVE_SPEC §4/N0-10) and require the `X-EmDash-Request`
 * header `apiFetch` adds automatically (N0-9). Responses are always `{ data: ... }` on
 * 2xx -- `parseApiResponse` unwraps that envelope and throws on a non-2xx (auth failure,
 * malformed input). Business-level failures (not found, slot taken, ...) come back as a
 * normal 200 `AdminActionResult` -- see NATIVE_SPEC N0-11 for why. */
async function post<T>(path: string, body: unknown = {}): Promise<T> {
	const response = await apiFetch(`${BASE_URL}/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return parseApiResponse<T>(response, "Request failed");
}

export function getSettings(): Promise<ReservationSettings> {
	return post("settings-get");
}

export function saveSettings(patch: AdminSettingsUpdateDto): Promise<ReservationSettings> {
	return post("settings-save", patch);
}

export function getOverview(): Promise<AdminOverviewDto> {
	return post("overview");
}

export function listReservations(filter: AdminListFilterDto): Promise<AdminListResponseDto> {
	return post("reservations-list", filter);
}

export function getReservationDetail(id: string, fromHistory = false): Promise<AdminActionResult<AdminReservationDetailDto>> {
	return post("reservation-detail", { id, fromHistory });
}

export function confirmReservation(id: string): Promise<AdminActionResult<AdminReservationDetailDto>> {
	return post("reservation-confirm", { id });
}

export function cancelReservation(id: string): Promise<AdminActionResult<AdminReservationDetailDto>> {
	return post("reservation-cancel", { id });
}

export function deleteReservation(id: string, fromHistory = false): Promise<AdminActionResult<{ deleted: true }>> {
	return post("reservation-delete", { id, fromHistory });
}

export function createReservation(dto: AdminUpsertReservationDto): Promise<AdminActionResult<AdminReservationDetailDto>> {
	return post("reservation-create", dto);
}

export function updateReservation(
	id: string,
	dto: AdminUpsertReservationDto,
): Promise<AdminActionResult<AdminReservationDetailDto>> {
	return post("reservation-update", { id, ...dto });
}
