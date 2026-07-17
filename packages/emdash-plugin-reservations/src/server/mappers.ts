import type { CreateReservationDto, SlotDto, SlotStatus, ReservationListItemDto } from "../shared/dto";
import { parseSlotKey } from "../shared/slots";
import type { Reservation } from "./model";

export interface ReservationMeta {
	ipHash?: string;
	userAgent?: string;
	requestNonce?: string;
}

export function toReservation(
	dto: CreateReservationDto,
	meta: ReservationMeta,
	now: string,
	status: "pending" | "confirmed",
): Reservation {
	const { date, time } = parseSlotKey(dto.slotKey);
	return {
		id: dto.slotKey,
		slotKey: dto.slotKey,
		date,
		startTime: time,
		durationMinutes: 30,
		name: dto.name,
		email: dto.email,
		phone: dto.phone,
		note: dto.note,
		status,
		createdAt: now,
		updatedAt: now,
		meta,
	};
}

export function toSlotDto(slotKey: string, date: string, startTime: string, status: SlotStatus): SlotDto {
	return { slotKey, date, startTime, status };
}

export function toListItemDto(id: string, reservation: Reservation): ReservationListItemDto {
	return {
		id,
		slotKey: reservation.slotKey,
		date: reservation.date,
		startTime: reservation.startTime,
		name: reservation.name,
		email: reservation.email,
		phone: reservation.phone,
		note: reservation.note,
		status: reservation.status,
		createdAt: reservation.createdAt,
	};
}
