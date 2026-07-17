import type { AvailabilityResponseDto, CreateReservationDto, ReserveResponseDto } from "../shared/dto";

const BASE_URL = "/_emdash/api/plugins/reservations";

export interface ApiError {
	code: string;
	message: string;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// handled below via response.ok check
	}
	if (!response.ok) {
		const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
		const apiError: ApiError = {
			code: err?.code ?? "unknown_error",
			message: err?.message ?? "Nastala neočekávaná chyba.",
		};
		throw apiError;
	}
	return (body as { data: T }).data;
}

function normalizeError(error: unknown): ApiError {
	if (error && typeof error === "object" && "code" in error && "message" in error) {
		return error as ApiError;
	}
	if (error instanceof DOMException && error.name === "AbortError") {
		return { code: "aborted", message: "Požadavek byl zrušen." };
	}
	return { code: "network_error", message: "Nepodařilo se spojit se serverem." };
}

async function fetchWithRetry(url: string, signal: AbortSignal, attemptsLeft = 2): Promise<Response> {
	try {
		return await fetch(url, { signal });
	} catch (error) {
		if (signal.aborted || attemptsLeft <= 0) throw error;
		await new Promise((resolve) => setTimeout(resolve, 300));
		return fetchWithRetry(url, signal, attemptsLeft - 1);
	}
}

let availabilityController: AbortController | null = null;
let availabilityKey: string | null = null;
let availabilityPromise: Promise<AvailabilityResponseDto> | null = null;

/** Single-flight per weekStart: switching weeks aborts the previous in-flight request.
 * Pass `force: true` to bypass the memoized result (e.g. after a successful reservation). */
export function getAvailability(weekStart: string, options?: { force?: boolean }): Promise<AvailabilityResponseDto> {
	if (!options?.force && availabilityKey === weekStart && availabilityPromise) {
		return availabilityPromise;
	}

	availabilityController?.abort();
	const controller = new AbortController();
	availabilityController = controller;
	availabilityKey = weekStart;

	const promise = fetchWithRetry(
		`${BASE_URL}/public/availability?weekStart=${encodeURIComponent(weekStart)}`,
		controller.signal,
	)
		.then((response) => parseEnvelope<AvailabilityResponseDto>(response))
		.catch((error) => {
			if (availabilityKey === weekStart) {
				availabilityKey = null;
				availabilityPromise = null;
			}
			throw normalizeError(error);
		});

	availabilityPromise = promise;
	return promise;
}

export async function getCsrfToken(): Promise<{ token: string; expiresAt: number }> {
	try {
		const response = await fetch(`${BASE_URL}/public/csrf`);
		return await parseEnvelope(response);
	} catch (error) {
		throw normalizeError(error);
	}
}

/** Never retried -- a retried reservation POST could double-submit. */
export async function createReservation(payload: CreateReservationDto): Promise<ReserveResponseDto> {
	try {
		const response = await fetch(`${BASE_URL}/public/reserve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		return await parseEnvelope<ReserveResponseDto>(response);
	} catch (error) {
		throw normalizeError(error);
	}
}
