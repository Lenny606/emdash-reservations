# Implementační plán: Přechod na native formát + plný admin (React)

Realizuje [NATIVE_SPEC.md](./NATIVE_SPEC.md). Nahrazuje [ADMIN_PLAN.md](./ADMIN_PLAN.md) (Block Kit admin se nedokončuje). Fáze řazené tak, aby po každé byl web funkční a testovatelný — veřejná strana (`/reservations`, `public/*` routy) musí zůstat funkční po celou dobu, mění se jen v obálce (routa signatura), nikdy v logice.

## Fáze N0 — Živé ověření předpokladů (před přepisem čehokoliv) ✅ (2026-07-18)

NATIVE_SPEC §2 a §9 (NT-1, NT-2, NT-3) byly ověřené jen staticky (typy v `.d.mts`); teď živě, na `src/poc/` a na hlavním pluginu po N1.

- [x] Minimální native descriptor + `createPlugin()` — POC `reservations-native-poc` startuje, `active` v `/_emdash/api/admin/plugins`.
- [x] `adminEntry` s `pages: {...}` vykresluje React (NT-1) — ověřeno na POC i na hlavním pluginu po N1 (placeholder stránka, i po studeném restartu).
- [x] Nepublic native routa + `apiFetch` — auth/session ověřeno (NT-2, N0-9): bez session `401`, bez `X-EmDash-Request` header `403 CSRF_REJECTED`, s oběma `200`.
- [x] GET + `input:` Zod schema — NT-3 reprodukováno i na native dispatcheru (N0-10): `400 VALIDATION_ERROR`, dispatcher parsuje JSON tělo bez ohledu na metodu.
- [x] Zjištění zapsána do NATIVE_SPEC.md §2 (N0-8, N0-9, N0-10) a §9 (NT-1/2/3 uzavřeny).
- [ ] Smazat/zahodit provizorní kód této fáze (`src/poc/`) — **záměrně ponecháno zatím**: POC zůstává v repu jako živý referenční příklad, dokud není hlavní native admin (N3+) hotový; smazat až na konci (viz N7 úklid).

## Fáze N1 — Descriptor a runtime scaffold ✅ (2026-07-18)

- [x] `package.json`: `exports."."`, `"./runtime"` (přejmenováno z `"./sandbox"`), `"./admin"` (nové); `peerDependencies` doplnit `react`, `react-dom` (19.2.4), `@cloudflare/kumo` (2.6.0); `devDependencies` doplnit `@types/react` (19.2.17), `@types/react-dom` (19.2.3).
- [x] `src/index.ts`: `format: "native"`, `entrypoint` → `.../runtime`, `adminEntry` → `.../admin`, verze bump na `0.2.0`.
- [x] `src/sandbox-entry.ts` → přejmenováno na `src/runtime.ts`; export přepsán z `satisfies SandboxedPlugin` objektu na **pojmenovaný** `export function createPlugin()` vracející `definePlugin({...})` — **ne `export default`**, viz NATIVE_SPEC N0-8 (shodilo by celý web, ověřeno na POC).
- [x] Přepsána signatura **existujících** rout (`public/csrf`, `public/availability`, `public/reserve`) z `(routeCtx, ctx)` na `(ctx)`; smazán `readRequestMeta` helper (nahrazeno přímým `ctx.requestMeta`); `public/availability` beze změny v logice parsování query stringu.
- [x] Hooks (`plugin:install` atd.) — přesunuty beze změny obsahu.
- [x] Smazána `admin` routa ze `runtime.ts` a `buildAdminPageBlocks`/`saveSettingsFromForm`/`confirmReservation`/`cancelReservation` — přesunou se a přepíšou v N2/N6 do `server/admin-api.ts`. `server/admin-ui.ts` (Block Kit block buildery) zůstává v repu nepoužité až do smazání v N3.
- [x] **Odchylka od plánu (bezpečnostní opatření):** `src/admin/index.tsx` vytvořen už teď jako minimální placeholder (`export const pages = { "/reservations": () => <div>...</div> }`), ne až v N3. Důvod: `adminEntry` v descriptoru odkazuje na modul, který musí existovat, jinak hrozí stejný typ pádu celého webu jako u POC nálezu N0-8 (tentokrát by šlo o nenalezitelný import místo špatného tvaru exportu, ale riziko je stejné — ověřeno, že modul musí reálně existovat). N3 tento placeholder nahradí skutečným obsahem, needeleguje se nic navíc.
- [x] **Ověření:** `npx astro dev` (background) startuje bez chyb; `pnpm exec astro check` 0 chyb/varování/hints; `/reservations` funguje beze změny (Playwright: procházení týdnů, výběr slotu, odeslání rezervace → "Your reservation request has been sent", slot se zobrazí jako obsazený); `/_emdash/admin/plugins/reservations/reservations` vykreslí placeholder React stránku bez pádu webu (ověřeno přes dev-bypass + Playwright snapshot, 0 console errors).
- [x] **Dodatečná oprava po N3 (2026-07-18, N0-12):** uživatel nahlásil, že stránku v adminu "nevidí" -- ukázalo se, že `definePlugin()` v `runtime.ts` chyběl `admin: { entry, pages }` (NT-4 duplikace s descriptorem, kterou si tehdy hlídat měl krok "explicitní diff-check", ale prakticky proveden nebyl). Bez něj byl klientský manifest `adminMode: "none"` -- stránka fungovala na přímou URL, ale sidebar na ni neměl žádný odkaz. Doplněno, ověřeno (`adminMode: "react"`, sidebar má "Plugins → Reservations", proklik funguje).

## Fáze N2 — Admin API vrstva (server, bez UI) ✅ (2026-07-18)

- [x] `shared/dto.ts`: `AdminListFilterDto`, `AdminUpsertReservationDto`, `AdminSettingsUpdateDto`, `AdminReservationIdDto`, `AdminReservationUpdateDto` (Zod); `AdminReservationDetailDto`/`AdminReservationSummaryDto`/`AdminListResponseDto`/`AdminOverviewDto` (plain output types); `AdminActionResult<T>` (viz odchylka níže).
- [x] Mappery `toAdminDetailDto(id, r, fromHistory)`, `toAdminSummaryDto(id, r, fromHistory)` — v `server/admin-api.ts` (ne `server/mappers.ts` — kolokováno s funkcemi, které je jediné volají, žádný jiný spotřebitel).
- [x] `server/validation.ts`: `validateReservationRequest` rozšířena o `ValidateReservationOptions.enforceMaxDaysAhead` (default `true`, zachovává chování veřejné cesty beze změny) — sdílená s adminem přes `{ enforceMaxDaysAhead: false }`. Nový `sanitizeAdminUpsert`.
- [x] Nový `server/admin-api.ts` — `getSettings`, `saveSettings`, `getOverview`, `listReservations(filter)`, `getReservationDetail(id, fromHistory)`, `confirmReservation`, `cancelReservation` (bez notifikace, viz N6), `deleteReservation`, `createReservation`, `updateReservation` (re-key).
- [x] `src/runtime.ts`: routy `admin/settings-get`, `admin/settings-save`, `admin/overview`, `admin/reservations-list`, `admin/reservation-detail`, `admin/reservation-confirm`, `admin/reservation-cancel`, `admin/reservation-delete`, `admin/reservation-create`, `admin/reservation-update` — všechny POST, žádná `public: true`.
- [x] `admin/reservation-cancel` bez notifikace (placeholder, doplní N6) — mechanika přesunu do historie beze změny z fáze 5.
- [x] **Zásadní nález (N0-11, viz NATIVE_SPEC §2):** `throw PluginRouteError` z routy tohoto pluginu nikdy neprojde jako svůj HTTP status — vždy `500`, protože plugin balíček resolvuje `emdash` do jiné pnpm peer-instance než hostitelský dispatcher (`instanceof` napříč hranicí selže). Objeveno při ručním testu kolize slotu. **Oprava:** admin routy vrací `AdminActionResult<T>` (`{ ok, data } \| { ok:false, code, message }`) jako normální `200` odpověď, stejný vzor jako `public/reserve`. `public/availability`'s dva pre-existing throwy zůstávají zatím nedotčené (mimo rozsah N2, zapsáno jako odchylka v PLAN.md).
- [x] **Ověření:** kompletní cyklus přes `curl` s admin session cookie + `X-EmDash-Request` header — settings-get/save (vč. Zod odmítnutí neplatné barvy), overview, list (aktivní i historie), detail, confirm, update s re-key (i kolize → `slot_taken`), cancel (přesun do historie s novým ULID), delete (aktivní i historie, opakované mazání → `not_found`), create (na volný slot i kolize). Typecheck čistý, veřejná strana (`/`, `/reservations`) beze změny po cold restartu.

## Fáze N3 — Admin shell + Settings view (barvy) ✅ (2026-07-18)

Tahle fáze doručuje původní zadání práce (živý náhled barvy) jako první viditelný výstup.

- [x] `src/admin/index.tsx` — nahrazen N1 placeholder skutečným `export const pages = { "/reservations": ReservationsAdminPage }`.
- [x] `src/admin/ReservationsAdminPage.tsx` — kostra s `useState<View>` view-routerem (NATIVE_SPEC §5.2), nav (Kumo `Button`) mezi `list`/`create`/`settings`; jen `"settings"` je reálný view, ostatní dva render `ComingSoon` placeholder (N4/N5).
- [x] `src/admin/api.ts` — typovaný fetch wrapper nad `admin/*` routami přes `apiFetch`+`parseApiResponse` z `@emdash-cms/admin`.
- [x] `src/admin/components/ColorField.tsx` — dle NATIVE_SPEC §5.3, přesně jak spec navrhovala (bare `<input type="color">` + Kumo `Input`).
- [x] `src/admin/views/SettingsView.tsx` — formulář nastavení (enabled `Switch`, opening/closing `Input type="time"`, 7× den `Checkbox`, maxDaysAhead `Input type="number"`, autoConfirm `Switch`, 4× `ColorField`, captchaPluginId/notifyEmail `Input`, notifyEnabled `Switch`) + `Button` submit → `admin/settings-save`.
- [x] Smazán `server/admin-ui.ts` (Block Kit block buildery, nepoužívané od N1).
- [x] **Odchylky od plánu (drobné, implementační):** (1) Aktivní dny jako 7× `Checkbox` (Mon–Sun) místo `Select` s `multiple` — jasnější UX pro týdenní rozvrh, jednodušší na implementaci než ověřovat Select's multi-value kontrakt. (2) Chybové/úspěšné hlášení přes Kumo `Banner` inline ve formuláři, ne `toast` — nebylo ověřené, že host poskytuje `ToastProvider` kontext (POC ho netestoval), `Banner` nepotřebuje žádný kontext. (3) `admin/api.ts` nepoužívá Zod na parsování odpovědí (jen `import type` z `shared/dto.ts`) — sjednoceno se stávající konvencí `client/api-client.ts`, které taky Zod na klientu nepoužívá.
- [x] **Ověření (Playwright, live):** stránka vykreslí formulář se všemi Kumo komponentami stylovanými shodně se zbytkem adminu (screenshot); úprava hex textového pole u „Free" okamžitě mění `value` sousedního `<input type="color">` (ověřeno přes `evaluate`); uložení zobrazí „Saved" banner; po přechodu na `/reservations` je nová barva vidět v `--rsv-free` CSS proměnné (ověřeno `getComputedStyle`) — kompletní round-trip admin → server → veřejná stránka. 0 console chyb, server log bez chyb, typecheck čistý. Testovací barva vrácena zpět na výchozí `#22c55e`.

## Fáze N4 — Seznam + Detail ✅ (2026-07-18)

- [x] `src/admin/views/ListView.tsx` — filtr formulář (status, období, e-mail, přepínač stornované), Kumo `Table`, řádek → `onSelect(id, fromHistory)` přepne view na `"detail"`.
- [x] `src/admin/views/DetailView.tsx` — všechna pole `AdminReservationDetailDto` (včetně PII/meta), akční tlačítka podle stavové matice (ADMIN_SPEC §4): Potvrdit / Upravit / Stornovat / Smazat / Zpět.
- [x] `src/admin/components/ConfirmButton.tsx` — Kumo `Dialog` (role `alertdialog`) + `Button`, generický wrapper pro akce vyžadující potvrzení (Smazat, Storno) — nahrazuje `ButtonElement.confirm`.
- [x] `src/admin/components/StatCards.tsx` — `admin/overview` čísla, zobrazeno nad `ListView`.
- [x] Napojena `ReservationsAdminPage` navigace: `list ⇄ detail`, filtr/cursor se drží v React state (žádné serializování do URL, NATIVE_SPEC §5.2).
- [x] **Odchylka od plánu:** místo Kumo `Pagination` (page-number komponenta) jednoduché tlačítko „Next" nad `cursor`/`hasMore` z `AdminListResponseDto` — storage API nabízí jen dopředné kurzorové stránkování (ADMIN_SPEC §3 to sama předpokládá: "Zpětné stránkování storage API nenabízí"), takže číslovaná `Pagination` komponenta by předstírala možnost, kterou API nemá.
- [x] **Ověření (Playwright, live, přes testovací rezervaci vytvořenou napřímo přes `admin/reservation-create`):** filtrace (status disabled při zapnutém "Show cancelled"), proklik řádku do detailu, Potvrdit (pending→confirmed, tlačítko zmizí), Stornovat (dialog → přesun do historie → návrat na seznam, stat karty se aktualizují), přepnutí "Show cancelled" (historie viditelná, jen tlačítko Smazat dle matice), Smazat z historie (dialog → mizí ze seznamu). 0 console chyb, server log bez chyb po celém cyklu, typecheck čistý.

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
- [ ] Smazat `src/poc/` (native POC, N0) a jeho registraci v `astro.config.mjs` (`reservationsNativePoc()`), a `package.json` exports `./poc`, `./poc-runtime`, `./poc-admin` — sloužil jen k živému ověření N0 předpokladů, teď nahrazeno hlavním pluginem.
