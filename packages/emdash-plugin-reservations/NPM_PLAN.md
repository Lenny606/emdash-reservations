# Implementační plán: NPM balíček „Reservations"

Realizuje [NPM_SPEC.md](./NPM_SPEC.md). Startuje až po dokončení implementace pluginu (PLAN.md fáze 1–7). Rizika a zdůvodnění rozhodnutí jsou ve specifikaci — tady jsou jen kroky.

## Fáze N0 — Rozhodnutí (blokuje vše ostatní)

Čtyři otevřená rozhodnutí z NPM_SPEC §2 — vyžadují vstup vlastníka:

- [ ] Jméno balíčku (+ ověřit dostupnost: `npm view <name>`).
- [ ] Licence.
- [ ] Repozitář (pole `repository`/`bugs`/`homepage`).
- [ ] Zdroj Zod (default: ponechat `astro/zod`).

Výstup: aktualizovaná NPM_SPEC §2 s finálními hodnotami; přejmenování propsat do descriptor `entrypoint`, importů webu a `pnpm-workspace` dependency.

## Fáze N1 — Build pipeline

- [ ] Dev dependency `tsdown`.
- [ ] `tsdown.config.ts`: entry `index` + `sandbox-entry`; `format: "esm"`, `dts: true`; `external: ["emdash", "emdash/plugin", "astro", "astro/zod"]`.
- [ ] Ověřit omezení NPM_SPEC §3: descriptor (`index.ts`) neimportuje nic ze `shared/`/`server/`; `ReservationCalendar.astro` importuje klienta relativní cestou (ne package self-reference).
- [ ] Scripts: `"build": "tsdown"`, `"prepublishOnly": "pnpm build"`.
- [ ] **Brána (NPM_SPEC §7.1):** `pnpm build` → `dist/` obsahuje `index.js`, `index.d.ts`, `sandbox-entry.js`, `sandbox-entry.d.ts`.

## Fáze N2 — package.json pro publikaci

- [ ] Přepsat `package.json` přesně dle kontraktu NPM_SPEC §4 (name/license z N0, exports s `types`/`import`, `files` whitelist, peers `emdash >=0.28.1 <0.29.0` + `astro ^7`, `sideEffects: false`, `engines.node >=20`).
- [ ] Zkontrolovat, že se nebalí interní dokumenty a testy (SPEC/PLAN/NPM_SPEC/NPM_PLAN, `*.test.ts`).
- [ ] **Brána (NPM_SPEC §7.2):** `pnpm publish --dry-run` — obsah tarballu odpovídá `files` položku po položce.

## Fáze N3 — README.md

- [ ] Sepsat README s povinným obsahem dle NPM_SPEC §6 (instalace/registrace, setup stránky, tabulka nastavení, integrační kontrakty captcha + e-mail, bezpečnostní model, kompatibilita).
- [ ] Založit `CHANGELOG.md` (`0.1.0` — initial release).

## Fáze N4 — Verifikace mimo workspace (izolační brána)

- [ ] `pnpm pack` → tarball.
- [ ] Čistý EmDash starter mimo workspace (`/tmp/.../emdash-npm-test`), `npm install <tarball>`, registrace v `astro.config.mjs` dle README (README je tím pádem také testovaný).
- [ ] Celý verifikační scénář z PLAN fáze 7: dev server startuje, plugin aktivní, kalendář renderuje, rezervace end-to-end, admin stránka funguje.
- [ ] `astro check` v testovacím webu (typy z `.d.ts` pro descriptor i komponentu).
- [ ] `astro build` testovacího webu projde.
- [ ] **Brána (NPM_SPEC §7.3):** vše výše zelené → git tag verze.

## Fáze N5 — Publikace

- [ ] `npm login` (u scoped balíčku publish s `--access public`).
- [ ] `pnpm publish` (spustí `prepublishOnly` build); z CI s `--provenance`.
- [ ] Ověřit publikovanou verzi: `npm install <name>@0.1.0` v testovacím projektu z N4.
- [ ] Tento repozitář ponechat na `workspace:*` (vývojové prostředí pluginu, NPM_SPEC §1).

## Údržbový cyklus po publikaci

Při každém rozšíření podporovaného rozsahu emdash (NPM_SPEC §5):

1. Zopakovat ověření tvaru API proti novému `node_modules/emdash` (obdoba PLAN fáze 0).
2. Projít izolační bránu N4 s novou verzí emdash ve starteru.
3. Zvednout minor verzi balíčku + zapsat do CHANGELOG a README kompatibility.
