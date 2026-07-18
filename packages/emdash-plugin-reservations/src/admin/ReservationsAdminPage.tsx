import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import { SettingsView } from "./views/SettingsView";

type View = "list" | "create" | "settings";

const NAV: Array<{ view: View; label: string }> = [
	{ view: "list", label: "Reservations" },
	{ view: "create", label: "New reservation" },
	{ view: "settings", label: "Settings" },
];

function ComingSoon({ label }: { label: string }) {
	return <div style={{ color: "var(--kumo-subtle, #6b7280)" }}>{label} is coming in a later phase (NATIVE_PLAN N4/N5).</div>;
}

export function ReservationsAdminPage() {
	// Plain useState view-router (NATIVE_SPEC §5.2) -- no Block Kit action_id encoding,
	// no URL sync (nice-to-have, out of scope for v1). Only "settings" is real in N3;
	// "list"/"create" become real views in N4/N5.
	const [view, setView] = useState<View>("settings");

	return (
		<div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
			<h1 style={{ fontSize: 20, fontWeight: 600 }}>Reservations</h1>
			<nav style={{ display: "flex", gap: 8 }}>
				{NAV.map((item) => (
					<Button
						key={item.view}
						type="button"
						variant={view === item.view ? "primary" : "secondary"}
						onClick={() => setView(item.view)}
					>
						{item.label}
					</Button>
				))}
			</nav>
			{view === "list" && <ComingSoon label="The reservation list" />}
			{view === "create" && <ComingSoon label="Manual reservation creation" />}
			{view === "settings" && <SettingsView />}
		</div>
	);
}
