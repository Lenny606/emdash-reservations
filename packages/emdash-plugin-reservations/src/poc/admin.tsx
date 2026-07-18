import { useState } from "react";
import { apiFetch, API_BASE } from "@emdash-cms/admin";

/**
 * NATIVE_PLAN Fáze N0 — jednorázový experiment, viz runtime.ts.
 */
function NativePocPage() {
	const [log, setLog] = useState<string[]>([]);
	const [color, setColor] = useState("#22c55e");

	function append(line: string) {
		setLog((prev) => [...prev, line]);
	}

	async function runPost() {
		try {
			const res = await apiFetch(`${API_BASE}/plugins/reservations-native-poc/ping`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ echo: "hello" }),
			});
			append(`POST ping -> ${res.status} ${JSON.stringify(await res.json())}`);
		} catch (err) {
			append(`POST ping -> ERROR ${String(err)}`);
		}
	}

	async function runGet() {
		try {
			const res = await apiFetch(`${API_BASE}/plugins/reservations-native-poc/ping-get?echo=world`, {
				method: "GET",
			});
			append(`GET ping-get -> ${res.status} ${JSON.stringify(await res.json())}`);
		} catch (err) {
			append(`GET ping-get -> ERROR ${String(err)}`);
		}
	}

	return (
		<div style={{ padding: 24, fontFamily: "monospace" }}>
			<h1>Native POC (Fáze N0)</h1>
			<p>Pokud vidíš tenhle text jako vykreslenou React stránku, adminEntry funguje (NT-1 vyřešeno).</p>

			<div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
				<input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
				<input value={color} onChange={(e) => setColor(e.target.value)} />
				<span>živý náhled color inputu (NATIVE_SPEC §5.3 ověření)</span>
			</div>

			<div style={{ display: "flex", gap: 8 }}>
				<button onClick={runPost}>Test POST ping</button>
				<button onClick={runGet}>Test GET ping-get (query + input:)</button>
			</div>

			<pre style={{ marginTop: 16, background: "#111", color: "#0f0", padding: 12, whiteSpace: "pre-wrap" }}>
				{log.join("\n")}
			</pre>
		</div>
	);
}

export const pages = {
	"/poc": NativePocPage,
};
