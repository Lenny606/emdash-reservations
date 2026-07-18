# Implementační plán: EmDash plugin „Reservations"

Navazuje na [SPEC.md](./SPEC.md). Fáze jsou řazené tak, aby po každé byl projekt funkční a testovatelný. Odhad rozsahu: fáze 1–2 malé, 3–5 střední, 6–7 malé.

## Fáze 0 — Ověření předpokladů (před psaním kódu) — HOTOVO

Ověřeno přímo v `node_modules/emdash@0.28.1` (`.d.mts` soubory), protože `search_docs` MCP i lokální skill `.claude/skills/creating-plugins` popisují **jiné, novější** API (manifest `emdash-plugin.jsonc` + `src/plugin.ts`, `sandboxed: []`), které v nainstalované verzi neexistuje. Závěry:

- [x] **`admin.settingsSchema` NEFUNGUJE ve standard formátu.** `settingsSchema` je pole na `PluginAdminConfig`, které je součástí `PluginDefinition` (vstup do `definePlugin()`) — tedy **jen native formát**. Standard formát nemá `admin` blok v runtime definici vůbec. Nastavení řešíme výhradně přes KV (`settings:*`) + Block Kit formulář v `admin` routě (§6 aktualizováno).
- [x] **`sandbox-entry.ts` NEPOUŽÍVÁ `definePlugin()`.** Pro `format: "standard"` je default export **holý objekt `{ hooks?, routes? }`** anotovaný `satisfies SandboxedPlugin` z `"emdash/plugin"`. Volání `definePlugin()` vyžaduje `id`/`version` (native formát) a za běhu by shodilo chybu, kdyby chyběly. Runtime pak tento objekt zabalí přes `adaptSandboxEntry(definition, descriptor)` — descriptor dodá identitu (id, capabilities, storage), definice chování.
- [x] **Routy jsou dvouargumentové `(routeCtx, ctx)`.** `routeCtx: { input, request: { url, method, headers }, requestMeta?: { ip, userAgent, referer, geo } }` — `request` je **přenositelný záznam, ne skutečný `Request`** (žádné `.headers.get()`). `requestMeta.ip`/`userAgent` jsou už normalizované — netřeba parsovat hlavičky ručně pro IP.
- [x] **`ctx.url(path)` a `ctx.site`** jsou vždy dostupné na `PluginContext` (nezdokumentováno v lokálním skillu) — `ctx.url()` generuje absolutní URL ze site konfigurace. Použijeme ho pro delegovaný captcha verify-call (§8) místo ručního odvozování originu z `request.url`.
- [x] Interní same-origin volání captcha verify routy nepotřebuje `ctx.http`/`network:request` capability — plugin běží trusted/in-process (`plugins: []`), takže obyčejný globální `fetch()` (Node 24 má Web Crypto i fetch globálně) stačí; `ctx.http` je stejně jen pro externí `allowedHosts`.
- [x] Descriptor `entrypoint` jako package export specifier (`@emdash-reservations/plugin-reservations/sandbox`) funguje stejně jako běžný import — žádné speciální ověření navíc není potřeba, jde o standardní Node/Vite modul resolution přes `pnpm-workspace.yaml` + workspace dependency.
- [x] Export `.astro` souboru z workspace balíčku — Astro konzumuje zdrojové `.astro` soubory přímo, funguje bez buildu (stejně jako u native pluginů s `componentsEntry`).

SPEC.md §1, §3, §4, §6, §8 aktualizovány dle těchto zjištění.

## Fáze 1 — Scaffold balíčku a registrace

- [x] `pnpm-workspace.yaml`: přidat `packages:\n  - "packages/*"`.
- [x] `packages/emdash-plugin-reservations/package.json` — název `@emdash-reservations/plugin-reservations`, `type: "module"`, exports:
  - `"."` → `./src/index.ts` (descriptor)
  - `"./sandbox"` → `./src/sandbox-entry.ts`
  - `"./components"` → `./src/components/index.ts`
  - `peerDependencies`: `emdash`, `astro`; závislost `zod` přes `astro/zod` (bez vlastní dependency).
- [x] `tsconfig.json` (extends root, `moduleResolution: bundler`).
- [x] `src/index.ts` — descriptor: `id: "reservations"`, `format: "standard"`, `entrypoint`, `capabilities: ["email:send"]`, `storage` (kolekce + indexy dle SPEC §2), `adminPages`.
- [x] `src/sandbox-entry.ts` — prázdný `definePlugin({ hooks: {}, routes: {} })` skeleton.
- [x] Root `package.json`: dependency `"@emdash-reservations/plugin-reservations": "workspace:*"`; `pnpm install`.
- [x] `astro.config.mjs`: `plugins: [reservationsPlugin()]`.
- [x] **Ověření:** `npx emdash dev` nastartuje, plugin viditelný v admin UI, žádné chyby v logu.

## Fáze 2 — Doménová vrstva (shared + server)

- [x] `src/shared/slots.ts` — čisté funkce: `makeSlotKey(date, time)`, `parseSlotKey`, `generateWeekSlots(weekStart, settings)`, `isValidSlotTime` (rastr 30 min), `mondayOf(date)`. Bez závislostí na ctx — jednotkově testovatelné.
- [x] `src/shared/dto.ts` — Zod schémata a odvozené typy všech DTO (SPEC §2): `AvailabilityQueryDto`, `SlotDto`, `AvailabilityResponseDto`, `CreateReservationDto`, `ReservationCreatedDto`, chybové kódy.
- [x] `src/server/model.ts` — `Reservation`, `ReservationSettings` interfaces.
- [x] `src/server/settings.ts` — `loadSettings(ctx): Promise<ReservationSettings>` (KV `settings:*` s defaulty přes `??`), validace hodnot (openingTime < closingTime, rastr).
- [x] `src/server/mappers.ts` — `toReservation(dto, meta)`, `toSlotDto`, `toListItemDto`. Pravidlo: veřejné DTO nikdy nenese PII.
- [x] `src/server/validation.ts` — `sanitizeText` (trim, kolaps whitespace, strip control chars, max délky), `validateReservationRequest(dto, settings, now)` (business pravidla: aktivní den, otevírací doba, ne minulost, `maxDaysAhead`).
- [x] Hook `plugin:install` — vygenerovat CSRF secret (Web Crypto `crypto.getRandomValues`), persist defaults nastavení. **Zjištění:** v této verzi emdash se `plugin:install` u config-deklarovaných (trusted `plugins: []`) pluginů za běhu nespouští (ověřeno na čisté DB — `hasHooks: true`, ale žádný log z handleru; `runPluginInstall` se nikde nevolá mimo `HookPipeline`, jen marketplace/sandboxed install flow ho zřejmě spouští). Proto `security.getOrCreateCsrfSecret(ctx)` čte/generuje secret lazy při prvním použití místo spoléhání na hook; `loadSettings` je už tak jako tak robustní přes `??` defaulty. Hook necháváme (neškodí, pomůže pro sandboxed instalaci), ale runtime na něj nespoléhá.
- [x] **Ověření:** typecheck (`tsc --noEmit`) prochází bez chyb; `npx emdash dev` na čisté DB (smazané `data.db`) startuje bez chyb, plugin je `active`/`hasHooks: true` v `/_emdash/api/admin/plugins`.

## Fáze 3 — Backend routy: availability + reserve + security

- [x] `src/server/security.ts`:
  - `issueCsrfToken(ctx)` / `verifyCsrfToken(ctx, token)` — HMAC-SHA256 přes Web Crypto (`crypto.subtle`), exp 15 min.
  - `checkRateLimit(ctx, ipHash)` — KV čítače, minutový + hodinový bucket; TTL úklid starých klíčů best-effort.
  - `hashIp(ip, secret)`.
  - `verifyCaptchaViaPlugin(ctx, settings, token)` — delegace na samostatný captcha plugin dle SPEC §10: prázdné `settings:captchaPluginId` ⇒ skip (pass); jinak same-origin POST na `ctx.url("/_emdash/api/plugins/<captchaPluginId>/verify")`; nedostupná routa ⇒ log warn + fail-closed (`captcha_failed`).
- [x] Routa `public/csrf` (GET, `public: true`) → `{ token, expiresAt }`.
- [x] Routa `public/availability` (GET, `public: true`) — Zod input `weekStart`; `enabled` check; query `reservations` `where: { date: { gte, lte } }`; merge s `generateWeekSlots`; vrátit `AvailabilityResponseDto` včetně `config.colors` a příznaku `captchaRequired` (true ⇔ je nastavené `captchaPluginId`).
- [x] Routa `public/reserve` (POST, `public: true`) — pipeline přesně dle SPEC §3 (pořadí: enabled → honeypot → rate limit → CSRF → captcha → sanitizace/validace → zápis → notifikace). Zápis: `exists(slotKey)` → `put` → verifikační `get` a porovnání `nonce` požadavku; neshoda ⇒ `slot_taken`.
- [~] **Ověření:** částečné — `public/csrf` a `public/availability` ověřeny přes curl (a při té příležitosti nalezen a opravený bug: GET požadavky se v této verzi emdash nikdy neparsují jako `input`, viz oprava níže). Zbylé scénáře (`public/reserve` happy path, dvojitá rezervace, špatný CSRF, honeypot, rate limit, vypnutý plugin) typechecknuté a code-reviewnuté, ale ne ručně proklikané — uživatel testuje sám.
- [x] **Oprava zjištěná při ověřování:** `handlePluginApiRoute` v této verzi vždy volá `request.json()` bez ohledu na HTTP metodu; u GET/DELETE bez těla to tiše selže a `body` zůstane `undefined`, takže `input:` Zod validace na GET routách vždy spadne. `public/availability` proto parsuje a validuje `weekStart` ručně z `routeCtx.request.url` místo spoléhání na `input:`.

## Fáze 4 — Klient: kalendář + query management

- [x] `src/client/api-client.ts` — typovaný fetch wrapper (base `/_emdash/api/plugins/reservations/`), single-flight dedupe GET, `AbortController` API, retry+backoff jen GET, normalizace chyb na `{ code, message }`.
- [x] `src/client/calendar.ts` — stavový modul: aktuální týden, načtení availability, render mřížky (DOM API, bez frameworku), klik na volný slot → formulář, submit → `reserve` (CSRF token fetch lazy při otevření formuláře), optimistický `pending` stav slotu + refetch po odpovědi, error stavy. Formulář obsahuje DOM slot `<div data-rsv-captcha>` + skrytý input `captchaToken` (kontrakt pro samostatný captcha plugin, SPEC §10); při `captchaRequired` bez vyplněného tokenu se submit zablokuje s hláškou.
- [x] `src/components/ReservationCalendar.astro` — server část: wrapper markup, `<noscript>` fallback, CSS (grid 7 sloupců, custom properties `--rsv-*`), `<script>` hydratace `calendar.ts`. Barvy nastaví klient z availability response (config je zdroj pravdy, žádná duplikace do props).
- [x] `src/components/index.ts` export.
- [x] Stránka webu `src/pages/reservations.astro` (**ne** `/rezervace` — web je anglicky: `<html lang="en">`, homepage už odkazuje na `/reservations`; veškerý visitor-facing text v pluginu je proto anglicky, SPEC/PLAN zůstávají v češtině jen jako interní poznámky). Import komponenty, `Base.astro` layout; žádný `Astro.cache.set` — stránka nedělá server-side content query (availability se načítá klientsky), takže není co cachovat.
- [ ] **Ověření:** typecheck + `astro check` (13 souborů, 0 chyb) prošly; interaktivní proklikání (navigace týdnů, rezervace slotu, druhá rezervace vrátí `slot_taken`, honeypot skrytý) **neprovedeno mnou** — uživatel testuje sám.

## Fáze 5 — Administrace

- [x] Nastavení: **ne** `admin.settingsSchema`, viz Fáze 0 — místo toho `buildSettingsFormBlocks(settings)` v `admin-ui.ts` (Block Kit `form` blok) + `form_submit` handler v `admin` routě, který zapisuje do KV `settings:*`.
- [x] `src/server/admin-ui.ts` — Block Kit buildery: `buildSettingsFormBlocks`, `buildOverviewBlocks(stats)`, `buildPendingListBlocks(items)`, `buildReservationsTableBlocks(items)`. **Odchylka od SPEC §6:** instalovaný `table` blok nemá per-row akční tlačítka (jen `columns`/`rows`, žádný action/button column format) — proto je tabulka jen pro čtení (posledních 50 rezervací, bez filtru/stránkování) a akceschopné `pending` položky se renderují zvlášť jako dvojice `section` (text) + `actions` (Confirm/Cancel tlačítka) na řádek.
- [x] Routa `admin` — interakce: `page_load` i cokoliv neznámého → plná stránka; `form_submit` `save_settings` → zápis do KV; `block_action` `confirm` (`pending → confirmed`, update v `reservations`); `block_action` `cancel` (potvrzovací dialog už řeší `ButtonElement.confirm` na klientu; handler přesune záznam do `reservations_history` s `ulid()` id a smaže z `reservations`); toast zprávy u všech tří.
- [x] Status change → `notifications.notifyStatusChange` (fire-and-forget) volané z `confirmReservation`/`cancelReservation`.
- [ ] **Ověření:** typecheck čistý; interaktivní ověření v admin UI (změna nastavení se projeví na webu, confirm/cancel uvolní slot, `enabled` off zobrazí banner) **neprovedeno mnou** — uživatel testuje sám.

## Fáze 6 — E-mail notifikace (příprava)

- [x] `src/server/notifications.ts` — `notifyNewReservation`, `notifyStatusChange`; šablony jako čisté funkce `renderNewReservationEmail(r): { subject, text }`.
- [x] Guard: `notifyEnabled` && `notifyEmail` && `ctx.email` ⇒ send; jinak `ctx.log.info` skip. Chyby zachytit a logovat — nikdy nesmí shodit rezervaci.
- [ ] **Ověření:** kód projde typecheckem a logika je zkontrolovaná při čtení (guard pořadí, žádná chyba nemůže spadnout rezervaci); **skip-log v reálném běhu a jednotkový test šablon nejsou provedené** — nejsou napsané žádné testy (vitest není v projektu nastavený) a live log neověřen mnou.

## Fáze 7 — Dokončení

- [x] `README.md` balíčku — instalace, nastavení, popis rout, jak později připojit e-mail transport a captcha plugin (kontrakt SPEC §10).
- [x] `plugin:uninstall` — smazání storage + KV jen při `event.deleteData`.
- [ ] Průchod celkovým flow end-to-end (čerstvá DB → seed → rezervace) — **neprovedeno mnou**, uživatel testuje sám. Ověřeno mnou: `pnpm install`, čistá DB start (Fáze 2), `tsc --noEmit` na balíčku (0 chyb kromě `.astro` importu, což je limitace holého `tsc` bez Astro pluginu — `astro check` na celém webu ho vidí a projde), `astro check` na webu (13 souborů, 0 chyb).
- [x] Aktualizace kořenového `AGENTS.md`/`CLAUDE.md` (nová stránka `/reservations`, plugin v přehledu).

## Kontrola implementace proti SPEC (2026-07-18)

Implementace zkontrolována sekci po sekci proti SPEC.md — základ odpovídá specifikaci (architektura, datový model, pipeline `public/reserve` včetně pořadí kroků, bezpečnostní mechanismy, kalendář, admin, notifikační šev, capabilities). Nalezené odchylky:

**Opravené při kontrole:**

- [x] **Rate-limit KV buckety se neuklízely** (SPEC §4 slibuje best-effort úklid, riziko #3) — doplněn `sweepStaleRateLimitBuckets` v `security.ts`: max jednou za hodinu (gate přes KV `state:rlSweepAt`) projde `state:rl:*` a smaže buckety starší než aktuální minutové/hodinové okno; volá se fire-and-forget z `checkRateLimit`, chyby jen loguje.
- [x] **`maxDaysAhead` se nevynucoval v availability ani na klientu** (SPEC §5 „navigace týdnů s limitem `maxDaysAhead`") — server teď sloty za horizontem označuje `closed` (stejný výpočet horizontu jako `validateReservationRequest`), do `AvailabilityResponseDto.config` přibylo `maxDaysAhead` a klient deaktivuje tlačítko „›", když už další týden začíná za horizontem.

**Vědomé odchylky (ponechané záměrně):**

- Rate-limit limity (5/min, 20/h) jsou konstanta `RESERVE_RATE_LIMIT`, ne nastavení (SPEC §3 říkala „limit z nastavení") — konfigurovatelnost se případně doplní spolu s rozšířením admin nastavení.
- Availability při `enabled: false` vrací plnou mřížku `closed` slotů + pole `enabled` (nad rámec DTO ve SPEC §2) místo samostatné „disabled" odpovědi — klient tak umí vykreslit mřížku i hlášku o nedostupnosti.
- E-mailové šablony v `notifications.ts` jsou česky, přestože fáze 4 deklaruje veškerý text anglicky — jdou správci (`notifyEmail`), ne návštěvníkům; sjednotí se při rozšíření notifikací (ADMIN_PLAN fáze A5 šablony stejně přepisuje).
- `@emdash-cms/blocks` je pinnutá běžná dependency (`0.28.1`) kvůli Block Kit builderům a typům — ve SPEC nefigurovala; rozhodnutí peer vs. bundle se odkládá do NPM_PLAN fáze N2.
- `plugin:uninstall` maže max 1000 záznamů na kolekci jedním průchodem (bez kurzorové smyčky) — pro objemy dat tohoto pluginu dostačující.

## Navazující práce (samostatné projekty, mimo tento plán)

- **Správa rezervací v adminu** — samostatná specifikace [ADMIN_SPEC.md](./ADMIN_SPEC.md) + plán [ADMIN_PLAN.md](./ADMIN_PLAN.md); rozšiřuje dokončenou fázi 5 (seznam s filtry, detail, editace, mazání, ruční vytváření, storno s notifikací).
- **Distribuce jako npm balíček** — samostatná specifikace [NPM_SPEC.md](./NPM_SPEC.md) + plán [NPM_PLAN.md](./NPM_PLAN.md); startuje až po dokončení fází 1–7.
- **Captcha plugin** — vlastní balíček s vlastním nastavením (provider, klíče, widget). Musí naplnit kontrakt ze SPEC §10 (verify routa, widget do `data-rsv-captcha` slotu, zápis tokenu). Rezervační plugin je na něj připravený bez dalších změn kódu.
- **E-mail transport plugin** — provider s `email:deliver` hookem (např. Resend); po instalaci začnou fungovat notifikace z fáze 6.

## Rizika a otevřené otázky

| # | Riziko / otázka | Dopad | Mitigace |
| --- | --- | --- | --- |
| 1 | `settingsSchema` nemusí být ve standard formátu podporované (reference ho ukazuje u native `definePlugin`) | Nastavení by muselo jít přes Block Kit formulář v `admin` routě | Fáze 0; fallback je již navržený (`settings/save` pattern z api-routes reference) |
| 2 | Race condition při souběžné rezervaci téhož slotu | Dvojitá rezervace | `id = slotKey` + verifikační re-read s nonce; zbytkové riziko přijatelné pro v1 |
| 3 | Rate limit KV čítače rostou bez TTL | Nafouklé KV | Klíče obsahují time bucket; best-effort úklid starých bucketů při zápisu |
| 4 | `public/csrf` je sám o sobě veřejný — token může získat i bot | CSRF ochrana ≠ bot ochrana | Záměr: CSRF chrání proti cross-site požadavkům; boty řeší honeypot + rate limit + (volitelně) samostatný captcha plugin |
| 7 | Delegovaný captcha verify: špatně nastavené `captchaPluginId` nebo nedostupná verify routa | Rezervace by procházely bez ověření, nebo by naopak všechny padaly | Fail-closed (`captcha_failed`) + log warn; admin dokumentace: po instalaci captcha pluginu otestovat rezervaci |
| 5 | Časová zóna serveru vs. návštěvníka | Posunuté sloty | v1: jedna konfigurační TZ webu, dokumentováno; kalendář zobrazuje časy jako "místní čas provozovny" |
| 6 | Import `.astro` z workspace balíčku | Komponenta by se musela přesunout do `src/components/` webu | Fáze 0 ověří; přesun je levný (komponenta importuje jen `client/` a `shared/`) |
