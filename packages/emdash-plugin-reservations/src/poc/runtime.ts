import { definePlugin } from "emdash";
import { z } from "astro/zod";

/**
 * NATIVE_PLAN Fáze N0 — jednorázový experiment, ne finální kód.
 * Ověřuje: (1) native descriptor + createPlugin() nastartuje, (2) adminEntry
 * skutečně vykreslí React, (3) auth chování nepublic routy, (4) GET + input:
 * Zod chování u native dispatcheru. Po zápisu zjištění do NATIVE_SPEC.md se
 * tento adresář (src/poc/) maže.
 */
// POZOR (zjištění N0): emdash 0.28.1 generuje `import { createPlugin } from entrypoint`
// (dist/astro/index.mjs:1159) -- vyžaduje POJMENOVANÝ export. `export default` docs
// zmiňují jako alternativu, ale tato verze ho nepodporuje: celý web pak padá na
// "TypeError: createPlugin is not a function" v virtual:emdash/plugins.
export function createPlugin() {
	return definePlugin({
		id: "reservations-native-poc",
		version: "0.0.1",
		routes: {
			// POST varianta — očekávaná finální podoba admin rout dle NATIVE_SPEC §4.
			ping: {
				input: z.object({ echo: z.string().optional() }),
				handler: async (ctx) => {
					return {
						ok: true,
						method: ctx.request.method,
						echo: ctx.input?.echo ?? null,
						hasRequestMeta: ctx.requestMeta != null,
						requestMetaKeys: ctx.requestMeta ? Object.keys(ctx.requestMeta) : [],
					};
				},
			},
			// GET + input: varianta — ověřuje NT-3 (GET/input: bug z PLAN.md fáze 3).
			"ping-get": {
				input: z.object({ echo: z.string() }),
				handler: async (ctx) => {
					const url = new URL(ctx.request.url);
					return {
						ok: true,
						method: ctx.request.method,
						inputEcho: ctx.input?.echo ?? null,
						queryEcho: url.searchParams.get("echo"),
					};
				},
			},
		},
	});
}
