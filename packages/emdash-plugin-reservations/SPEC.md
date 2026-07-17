# Specifikace: EmDash plugin „Reservations"

Rezervační plugin pro EmDash CMS. Na veřejném webu zobrazí týdenní kalendář (7 dní × 0,5h sloty), návštěvník si zarezervuje volný slot. Administrátor plugin konfiguruje a spravuje rezervace v admin UI.

## 1. Architektura

| Rozhodnutí | Volba | Zdůvodnění |
| --- | --- | --- |
| Formát pluginu | **Standard** (`format: "standard"`, descriptor + `sandbox-entry.ts`) | Nepotřebujeme React admin ani PT bloky; Block Kit pokryje administraci (viz Fáze 0 v PLAN.md — `settingsSchema` je jen native, standard formát řeší nastavení přes KV + Block Kit formulář). Standard formát nechává otevřenou cestu k marketplace. `sandbox-entry.ts` exportuje holý `{ hooks?, routes? }` (`satisfies SandboxedPlugin` z `"emdash/plugin"`), ne `definePlugin()`. |
| Registrace | `plugins: []` v `astro.config.mjs` (trusted, in-process) | První strana, lokální kód; Node adapter (sandbox je jen Cloudflare). |
| Umístění | Lokální workspace balíček `packages/emdash-plugin-reservations` (`@emdash-reservations/plugin-reservations`) | Čisté oddělení od webu, `entrypoint` může mířit na package export `./sandbox`. Vyžaduje přidat `packages:` do `pnpm-workspace.yaml`. |
| Kalendář na webu | Astro komponenta `ReservationCalendar.astro` exportovaná z balíčku (`./components`) + vanilla TS klientský skript | Trusted lokální balíček může dodat `.astro` zdroj přímo (Astro je konzumuje bez buildu). Web ji naimportuje na stránce `/rezervace`. Žádný React na klientu. |
| Perzistence | Plugin **storage** kolekce (`ctx.storage`) + **KV** pro nastavení a stav | Bez migrací, automaticky scoped na plugin. |

### Struktura balíčku

```
packages/emdash-plugin-reservations/
├── src/
│   ├── index.ts                  # PluginDescriptor factory (Vite, build time)
│   ├── sandbox-entry.ts          # definePlugin({ hooks, routes }) (runtime)
│   ├── shared/
│   │   ├── dto.ts                # Zod schémata + DTO typy (sdílené klient/server)
│   │   └── slots.ts              # Čistá logika slotů (slotKey, generování týdne)
│   ├── server/
│   │   ├── model.ts              # Doménové modely (Reservation, Settings)
│   │   ├── mappers.ts            # DTO ↔ model mapování
│   │   ├── validation.ts         # Sanitizace + business validace nad Zod vrstvou
│   │   ├── security.ts           # CSRF tokeny, rate limit, honeypot, delegace captcha ověření
│   │   ├── settings.ts           # Načtení/typování nastavení z KV
│   │   ├── notifications.ts      # Příprava e-mail notifikací (ctx.email, no-op fallback)
│   │   └── admin-ui.ts           # Block Kit builder pro admin stránku
│   ├── client/
│   │   ├── api-client.ts         # Query management (fetch wrapper, dedupe, abort)
│   │   └── calendar.ts           # Logika kalendáře v prohlížeči (stav, rendering, interakce)
│   └── components/
│       ├── index.ts              # Export Astro komponent
│       └── ReservationCalendar.astro
├── package.json                  # exports: ".", "./sandbox", "./components"
├── tsconfig.json
├── SPEC.md                       # tento dokument
├── PLAN.md                       # implementační plán
├── NPM_SPEC.md                   # specifikace distribuce jako npm balíček
└── NPM_PLAN.md                   # implementační plán npm distribuce (realizuje NPM_SPEC.md)
```

## 2. Datový model

### Doménový model `Reservation` (server)

```ts
interface Reservation {
  id: string;            // aktivní rezervace: id === slotKey (viz níže); historie: ULID
  slotKey: string;       // "YYYY-MM-DD_HH:mm" (lokální čas webu, 30min krok)
  date: string;          // "YYYY-MM-DD" (index)
  startTime: string;     // "HH:mm"
  durationMinutes: 30;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;     // ISO
  updatedAt: string;     // ISO
  meta: { ipHash?: string; userAgent?: string };
}
```

### Storage kolekce

| Kolekce | id | Indexy | Účel |
| --- | --- | --- | --- |
| `reservations` | **`slotKey`** | `date`, `status`, `email`, `createdAt` | Aktivní rezervace (pending/confirmed). `id = slotKey` ⇒ jeden slot = max jedna aktivní rezervace (atomická unikátnost bez zámků). Composite index `["date","startTime"]` není v této verzi emdash podporovaný (`PluginDescriptor` bere jen ploché řetězce) — řazení podle `startTime` v rámci dne se dělá in-memory po načtení přes `date` index. |
| `reservations_history` | ULID | `date`, `status`, `email`, `createdAt` | Zrušené/archivované rezervace. Při zrušení se záznam přesune sem (delete z `reservations` + put sem), čímž se slot uvolní. |

Konflikt při souběžném zápisu: `exists(slotKey)` check před `put` + fakt, že id je slotKey, minimalizuje okno; druhý zápis by přepsal první, proto pořadí *check → put → re-read a porovnání `createdAt`/nonce* (verifikační krok) — detail v PLAN fáze 3.

### DTOs (`shared/dto.ts`, Zod)

- `AvailabilityQueryDto` — `{ weekStart: "YYYY-MM-DD" }` (pondělí; validace formátu i rozsahu `maxDaysAhead`).
- `SlotDto` — `{ slotKey, date, startTime, status: "free" | "reserved" | "pending" | "closed" | "past" }`. **Nikdy neobsahuje osobní údaje rezervujícího.**
- `AvailabilityResponseDto` — `{ weekStart, days: [...], slots: SlotDto[], config: { openingTime, closingTime, activeDays, colors } }`.
- `CreateReservationDto` — `{ slotKey, name, email, phone?, note?, csrfToken, captchaToken?, website: "" }` (`website` = honeypot, musí být prázdný; `captchaToken` je neprůhledný token předávaný samostatnému captcha pluginu, viz §4).
- `ReservationCreatedDto` — `{ ok: true, reservationId, slot: SlotDto }` / chybová `{ ok: false, code, message }` s kódy `slot_taken`, `invalid_csrf`, `captcha_failed`, `rate_limited`, `disabled`, `validation_error`.
- Admin: `ReservationListItemDto` (plná data pro Block Kit tabulku).

Mapování DTO ↔ model výhradně v `server/mappers.ts` (`toReservation(dto, ctxMeta)`, `toSlotDto(reservation | empty)`, `toListItemDto(reservation)`). Handlery nikdy nevracejí syrové storage záznamy.

## 3. API routy

Base: `/_emdash/api/plugins/reservations/<route>`

| Routa | Metoda | Auth | Účel |
| --- | --- | --- | --- |
| `public/availability` | GET | `public: true` | Sloty pro daný týden. Vrací jen statusy, žádná PII. |
| `public/csrf` | GET | `public: true` | Vydá krátkodobý podepsaný CSRF token. |
| `public/reserve` | POST | `public: true` | Vytvoření rezervace (plná bezpečnostní pipeline). |
| `admin` | POST | admin session | Block Kit stránka: tabulka rezervací, akce confirm/cancel, přehled. |

Všechny vstupy validuje Zod (`input:` na routě) + druhá vrstva sanitizace/business validace v `validation.ts`.

Standard formát volá handlery dvouargumentově `(routeCtx, ctx)`: `routeCtx.request` je přenositelný `{ url, method, headers }` záznam (ne skutečný `Request`), `routeCtx.requestMeta` nese už normalizované `{ ip, userAgent, referer, geo }`.

### Pipeline `public/reserve`

1. `enabled` check (KV `settings:enabled`) → jinak `disabled`.
2. Honeypot: `website !== ""` → tichý úspěch (fake `ok: true`), log warn.
3. Rate limit: KV čítač `state:rl:<ipHash>:<minuteBucket>`, limit z nastavení (default 5/min, 20/h).
4. CSRF: ověření HMAC podpisu + expirace (viz §4).
5. Captcha (delegovaná): pokud je nastavené `settings:captchaPluginId`, zavolá se verify routa captcha pluginu (`/_emdash/api/plugins/<captchaPluginId>/verify`) s `captchaToken`; prázdné nastavení ⇒ krok se přeskočí. Captcha samotná je **samostatný plugin** (mimo rozsah tohoto pluginu), viz §4 a §10.
6. Sanitizace (trim, kolaps whitespace, odstranění řídicích znaků, délkové limity) + business validace (slot ve správném rastru, v otevírací době, aktivní den, ne minulost, ne za `maxDaysAhead`).
7. Zápis: `exists(slotKey)` → `put(slotKey, reservation)` → verifikační re-read. Kolize → `slot_taken`.
8. Fire-and-forget `notifications.notify(ctx, reservation)`.

## 4. Klientská bezpečnost

| Mechanismus | Řešení |
| --- | --- |
| **CSRF** | Stateless podepsaný token: `base64(payload).HMAC-SHA256(payload, secret)`; payload = `{ iat, exp (15 min), nonce }`. Secret se vygeneruje v `plugin:install` (Web Crypto) a uloží do KV `state:csrfSecret`. Klient si token vyžádá z `public/csrf` a pošle v těle `reserve`. Web Crypto only — žádné Node builtins (sandbox kompatibilita). |
| **Honeypot** | Skryté pole `website` (CSS `position:absolute; left:-9999px`, `tabindex="-1"`, `autocomplete="off"`). Vyplněné ⇒ tiché zahození. |
| **Captcha** | **Samostatný plugin** (vlastní nastavení, provider, klíče) — není součástí rezervačního pluginu. Rezervační plugin definuje pouze integrační kontrakt: (a) formulář v kalendáři obsahuje DOM slot `<div data-rsv-captcha>` pro widget captcha pluginu, (b) `CreateReservationDto.captchaToken` přenese neprůhledný token, (c) server-side krok 5 pipeline deleguje ověření na verify routu captcha pluginu (same-origin volání). Bez nainstalovaného/nakonfigurovaného captcha pluginu se krok přeskakuje — bot ochranu drží honeypot + rate limit. |
| **Rate limiting** | KV čítače per IP hash (SHA-256 IP + secret, žádné ukládání syrových IP), minutové a hodinové bucket okno. IP se čte z už normalizovaného `routeCtx.requestMeta.ip` (standard formát), ne z hlaviček ručně. |

## 5. Klientský kalendář

- **Vzhled:** mřížka 7 sloupců (Po–Ne) × řádky po 30 min mezi `openingTime` a `closingTime`. Jednoduché, čisté CSS (custom properties), žádná knihovna.
- **Barvy:** CSS proměnné `--rsv-free`, `--rsv-reserved`, `--rsv-pending`, `--rsv-closed` — hodnoty přijdou z nastavení pluginu přes `AvailabilityResponseDto.config.colors`; komponenta je nastaví inline na root elementu.
- **Interakce:** navigace týdnů (‹ dnes ›, limit `maxDaysAhead`), klik na volný slot → rezervační formulář (jméno, e-mail, telefon, poznámka + honeypot), potvrzení / chybové stavy inline.
- **Query management (`client/api-client.ts`):**
  - typovaný wrapper nad `fetch` s DTO typy sdílenými ze `shared/dto.ts`,
  - dedupe identických in-flight GET požadavků (single-flight mapa),
  - `AbortController` — přepnutí týdne zruší předchozí availability request,
  - retry s backoffem pro GET (2 pokusy), nikdy pro POST `reserve`,
  - normalizace chyb na `{ code, message }`,
  - po úspěšné rezervaci invalidace/refetch aktuálního týdne.
- **Progresivní chování:** bez JS se zobrazí informační fallback (kalendář vyžaduje JS; formulář se nerenderuje naslepo).

## 6. Administrace

### Nastavení (Block Kit formulář v `admin` routě → KV `settings:*`)

`admin.settingsSchema` je jen pro native formát (viz Fáze 0 v PLAN.md) — standard formát nemá auto-generovaný settings formulář. Nastavení proto renderujeme jako `form` blok v Block Kit `admin` routě (stejná stránka jako přehled/tabulka, nad ní), `form_submit` handler zapisuje do KV `settings:*`.

| Klíč | Typ | Default | Popis |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Aktivace/deaktivace rezervací (vypnuto ⇒ availability vrací `disabled`, reserve odmítá). |
| `colorFree` | string | `#22c55e` | Barva volného slotu. |
| `colorReserved` | string | `#ef4444` | Barva obsazeného slotu. |
| `colorPending` | string | `#f59e0b` | Barva čekající rezervace. |
| `colorClosed` | string | `#e5e7eb` | Barva zavřeno/mimo provoz. |
| `openingTime` | string | `08:00` | Začátek dne (HH:mm, rastr 30 min). |
| `closingTime` | string | `18:00` | Konec dne. |
| `activeDays` | string | `1,2,3,4,5` | Aktivní dny (1=Po … 7=Ne, CSV). |
| `maxDaysAhead` | number | `28` | Jak daleko dopředu lze rezervovat. |
| `autoConfirm` | boolean | `false` | `false` ⇒ nové rezervace `pending`, potvrzuje admin. |
| `captchaPluginId` | string | *(prázdné)* | ID nainstalovaného captcha pluginu (prázdné ⇒ ověření vypnuto). Provider, klíče a widget konfiguruje captcha plugin ve vlastním nastavení. |
| `notifyEnabled` | boolean | `false` | Příprava e-mail notifikací. |
| `notifyEmail` | string | — | Adresa správce pro notifikace. |

Defaults se persistují v `plugin:install` (schema defaults jsou jen UI defaults).

### Admin stránka (Block Kit, routa `admin`)

- `adminPages: [{ path: "/reservations", label: "Rezervace", icon: "calendar" }]`
- **Přehled:** `stats` blok (rezervace tento týden, čekající, celkem).
- **Tabulka rezervací:** datum/čas, jméno, e-mail, status (`badge`), vytvořeno (`relative_time`); filtr dle statusu; stránkování kurzorem.
- **Akce na řádku:** Potvrdit (`pending → confirmed`), Zrušit (s potvrzovacím dialogem; přesun do `reservations_history`).
- Nastavení řeší nativní `settingsSchema` formulář — v Block Kit stránce se neduplikuje.

## 7. E-mail notifikace (příprava)

E-mailový transport plugin zatím neexistuje. Připravíme čistý šev:

- Descriptor deklaruje capability **`email:send`**.
- `server/notifications.ts`: `notifyNewReservation(ctx, r)`, `notifyStatusChange(ctx, r)`; šablony (subject/text) jako čisté funkce.
- Runtime chování: `settings:notifyEnabled` && `ctx.email` dostupné (tj. je nainstalovaný transport provider) ⇒ `ctx.email.send()`; jinak `ctx.log.info("email transport not configured, skipping")`. Žádná chyba, žádný pád rezervace (fire-and-forget, `errorPolicy` semantika „continue").
- Až vznikne transport plugin (např. Resend s `email:deliver`), notifikace začnou fungovat bez změny kódu.

## 8. Capabilities & hooks

```ts
capabilities: ["email:send"],
```

Pozn.: delegované ověření captchy je same-origin volání verify routy jiného pluginu — URL se sestaví přes `ctx.url("/_emdash/api/plugins/<captchaPluginId>/verify")` (vždy dostupné na `PluginContext`, viz Fáze 0), zavolá se běžným globálním `fetch` (trusted/in-process režim). Externí hosty plugin nevolá — `network:request` ani `allowedHosts` nejsou potřeba; externí komunikaci (Turnstile apod.) řeší captcha plugin sám.

Hooks: `plugin:install` (CSRF secret, persist defaults), `plugin:activate`/`plugin:deactivate` (log; runtime vypínání řídí `settings:enabled`), `plugin:uninstall` (smazat data jen při `event.deleteData`).

## 9. Mimo rozsah v1

- **Captcha implementace** — samostatný plugin s vlastním nastavením (viz §10); rezervační plugin nese jen integrační šev.
- Vícedenní / delší sloty než 30 min, více zdrojů (místností/osob), opakované rezervace.
- Účty návštěvníků, samoobslužné rušení rezervace klientem (vyžaduje e-mail s tokenem ⇒ až po e-mail transportu).
- iCal export, synchronizace s externími kalendáři.
- Časové zóny: v1 počítá s jednou lokální zónou webu (konfig konstanta), bez konverzí per návštěvník.

## 10. Integrační kontrakt pro captcha plugin (navazující projekt)

Captcha plugin je oddělený balíček s vlastní specifikací. Aby s ním rezervační plugin uměl spolupracovat, očekává od něj tento kontrakt:

1. **Verify routa** — `POST /_emdash/api/plugins/<id>/verify` (`public: true` není nutné — volá ji server rezervačního pluginu), vstup `{ token: string, remoteIpHash?: string }`, výstup `{ ok: boolean, code?: string }`.
2. **Klientský widget** — captcha plugin dodá způsob, jak vykreslit widget do DOM slotu `<div data-rsv-captcha>` v rezervačním formuláři (typicky `page:fragments` skript nebo exportovaná komponenta), a po vyřešení výzvy zapíše token do skrytého inputu `input[name="captchaToken"]` / vystaví `window` event.
3. **Konfigurace** (provider, site key, secret) je plně ve vlastním `settingsSchema` captcha pluginu — rezervační plugin o ní neví.

Rezervační strana kontraktu (DOM slot, `captchaToken` v DTO, delegovaný verify krok, nastavení `captchaPluginId`) se implementuje už v v1, takže napojení captcha pluginu nevyžaduje žádnou změnu kódu rezervací.
