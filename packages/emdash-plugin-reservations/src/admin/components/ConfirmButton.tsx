import { useState } from "react";
import { Button, Dialog } from "@cloudflare/kumo";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "secondary-destructive" | "outline";

interface ConfirmButtonProps {
	label: string;
	confirmTitle: string;
	confirmDescription: string;
	variant?: ButtonVariant;
	onConfirm: () => Promise<void>;
	onError?: (message: string) => void;
}

/** Generic confirm-then-act wrapper (Kumo `Dialog` + `Button`) -- replaces Block Kit's
 * `ButtonElement.confirm`, used for Delete and Cancel actions (ADMIN_SPEC §4/§5). Dialog
 * stays open on failure so the user sees what happened via `onError` instead of the dialog
 * just vanishing. */
export function ConfirmButton({ label, confirmTitle, confirmDescription, variant = "destructive", onConfirm, onError }: ConfirmButtonProps) {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleConfirm() {
		setLoading(true);
		try {
			await onConfirm();
			setOpen(false);
		} catch (error) {
			onError?.(error instanceof Error ? error.message : String(error));
		} finally {
			setLoading(false);
		}
	}

	return (
		<Dialog.Root role="alertdialog" open={open} onOpenChange={setOpen}>
			<Dialog.Trigger render={(props) => (
				<Button variant={variant} {...props}>
					{label}
				</Button>
			)} />
			<Dialog className="p-6">
				<Dialog.Title>{confirmTitle}</Dialog.Title>
				<Dialog.Description>{confirmDescription}</Dialog.Description>
				<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
					<Dialog.Close render={(props) => (
						<Button variant="secondary" {...props}>
							Cancel
						</Button>
					)} />
					<Button variant={variant} loading={loading} onClick={handleConfirm}>
						{label}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
