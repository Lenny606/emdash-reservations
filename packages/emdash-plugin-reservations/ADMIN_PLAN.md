# Implementační plán: Správa rezervací v administraci

> **Nahrazeno [NATIVE_SPEC.md](./NATIVE_SPEC.md)/[NATIVE_PLAN.md](./NATIVE_PLAN.md).** Block Kit admin se nedokončil — přepsáno na native React. Tento dokument zůstává jako historický záznam (žádné fáze níže nebyly dokončeny v Block Kit podobě, jen v podobě popsané v NATIVE_PLAN.md).

Realizuje [ADMIN_SPEC.md](./ADMIN_SPEC.md). **Navazuje na dokončenou fázi 5 z [PLAN.md](./PLAN.md)** — základní admin (settings formulář, přehled, read-only tabulka, pending seznam s Confirm/Cancel) existuje a tento plán ho refaktoruje a rozšiřuje. Předpoklad: PLAN.md fáze 1–7 v aktuálním stavu (hotové až na interaktivní ověření uživatelem).

## Fáze A0 — Ověření zbývajících Block Kit možností

Část otázek už zodpověděla fáze 5: `table` blok řádkové akce **nemá** (⇒ `section` + accessory tlačítko), potvrzovací dialog **existuje** (`ButtonElement.confirm`). Zbývá ověřit proti typům v `node_modules/@emdash-cms/blocks`:

- [ ] Předvyplnění formuláře (`initial_value` na všech použitých elementech: `text_input`, `date_input`, `select`) — nutné pro edit pohled.
- [ ] `section` blok s accessory `button` — tvar a chování `value` v `block_action` payloadu; podle toho případně upravit konvenci `<doména>:<akce>:<id>` z ADMIN_SPEC §2.
- [ ] Maximální praktická délka `action_id`/`value` pro serializovaný stav (filtr + cursor v návratové navigaci).

Zjištění zapsat sem (stylem PLAN fáze 0) a promítnout do ADMIN_SPEC.

## Fáze A1 — Router a seznam

- [ ] Refaktor stávajícího `server/admin-ui.ts` a `admin` routy z fáze 5: buildery zůstávají (`buildSettingsFormBlocks`, `buildOverviewBlocks`, …), přibude router pohledů — routa jen parsuje interakci → zavolá doménovou operaci → vrátí bloky pohledu. Stávající `confirm`/`cancel` akce se zapojí do nové konvence beze změny chování.
- [ ] Router interakcí dle konvence `nav:* / rsv:* / list:filter / settings:save` (ADMIN_SPEC §2), včetně round-trip stavu filtru a cursoru; neznámá interakce → `list` (zachovává dnešní fallback chování).
- [ ] Pohled `list`: stats blok, filtr form (`AdminListFilterDto` — status, období, e-mail, „zobrazit stornované"), `section` řádky s accessory „Detail" dle ADMIN_SPEC §3 (nahrazuje dnešní read-only tabulku posledních 50), kurzorové stránkování.
- [ ] Pohled `settings`: přesun stávajícího settings formuláře do vlastního pohledu s navigací.
- [ ] `shared/dto.ts` + `server/mappers.ts`: `AdminListFilterDto`, `AdminReservationDetailDto`, `toAdminDetailDto`.
- [ ] **Ověření:** v admin UI funguje filtrace (status, období, e-mail), stránkování, přepnutí na stornované, uložení nastavení z nového pohledu.

## Fáze A2 — Detail + Potvrdit

- [ ] Pohled `detail` (`fields` bloky, akční tlačítka podle stavu dle ADMIN_SPEC §4), navigace list ⇄ detail se zachováním pozice seznamu.
- [ ] Akce `rsv:confirm:<id>` — `pending → confirmed`, `updatedAt`, toast, návrat na detail; `notifyStatusChange` (fire-and-forget).
- [ ] Log mutace přes `ctx.log.info`.
- [ ] **Ověření:** proklik z řádku do detailu (aktivní i stornovaná rezervace), potvrzení pending rezervace, log obsahuje záznam akce i skip notifikace (transport neexistuje).

## Fáze A3 — Editace + Smazání

- [ ] `AdminUpsertReservationDto` (Zod) + `fromAdminUpsert(dto, existing)`; sdílená sanitizace/business validace z `validation.ts`.
- [ ] Pohled `edit` — předvyplněný formulář; submit `rsv:edit_save:<id>`.
- [ ] Přesun slotu = re-key transakce dle ADMIN_SPEC §5: kolizní check nového `slotKey` → put nového (zachovat `createdAt`) → delete starého; kolize ⇒ `banner` v edit pohledu beze změny dat.
- [ ] Akce `rsv:delete:<id>` s potvrzovacím dialogem — tvrdý delete z aktivních i historie; toast + návrat na seznam.
- [ ] **Ověření:** editace kontaktů, přesun na volný slot (starý slot se v kalendáři uvolní, nový obsadí), pokus o přesun na obsazený slot ⇒ chyba beze změny, smazání z aktivních i historie.

## Fáze A4 — Ruční vytvoření

- [ ] Pohled `create` — prázdný formulář (datum, čas, jméno, e-mail, telefon, poznámka, status s defaultem `confirmed`).
- [ ] Submit `rsv:create_save`: kolizní check + business validace s admin výjimkami (bez `maxDaysAhead`, bez `enabled`; otevírací doba a aktivní dny platí — ADMIN_SPEC §9.1), `meta` prázdné.
- [ ] Notifikace zákazníkovi při `notifyEnabled` (`renderConfirmationEmail`).
- [ ] **Ověření:** vytvoření na volný slot (objeví se v kalendáři), pokus o obsazený slot ⇒ chyba, vytvoření při vypnutých veřejných rezervacích projde, vytvoření za `maxDaysAhead` projde.

## Fáze A5 — Storno s automatickou notifikací

- [ ] `notifications.ts`: `notifyCancellation` + čisté šablony `renderCancellationEmail`, `renderConfirmationEmail` (ADMIN_SPEC §6); jednotkové testy šablon (vyžaduje zavést vitest — v projektu zatím není, viz PLAN fáze 6 pozn.).
- [ ] Akce `rsv:storno:<id>` s potvrzovacím dialogem — mechanika = stávající `cancelReservation` z fáze 5 (přesun do `reservations_history` pod novým ULID, delete z aktivních); změna: místo `notifyStatusChange` se **automaticky** spouští `notifyCancellation` na zákazníka (fire-and-forget).
- [ ] Toast + návrat na seznam; stornovaná rezervace dohledatelná přes přepínač „zobrazit stornované" a její detail nabízí už jen Smazat.
- [ ] **Ověření:** storno pending i confirmed rezervace — slot se v kalendáři okamžitě uvolní, záznam je v historii, log obsahuje pokus o notifikaci; opakované storno téhož id ⇒ chybový banner (už není aktivní).

## Fáze A6 — Průchod celku

- [ ] End-to-end scénář: veřejná rezervace → detail v adminu → potvrzení → přesun slotu → storno → smazání z historie; mezitím kontrola kalendáře na webu po každém kroku.
- [ ] Kontrola, že žádná admin data (PII, meta) neprosakují do veřejných rout (availability response).
- [ ] Aktualizace README obsahu v NPM_SPEC §6 bodu 3 (popis admin sekce) — jen poznámka, realizuje se až v NPM fázích.
