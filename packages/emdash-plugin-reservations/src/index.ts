import type { PluginDescriptor } from "emdash";

export function reservationsPlugin(): PluginDescriptor {
	return {
		id: "reservations",
		version: "0.2.0",
		format: "native",
		entrypoint: "@emdash-reservations/plugin-reservations/runtime",
		adminEntry: "@emdash-reservations/plugin-reservations/admin",
		capabilities: ["email:send"],
		// This emdash version's PluginDescriptor only supports flat single-field indexes
		// (no composite tuples) -- availability queries filter by `date` and sort
		// slotKey/startTime in memory instead of relying on a composite index.
		storage: {
			reservations: {
				indexes: ["date", "status", "email", "createdAt"],
			},
			reservations_history: {
				indexes: ["date", "status", "email", "createdAt"],
			},
		},
		adminPages: [{ path: "/reservations", label: "Reservations", icon: "calendar" }],
	};
}
