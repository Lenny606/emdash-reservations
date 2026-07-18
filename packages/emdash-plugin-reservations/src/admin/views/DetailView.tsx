import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button } from "@cloudflare/kumo";
import { ConfirmButton } from "../components/ConfirmButton";
import { cancelReservation, confirmReservation, deleteReservation, getReservationDetail } from "../api";
import type { AdminReservationDetailDto } from "../../shared/dto";

const STATUS_BADGE: Record<AdminReservationDetailDto["status"], "warning" | "success" | "neutral"> = {
	pending: "warning",
	confirmed: "success",
	cancelled: "neutral",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div>
			<div style={{ fontSize: 13, color: "var(--kumo-subtle, #6b7280)" }}>{label}</div>
			<div>{value || <span style={{ color: "var(--kumo-subtle, #6b7280)" }}>—</span>}</div>
		</div>
	);
}

interface DetailViewProps {
	id: string;
	fromHistory: boolean;
	onBack: () => void;
	onEdit: (id: string) => void;
}

/** Action matrix by status (ADMIN_SPEC §4): Confirm only for `pending`; Edit/Cancel only
 * for active (non-history) reservations; Delete and Back are always available. */
export function DetailView({ id, fromHistory, onBack, onEdit }: DetailViewProps) {
	const [detail, setDetail] = useState<AdminReservationDetailDto | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		setLoading(true);
		setError(null);
		getReservationDetail(id, fromHistory)
			.then((result) => {
				if (!result.ok) {
					setError(result.message);
					setDetail(null);
				} else {
					setDetail(result.data);
				}
			})
			.catch((err) => setError(err instanceof Error ? err.message : String(err)))
			.finally(() => setLoading(false));
	}, [id, fromHistory]);

	useEffect(load, [load]);

	async function handleConfirm() {
		const result = await confirmReservation(id);
		if (!result.ok) throw new Error(result.message);
		setDetail(result.data);
	}

	async function handleCancel() {
		const result = await cancelReservation(id);
		if (!result.ok) throw new Error(result.message);
		onBack();
	}

	async function handleDelete() {
		const result = await deleteReservation(id, fromHistory);
		if (!result.ok) throw new Error(result.message);
		onBack();
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560 }}>
			<Button variant="ghost" onClick={onBack} style={{ alignSelf: "flex-start" }}>
				← Back to list
			</Button>

			{loading && <div>Loading…</div>}
			{error && <Banner variant="error" title="Couldn't load reservation" description={error} />}

			{detail && (
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<h2 style={{ fontSize: 18, fontWeight: 600 }}>
							{detail.date} {detail.startTime}
						</h2>
						<Badge variant={STATUS_BADGE[detail.status]}>{detail.status}</Badge>
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
						<Field label="Name" value={detail.name} />
						<Field label="Email" value={detail.email} />
						<Field label="Phone" value={detail.phone} />
						<Field label="Note" value={detail.note} />
						<Field label="Created" value={new Date(detail.createdAt).toLocaleString()} />
						<Field label="Updated" value={new Date(detail.updatedAt).toLocaleString()} />
						<Field label="IP hash" value={detail.meta.ipHash} />
						<Field label="User agent" value={detail.meta.userAgent} />
					</div>

					<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
						{detail.status === "pending" && (
							<Button
								variant="primary"
								onClick={() => handleConfirm().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
							>
								Confirm
							</Button>
						)}
						{!fromHistory && (
							<Button variant="secondary" onClick={() => onEdit(id)}>
								Edit
							</Button>
						)}
						{!fromHistory && (
							<ConfirmButton
								label="Cancel reservation"
								confirmTitle="Cancel this reservation?"
								confirmDescription={`${detail.date} ${detail.startTime} — ${detail.name}. The slot will be freed and the reservation moved to history.`}
								variant="secondary-destructive"
								onConfirm={handleCancel}
								onError={setError}
							/>
						)}
						<ConfirmButton
							label="Delete"
							confirmTitle="Delete this reservation?"
							confirmDescription="This permanently removes the record. This cannot be undone."
							variant="destructive"
							onConfirm={handleDelete}
							onError={setError}
						/>
					</div>
				</>
			)}
		</div>
	);
}
