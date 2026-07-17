# Implementační plán: EmDash plugin „Reservations"

Navazuje na [SPEC.md](./SPEC.md). Fáze jsou řazené tak, aby po každé byl projekt funkční a testovatelný. Odhad rozsahu: fáze 1–2 malé, 3–5 střední, 6–7 malé.

## Fáze 0 — Ověření předpokladů (před psaním kódu)

Krátké ověření proti docs MCP (`search_docs`) a lokálnímu `node_modules/emdash`:

- [ ] `admin.settingsSchema` funguje ve **standard** formátu (definuje se v `definePlugin()` v sandbox-entry, nebo v descriptoru?).
- [ ] Přesný tvar `routes` s `public: true` a signatura handlerů `(routeCtx, ctx)` v emdash `^0.28.1`.
- [ ] Descriptor `entrypoint` — zda pro trusted lokální workspace balíček funguje package export specifier (`@emdash-reservations/plugin-reservations/sandbox`).
- [ ] Export `.astro` souboru z workspace balíčku je importovatelný ze stránek webu (mělo by být — Astro konzumuje zdrojové `.astro`).

Výstupy fáze 0 mohou korigovat detaily níže — SPEC pak aktualizovat.

## Fáze 1 — Scaffold balíčku a registrace

- [ ] `pnpm-workspace.yaml`: přidat `packages:\n  - "packages/*"`.
- [ ] `packages/emdash-plugin-reservations/package.json` — název `@emdash-reservations/plugin-reservations`, `type: "module"`, exports:
  - `"."` → `./src/index.ts` (descriptor)
  - `"./sandbox"` → `./src/sandbox-entry.ts`
  - `"./components"` → `./src/components/index.ts`
  - `peerDependencies`: `emdash`, `astro`; závislost `zod` přes `astro/zod` (bez vlastní dependency).
- [ ] `tsconfig.json` (extends root, `moduleResolution: bundler`).
- [ ] `src/index.ts` — descriptor: `id: "reservations"`, `format: "standard"`, `entrypoint`, `capabilities: ["email:send"]`, `storage` (kolekce + indexy dle SPEC §2), `adminPages`.
- [ ] `src/sandbox-entry.ts` — prázdný `definePlugin({ hooks: {}, routes: {} })` skeleton.
- [ ] Root `package.json`: dependency `"@emdash-reservations/plugin-reservations": "workspace:*"`; `pnpm install`.
- [ ] `astro.config.mjs`: `plugins: [reservationsPlugin()]`.
- [ ] **Ověření:** `npx emdash dev` nastartuje, plugin viditelný v admin UI, žádné chyby v logu.

## Fáze 2 — Doménová vrstva (shared + server)

- [ ] `src/shared/slots.ts` — čisté funkce: `makeSlotKey(date, time)`, `parseSlotKey`, `generateWeekSlots(weekStart, settings)`, `isValidSlotTime` (rastr 30 min), `mondayOf(date)`. Bez závislostí na ctx — jednotkově testovatelné.
- [ ] `src/shared/dto.ts` — Zod schémata a odvozené typy všech DTO (SPEC §2): `AvailabilityQueryDto`, `SlotDto`, `AvailabilityResponseDto`, `CreateReservationDto`, `ReservationCreatedDto`, chybové kódy.
- [ ] `src/server/model.ts` — `Reservation`, `ReservationSettings` interfaces.
- [ ] `src/server/settings.ts` — `loadSettings(ctx): Promise<ReservationSettings>` (KV `settings:*` s defaulty přes `??`), validace hodnot (openingTime < closingTime, rastr).
- [ ] `src/server/mappers.ts` — `toReservation(dto, meta)`, `toSlotDto`, `toListItemDto`. Pravidlo: veřejné DTO nikdy nenese PII.
- [ ] `src/server/validation.ts` — `sanitizeText` (trim, kolaps whitespace, strip control chars, max délky), `validateReservationRequest(dto, settings, now)` (business pravidla: aktivní den, otevírací doba, ne minulost, `maxDaysAhead`).
- [ ] Hook `plugin:install` — vygenerovat CSRF secret (Web Crypto `crypto.getRandomValues`), persist defaults nastavení.
- [ ] **Ověření:** jednotkové testy `slots.ts` a `validation.ts` (vitest, čisté funkce), typecheck.

## Fáze 3 — Backend routy: availability + reserve + security

- [ ] `src/server/security.ts`:
  - `issueCsrfToken(ctx)` / `verifyCsrfToken(ctx, token)` — HMAC-SHA256 přes Web Crypto (`crypto.subtle`), exp 15 min.
  - `checkRateLimit(ctx, ipHash)` — KV čítače, minutový + hodinový bucket; TTL úklid starých klíčů best-effort.
  - `hashIp(ip, secret)`.
  - `verifyCaptchaViaPlugin(ctx, settings, token)` — delegace na samostatný captcha plugin dle SPEC §10: prázdné `settings:captchaPluginId` ⇒ skip (pass); jinak same-origin POST na `/_emdash/api/plugins/<captchaPluginId>/verify` (origin odvozený z `ctx.request.url`); nedostupná routa ⇒ log warn + fail-closed (`captcha_failed`).
- [ ] Routa `public/csrf` (GET, `public: true`) → `{ token, expiresAt }`.
- [ ] Routa `public/availability` (GET, `public: true`) — Zod input `weekStart`; `enabled` check; query `reservations` `where: { date: { gte, lte } }`; merge s `generateWeekSlots`; vrátit `AvailabilityResponseDto` včetně `config.colors` a příznaku `captchaRequired` (true ⇔ je nastavené `captchaPluginId`).
- [ ] Routa `public/reserve` (POST, `public: true`) — pipeline přesně dle SPEC §3 (pořadí: enabled → honeypot → rate limit → CSRF → captcha → sanitizace/validace → zápis → notifikace). Zápis: `exists(slotKey)` → `put` → verifikační `get` a porovnání `nonce` požadavku; neshoda ⇒ `slot_taken`.
- [ ] **Ověření:** `curl` scénáře — happy path, dvojitá rezervace téhož slotu, špatný CSRF, vyplněný honeypot, rate limit, vypnutý plugin. Kontrola, že availability response neobsahuje PII.

## Fáze 4 — Klient: kalendář + query management

- [ ] `src/client/api-client.ts` — typovaný fetch wrapper (base `/_emdash/api/plugins/reservations/`), single-flight dedupe GET, `AbortController` API, retry+backoff jen GET, normalizace chyb na `{ code, message }`.
- [ ] `src/client/calendar.ts` — stavový modul: aktuální týden, načtení availability, render mřížky (DOM API, bez frameworku), klik na volný slot → formulář, submit → `reserve` (CSRF token fetch lazy při otevření formuláře), optimistický `pending` stav slotu + refetch po odpovědi, error stavy. Formulář obsahuje DOM slot `<div data-rsv-captcha>` + skrytý input `captchaToken` (kontrakt pro samostatný captcha plugin, SPEC §10); při `captchaRequired` bez vyplněného tokenu se submit zablokuje s hláškou.
- [ ] `src/components/ReservationCalendar.astro` — server část: wrapper markup, `<noscript>` fallback, CSS (grid 7 sloupců, custom properties `--rsv-*`), `<script>` hydratace `calendar.ts`. Barvy nastaví klient z availability response (config je zdroj pravdy, žádná duplikace do props).
- [ ] `src/components/index.ts` export.
- [ ] Stránka webu `src/pages/rezervace.astro` — import komponenty, `Base.astro` layout, `Astro.cache.set(cacheHint)` dle pravidel projektu (pozor: availability data se načítají klientsky, stránka samotná může být cacheovaná).
- [ ] **Ověření:** Playwright/Chrome DevTools MCP — proklikat: navigace týdnů, rezervace slotu, slot zčervená, druhá rezervace téhož slotu vrátí `slot_taken`, honeypot pole není viditelné.

## Fáze 5 — Administrace

- [ ] `admin.settingsSchema` dle SPEC §6 (umístění dle výsledku fáze 0).
- [ ] `src/server/admin-ui.ts` — Block Kit buildery: `buildOverviewBlocks(stats)`, `buildReservationsTable(items, filter, cursor)`.
- [ ] Routa `admin` — interakce: `page_load` (stats + tabulka), `block_action` filtr statusu, stránkování, akce `confirm` (`pending → confirmed`, update v `reservations`), akce `cancel` (potvrzovací dialog; delete z `reservations` + put do `reservations_history` se statusem `cancelled`), toast zprávy.
- [ ] Status change → `notifications.notifyStatusChange` (fire-and-forget).
- [ ] **Ověření:** v admin UI změnit barvy a otevírací dobu → kalendář na webu je převezme; potvrdit a zrušit rezervaci → slot se uvolní; deaktivace (`enabled` off) → web hlásí „rezervace nejsou dostupné".

## Fáze 6 — E-mail notifikace (příprava)

- [ ] `src/server/notifications.ts` — `notifyNewReservation`, `notifyStatusChange`; šablony jako čisté funkce `renderNewReservationEmail(r): { subject, text }`.
- [ ] Guard: `notifyEnabled` && `notifyEmail` && `ctx.email` ⇒ send; jinak `ctx.log.info` skip. Chyby zachytit a logovat — nikdy nesmí shodit rezervaci.
- [ ] **Ověření:** log obsahuje skip hlášku při vytvoření rezervace (transport neexistuje); jednotkový test šablon.

## Fáze 7 — Dokončení

- [ ] `README.md` balíčku — instalace, nastavení, popis rout, jak později připojit e-mail transport a captcha plugin (kontrakt SPEC §10).
- [ ] `plugin:uninstall` — smazání storage + KV jen při `event.deleteData`.
- [ ] Průchod celkovým flow (verify skill): čerstvá DB → seed → rezervace end-to-end.
- [ ] Aktualizace kořenového `CLAUDE.md` (nová stránka `/rezervace`, plugin v přehledu).

## Navazující práce (samostatné projekty, mimo tento plán)

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
