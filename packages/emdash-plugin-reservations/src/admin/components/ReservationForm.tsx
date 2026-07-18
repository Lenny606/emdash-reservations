import { useState } from "react";
import { Banner, Button, Input, Select, Textarea } from "@cloudflare/kumo";

export interface ReservationFormValues {
	date: string;
	startTime: string;
	name: string;
	email: string;
	phone: string;
	note: string;
	status: "pending" | "confirmed";
}

interface ReservationFormProps {
	initial: ReservationFormValues;
	submitLabel: string;
	onSubmit: (values: ReservationFormValues) => Promise<void>;
	onCancel: () => void;
}

/** Shared by CreateView and EditView (ADMIN_SPEC §5 Vytvořit/Upravit) -- same fields, only
 * the submit handler and initial values differ. */
export function ReservationForm({ initial, submitLabel, onSubmit, onCancel }: ReservationFormProps) {
	const [values, setValues] = useState<ReservationFormValues>(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function patch(partial: Partial<ReservationFormValues>) {
		setValues((prev) => ({ ...prev, ...partial }));
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await onSubmit(values);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
			{error && <Banner variant="error" title="Couldn't save" description={error} />}

			<div style={{ display: "flex", gap: 12 }}>
				<Input label="Date" type="date" required value={values.date} onChange={(event) => patch({ date: event.target.value })} className="flex-1" />
				<Input
					label="Time"
					type="time"
					step={1800}
					required
					value={values.startTime}
					onChange={(event) => patch({ startTime: event.target.value })}
					className="flex-1"
				/>
			</div>

			<Input label="Name" required value={values.name} onChange={(event) => patch({ name: event.target.value })} />
			<Input label="Email" type="email" required value={values.email} onChange={(event) => patch({ email: event.target.value })} />
			<Input label="Phone" value={values.phone} onChange={(event) => patch({ phone: event.target.value })} />
			<Textarea label="Note" rows={3} value={values.note} onChange={(event) => patch({ note: event.target.value })} />
			<Select
				label="Status"
				value={values.status}
				onValueChange={(value) => patch({ status: value as ReservationFormValues["status"] })}
				items={{ pending: "Pending", confirmed: "Confirmed" }}
			/>

			<div style={{ display: "flex", gap: 8 }}>
				<Button type="submit" variant="primary" loading={saving}>
					{submitLabel}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
