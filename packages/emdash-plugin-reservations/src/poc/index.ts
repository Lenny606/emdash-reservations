import type { PluginDescriptor } from "emdash";

/**
 * NATIVE_PLAN Fáze N0 — jednorázový experiment, viz runtime.ts.
 */
export function reservationsNativePoc(): PluginDescriptor {
	return {
		id: "reservations-native-poc",
		version: "0.0.1",
		format: "native",
		entrypoint: "@emdash-reservations/plugin-reservations/poc-runtime",
		adminEntry: "@emdash-reservations/plugin-reservations/poc-admin",
		adminPages: [{ path: "/poc", label: "Native POC", icon: "flask" }],
	};
}
