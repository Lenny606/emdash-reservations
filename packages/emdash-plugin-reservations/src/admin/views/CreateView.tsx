import { ReservationForm, type ReservationFormValues } from "../components/ReservationForm";
import { createReservation } from "../api";

const EMPTY: ReservationFormValues = { date: "", startTime: "", name: "", email: "", phone: "", note: "", status: "confirmed" };

interface CreateViewProps {
	onCreated: (id: string) => void;
	onCancel: () => void;
}

/** Bypasses the public security pipeline and `maxDaysAhead`/`enabled` gate -- opening
 * hours and active days still apply (ADMIN_SPEC §5 Vytvořit, enforced server-side in
 * `admin-api.ts`'s `createReservation`). Default status `confirmed`: the admin is
 * arranging the slot directly, not waiting for a pending request to review. */
export function CreateView({ onCreated, onCancel }: CreateViewProps) {
	async function handleSubmit(values: ReservationFormValues) {
		const result = await createReservation({
			date: values.date,
			startTime: values.startTime,
			name: values.name,
			email: values.email,
			phone: values.phone || undefined,
			note: values.note || undefined,
			status: values.status,
		});
		if (!result.ok) throw new Error(result.message);
		onCreated(result.data.id);
	}

	return (
		<div>
			<h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>New reservation</h2>
			<ReservationForm initial={EMPTY} submitLabel="Create" onSubmit={handleSubmit} onCancel={onCancel} />
		</div>
	);
}
