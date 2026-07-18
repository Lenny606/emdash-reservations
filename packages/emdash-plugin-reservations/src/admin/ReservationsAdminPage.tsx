import { useState } from "react";
import { Button } from "@cloudflare/kumo";
import { ListView } from "./views/ListView";
import { DetailView } from "./views/DetailView";
import { CreateView } from "./views/CreateView";
import { EditView } from "./views/EditView";
import { SettingsView } from "./views/SettingsView";

type ViewState =
	| { view: "list" }
	| { view: "detail"; id: string; fromHistory: boolean }
	| { view: "create" }
	| { view: "edit"; id: string }
	| { view: "settings" };

export function ReservationsAdminPage() {
	// Plain useState view-router (NATIVE_SPEC §5.2) -- no Block Kit action_id encoding,
	// no URL sync (nice-to-have, out of scope for v1).
	const [state, setState] = useState<ViewState>({ view: "list" });

	const nav: Array<{ label: string; active: boolean; onClick: () => void }> = [
		{
			label: "Reservations",
			active: state.view === "list" || state.view === "detail",
			onClick: () => setState({ view: "list" }),
		},
		{ label: "New reservation", active: state.view === "create", onClick: () => setState({ view: "create" }) },
		{ label: "Settings", active: state.view === "settings", onClick: () => setState({ view: "settings" }) },
	];

	return (
		<div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
			<h1 style={{ fontSize: 20, fontWeight: 600 }}>Reservations</h1>
			<nav style={{ display: "flex", gap: 8 }}>
				{nav.map((item) => (
					<Button key={item.label} type="button" variant={item.active ? "primary" : "secondary"} onClick={item.onClick}>
						{item.label}
					</Button>
				))}
			</nav>

			{state.view === "list" && (
				<ListView onSelect={(id, fromHistory) => setState({ view: "detail", id, fromHistory })} />
			)}
			{state.view === "detail" && (
				<DetailView
					id={state.id}
					fromHistory={state.fromHistory}
					onBack={() => setState({ view: "list" })}
					onEdit={(id) => setState({ view: "edit", id })}
				/>
			)}
			{state.view === "create" && (
				<CreateView
					onCreated={(id) => setState({ view: "detail", id, fromHistory: false })}
					onCancel={() => setState({ view: "list" })}
				/>
			)}
			{state.view === "edit" && (
				<EditView
					id={state.id}
					onSaved={(id) => setState({ view: "detail", id, fromHistory: false })}
					onCancel={() => setState({ view: "detail", id: state.id, fromHistory: false })}
				/>
			)}
			{state.view === "settings" && <SettingsView />}
		</div>
	);
}
