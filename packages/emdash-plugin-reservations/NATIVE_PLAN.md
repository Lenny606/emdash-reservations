# Implementační plán: Přechod na native formát + plný admin (React)

Realizuje [NATIVE_SPEC.md](./NATIVE_SPEC.md). Nahrazuje [ADMIN_PLAN.md](./ADMIN_PLAN.md) (Block Kit admin se nedokončuje). Fáze řazené tak, aby po každé byl web funkční a testovatelný — veřejná strana (`/reservations`, `public/*` routy) musí zůstat funkční po celou dobu, mění se jen v obálce (routa signatura), nikdy v logice.

## Fáze N0 — Živé ověření předpokladů (před přepisem čehokoliv)

NATIVE_SPEC §2 a §9 (NT-1, NT-2, NT-3) jsou ověřené jen staticky (typy v `.d.mts`). Tahle fáze je jediná, kde se něco ověřuje experimentálně přímo v běžícím `npx emdash dev`, na co nejmenším možném kódu — než se do rewrite investuje čas.

- [ ] Minimální native descriptor: `format: "native"`, `entrypoint` na triviální `createPlugin()` vracející `definePlugin({ id, version, hooks: {}, routes: {} })` (žádné skutečné routy/hooky zatím) — ověřit, že `npx emdash dev` nastartuje a plugin je `active` v `/_emdash/api/admin/plugins`, stejně jako dnes se standard formátem.
- [ ] Přidat `adminEntry` s `pages: { "/reservations": () => <div>hello native</div> }` (inline, ne ještě reálná stránka) — ověřit, že se na `/_emdash/admin/plugins/reservations/reservations` fakticky vykreslí React, ne chyba/404 (NT-1).
- [ ] Přidat jednu neveřejnou native routu (`ping: async (ctx) => ({ ok: true, hasSession: !!ctx.??? })`) a zavolat ji z té inline stránky přes `apiFetch` z `@emdash-cms/admin` — ověřit auth/session chování (NT-2): projde nepřihlášený fetch? Jaká je skutečná URL (`/_emdash/api/plugins/reservations/ping`, dle CLAUDE.md konvence — ověřit, ne předpokládat)?
- [ ] Stejná routa jako GET s query parametrem + `input:` Zod schema — ověřit, jestli GET/`input:` bug z PLAN.md fáze 3 platí i pro native dispatcher (NT-3). Bez ohledu na výsledek zůstává NATIVE_SPEC §4 rozhodnutí (všechny admin routy POST), tohle je jen pro přesnost dokumentace/budoucí rozhodování.
- [ ] Zjištění zapsat do NATIVE_SPEC.md §2 jako doplněk (styl PLAN fáze 0/N0-* položky) — smaž nejistoty formulované jako "ověřit" a nahraď zjištěným chováním.
- [ ] Smazat/zahodit provizorní kód této fáze (byl jen na ověření, ne finální implementace).

## Fáze N1 — Descriptor a runtime scaffold ✅ (2026-07-18)

- [x] `package.json`: `exports."."`, `"./runtime"` (přejmenováno z `"./sandbox"`), `"./admin"` (nové); `peerDependencies` doplnit `react`, `react-dom` (19.2.4), `@cloudflare/kumo` (2.6.0); `devDependencies` doplnit `@types/react` (19.2.17), `@types/react-dom` (19.2.3).
- [x] `src/index.ts`: `format: "native"`, `entrypoint` → `.../runtime`, `adminEntry` → `.../admin`, verze bump na `0.2.0`.
- [x] `src/sandbox-entry.ts` → přejmenováno na `src/runtime.ts`; export přepsán z `satisfies SandboxedPlugin` objektu na **pojmenovaný** `export function createPlugin()` vracející `definePlugin({...})` — **ne `export default`**, viz NATIVE_SPEC N0-8 (shodilo by celý web, ověřeno na POC).
- [x] Přepsána signatura **existujících** rout (`public/csrf`, `public/availability`, `public/reserve`) z `(routeCtx, ctx)` na `(ctx)`; smazán `readRequestMeta` helper (nahrazeno přímým `ctx.requestMeta`); `public/availability` beze změny v logice parsování query stringu.
- [x] Hooks (`plugin:install` atd.) — přesunuty beze změny obsahu.
- [x] Smazána `admin` routa ze `runtime.ts` a `buildAdminPageBlocks`/`saveSettingsFromForm`/`confirmReservation`/`cancelReservation` — přesunou se a přepíšou v N2/N6 do `server/admin-api.ts`. `server/admin-ui.ts` (Block Kit block buildery) zůstává v repu nepoužité až do smazání v N3.
- [x] **Odchylka od plánu (bezpečnostní opatření):** `src/admin/index.tsx` vytvořen už teď jako minimální placeholder (`export const pages = { "/reservations": () => <div>...</div> }`), ne až v N3. Důvod: `adminEntry` v descriptoru odkazuje na modul, který musí existovat, jinak hrozí stejný typ pádu celého webu jako u POC nálezu N0-8 (tentokrát by šlo o nenalezitelný import místo špatného tvaru exportu, ale riziko je stejné — ověřeno, že modul musí reálně existovat). N3 tento placeholder nahradí skutečným obsahem, needeleguje se nic navíc.
- [x] **Ověření:** `npx astro dev` (background) startuje bez chyb; `pnpm exec astro check` 0 chyb/varování/hints; `/reservations` funguje beze změny (Playwright: procházení týdnů, výběr slotu, odeslání rezervace → "Your reservation request has been sent", slot se zobrazí jako obsazený); `/_emdash/admin/plugins/reservations/reservations` vykreslí placeholder React stránku bez pádu webu (ověřeno přes dev-bypass + Playwright snapshot, 0 console errors).

## Fáze N2 — Admin API vrstva (server, bez UI)

- [ ] `shared/dto.ts`: `AdminListFilterDto`, `AdminUpsertReservationDto` (Zod, dle NATIVE_SPEC §6).
- [ ] `server/mappers.ts`: `toAdminDetailDto(r)`, `toAdminSummaryDto(r)`, `fromAdminUpsert(dto, existing?)`.
- [ ] `server/validation.ts`: sdílet sanitizaci/business validaci mezi veřejnou cestou a `AdminUpsertReservationDto` — admin výjimky (bez `maxDaysAhead`, bez `enabled`, otevírací doba + aktivní dny platí, ADMIN_SPEC §9.1).
- [ ] Nový `server/admin-api.ts` — čisté funkce nesoucí logiku (žádné Block Kit): `getSettings`, `saveSettings`, `getOverview`, `listReservations(filter)`, `getReservationDetail(id, fromHistory)`, `confirmReservation`, `cancelReservation` (+ `notifyCancellation`, viz N6), `deleteReservation`, `createReservation`, `updateReservation` (re-key logika z ADMIN_SPEC §5 Upravit).
- [ ] `src/runtime.ts`: nové routy `admin/settings-get`, `admin/settings-save`, `admin/overview`, `admin/reservations-list`, `admin/reservation-detail`, `admin/reservation-confirm`, `admin/reservation-delete`, `admin/reservation-create`, `admin/reservation-update` — všechny POST, žádná `public: true`, tenké wrappery nad `server/admin-api.ts` (routa = parsování inputu + volání funkce + log mutace přes `ctx.log.info`).
- [ ] `admin/reservation-cancel` zatím **bez** notifikace (placeholder, doplní N6) — jen mechanika přesunu do historie (existující `cancelReservation` logika z fáze 5, přenesená beze změny).
- [ ] **Ověření:** každá routa ručně přes `curl` s admin cookie (nebo dočasný test skript) — request/response tvar odpovídá DTO; typecheck prochází.

## Fáze N3 — Admin shell + Settings view (barvy)

Tahle fáze doručuje původní zadání práce (živý náhled barvy) jako první viditelný výstup.

- [ ] `src/admin/index.tsx` — nahradit N1 placeholder skutečným `export const pages = { "/reservations": ReservationsAdminPage }`.
- [ ] `src/admin/ReservationsAdminPage.tsx` — kostra s `useState` view-routerem (NATIVE_SPEC §5.2), zatím jen `"settings"` view aktivní, ostatní placeholder.
- [ ] `src/admin/api.ts` — typovaný fetch wrapper nad `admin/*` routami (base URL ověřená v N0), Zod parse odpovědí, jednotné chybové zpracování (toast přes Kumo `toast`).
- [ ] `src/admin/components/ColorField.tsx` — dle NATIVE_SPEC §5.3.
- [ ] `src/admin/views/SettingsView.tsx` — formulář nastavení (enabled toggle, opening/closing time, active days, maxDaysAhead, autoConfirm, 4× `ColorField`, captchaPluginId, notifyEnabled, notifyEmail) — Kumo `Input`/`Switch`/`Select` + `Button` submit → `admin/settings-save`.
- [ ] Smazat `server/admin-ui.ts` (Block Kit block buildery, teď nepoužívané — settings část nahrazena, zbytek mizí v N4/N5).
- [ ] **Ověření (uživatel testuje sám dle feedback preference):** `/_emdash/admin/plugins/reservations/reservations` zobrazí formulář nastavení, změna barvy v color pickeru se okamžitě promítne do náhledu, uložení projeví změnu na `/reservations` po refresh.

## Fáze N4 — Seznam + Detail

- [ ] `src/admin/views/ListView.tsx` — filtr formulář (status, období, e-mail, přepínač stornované), Kumo `Table` + `Pagination`, řádek → `onSelect(id)` přepne view na `"detail"`.
- [ ] `src/admin/views/DetailView.tsx` — všechna pole `AdminReservationDetailDto` (včetně PII/meta), akční tlačítka podle stavové matice (ADMIN_SPEC §4): Potvrdit / Upravit / Stornovat / Smazat / Zpět.
- [ ] `src/admin/components/ConfirmButton.tsx` — Kumo `Dialog` + `Button`, generický wrapper pro akce vyžadující potvrzení (Smazat, Storno) — nahrazuje `ButtonElement.confirm`.
- [ ] `src/admin/components/StatCards.tsx` — `admin/overview` čísla, zobrazit nad `ListView`.
- [ ] Napojit `ReservationsAdminPage` navigaci: `list ⇄ detail`, filtr/cursor se drží v React state (žádné serializování do URL, NATIVE_SPEC §5.2).
- [ ] **Ověření:** filtrace, stránkování, přepnutí na stornované, proklik do detailu a zpět se zachováním pozice seznamu (real React state, ne round-trip jako ADMIN_PLAN A1 popisoval pro Block Kit).

## Fáze N5 — Editace + Ruční vytvoření

- [ ] `src/admin/components/ReservationForm.tsx` — sdílený formulář pro Edit i Create (datum, čas, jméno, e-mail, telefon, poznámka, status).
- [ ] `src/admin/views/EditView.tsx` — předvyplněný `ReservationForm`, submit → `admin/reservation-update`; kolize nového slotu → `banner` v místě (beze změny dat), stejná re-key mechanika jako ADMIN_SPEC §5 Upravit.
- [ ] `src/admin/views/CreateView.tsx` — prázdný `ReservationForm`, default status `confirmed`, submit → `admin/reservation-create`.
- [ ] Notifikace při ručním vytvoření: `notifyNewReservation` větev pro zákazníka (ADMIN_SPEC §6) — `notifyEnabled` guard.
- [ ] **Ověření:** editace kontaktů, přesun na volný slot (starý se uvolní, nový obsadí v kalendáři), kolize při přesunu na obsazený slot, vytvoření na volný slot i mimo `maxDaysAhead`/při vypnutých veřejných rezervacích.

## Fáze N6 — Smazání + Storno s notifikací

- [ ] `admin/reservation-delete` napojit na `DetailView` (Smazat, s `ConfirmButton`) — tvrdý delete z aktivních i historie.
- [ ] `server/notifications.ts`: `notifyCancellation(ctx, r)` + `renderCancellationEmail(r)` čistá šablona (ADMIN_SPEC §6); pokud v projektu ještě není vitest (PLAN fáze 6 poznámka), zavést pro šablony (`renderCancellationEmail`, `renderConfirmationEmail`) — čisté funkce, snadno testovatelné bez `ctx`.
- [ ] `admin/reservation-cancel` doplnit o volání `notifyCancellation` (fire-and-forget, stejný vzor jako `notifyStatusChange`).
- [ ] Napojit Storno tlačítko v `DetailView` s `ConfirmButton`.
- [ ] **Ověření:** storno pending i confirmed rezervace — slot se v kalendáři okamžitě uvolní, záznam v historii, log obsahuje pokus o notifikaci; opakované storno stejného id ⇒ chybový banner.

## Fáze N7 — Průchod celku a úklid dokumentace

- [ ] End-to-end scénář: veřejná rezervace → detail v adminu → potvrzení → přesun slotu (edit) → storno → smazání z historie; kontrola kalendáře na webu po každém kroku.
- [ ] Kontrola, že žádná admin data (PII, meta) neprosakují do veřejných rout (`public/availability` response) — beze změny oproti dnešku, jen re-verify po refactoru.
- [ ] `ADMIN_PLAN.md` a `ADMIN_SPEC.md`: přidat hlavičkovou poznámku "Nahrazeno NATIVE_SPEC.md/NATIVE_PLAN.md — Block Kit admin se nedokončil, přepsáno na native React." (soubory zůstávají jako historický záznam rozhodnutí, nemažou se).
- [ ] `PLAN.md` fáze 5 (Block Kit admin): podobná poznámka o nahrazení.
- [ ] `NPM_SPEC.md`: aktualizovat zmínky `format: "standard"` → `"native"`; §1 tabulka (distribuční model) — ověřit, že "Trusted, in-process" zdůvodnění platí beze změny (mělo by, native to jen formalizuje, NATIVE_SPEC §1); §4 kontrakt `package.json` přepsat na nový tvar exports/peerDependencies z NATIVE_SPEC §7.
- [ ] `README.md` (pokud existuje uživatelská dokumentace admin sekce) — aktualizovat popis admin UI (React stránka místo Block Kit formuláře).
- [ ] Smazat mrtvý kód: cokoliv v `server/admin-ui.ts` pozůstatky, nepoužívané Block Kit importy (`@emdash-cms/blocks` zůstává jako dependency jen pokud se plánuje `fieldWidgets`/`portableTextBlocks` v budoucnu — jinak zvážit odstranění, viz NATIVE_SPEC §7 poznámka).
