import { useEffect, useState } from "react";
import { Banner } from "@cloudflare/kumo";
import { ReservationForm, type ReservationFormValues } from "../components/ReservationForm";
import { getReservationDetail, updateReservation } from "../api";

interface EditViewProps {
	id: string;
	onSaved: (id: string) => void;
	onCancel: () => void;
}

/** Only reachable for active reservations (DetailView only shows Edit when
 * `!fromHistory`) -- history rows aren't editable (ADMIN_SPEC §4). Moving to a different
 * slot re-keys the record server-side; a collision surfaces as a banner in the shared
 * `ReservationForm`, leaving the existing data untouched. */
export function EditView({ id, onSaved, onCancel }: EditViewProps) {
	const [initial, setInitial] = useState<ReservationFormValues | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		getReservationDetail(id, false)
			.then((result) => {
				if (!result.ok) {
					setError(result.message);
					return;
				}
				const detail = result.data;
				setInitial({
					date: detail.date,
					startTime: detail.startTime,
					name: detail.name,
					email: detail.email,
					phone: detail.phone ?? "",
					note: detail.note ?? "",
					status: detail.status === "cancelled" ? "confirmed" : detail.status,
				});
			})
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, [id]);

	async function handleSubmit(values: ReservationFormValues) {
		const result = await updateReservation(id, {
			date: values.date,
			startTime: values.startTime,
			name: values.name,
			email: values.email,
			phone: values.phone || undefined,
			note: values.note || undefined,
			status: values.status,
		});
		if (!result.ok) throw new Error(result.message);
		onSaved(result.data.id);
	}

	if (error) return <Banner variant="error" title="Couldn't load reservation" description={error} />;
	if (!initial) return <div>Loading…</div>;

	return (
		<div>
			<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Edit reservation</h2>
			<ReservationForm initial={initial} submitLabel="Save changes" onSubmit={handleSubmit} onCancel={onCancel} />
		</div>
	);
}
