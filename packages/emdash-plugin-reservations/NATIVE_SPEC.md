# Specifikace: Přechod pluginu „Reservations" na native formát

Cílový stav pluginu po přechodu z `format: "standard"` na `format: "native"`. Nahrazuje admin UI ze [SPEC.md](./SPEC.md) §6 a **plně pohlcuje rozsah** [ADMIN_SPEC.md](./ADMIN_SPEC.md) (seznam s filtry, detail, editace, ruční vytvoření, storno s notifikací) — ADMIN_SPEC.md a ADMIN_PLAN.md se tímto dokumentem a [NATIVE_PLAN.md](./NATIVE_PLAN.md) nahrazují (Block Kit admin se nedokončuje, přepisuje se rovnou na React). Implementační kroky řeší NATIVE_PLAN.md.

Veřejná strana (`/reservations`, `public/*` routy, `ReservationCalendar.astro`, klient) se **nemění** — přechod se týká výhradně admin UI a interního tvaru pluginu (descriptor, entrypoint, routy).

## 1. Proč a co se získává

Zjištěno v probíhající konverzaci (ne reverse-engineering nový nález, ale rozhodnutí): Block Kit (`@emdash-cms/blocks`) neumí nic mimo pevnou sadu elementů — žádný `type="color"`, žádný živý JS na klientovi, `context` blok je jen prostý text. Native formát dává admin stránce plnou React kontrolu:

- Skutečný `<input type="color">` s živým náhledem barvy vedle hex textu (viz §5.3) — původní zadání této práce.
- Skutečný React state pro navigaci mezi pohledy (seznam/detail/edit/create/settings) místo kódování stavu do `action_id`/`value` (ADMIN_SPEC §2 se ruší — byl to Block Kit-specifický obchvat).
- Potvrzovací dialogy s libovolným obsahem (např. budoucí pole "důvod stornování" — ADMIN_SPEC §9 bod 2 byl blokovaný jen tím, že Block Kit `confirm` dialog nemá vstupní pole; v Reactu to omezení mizí, i když se do rozsahu v1 nezařazuje, viz §8).

**Bezpečnostní model se nemění.** Plugin dnes běží `format: "standard"` registrovaný v `plugins: []` — tedy už teď **trusted, in-process, bez sandbox izolace** (NPM_SPEC §1). Native formát na tomto nic nemění; jen dovoluje `adminEntry` s React komponentami místo Block Kit JSON. Podle `PluginDescriptor.format` dokumentace (`node_modules/emdash@0.28.1`) native plugin *musí* běžet v `plugins: []` (nemůže do `sandboxed: []` ani na marketplace) — to už dnešní registrace splňuje beze změny.

## 2. Ověřené API (emdash 0.28.1, `node_modules/emdash/dist/*.d.mts`)

Stejně jako PLAN.md fáze 0 upozorňuje: `search_docs` MCP popisuje **novější** tvar API (`emdash-plugin.jsonc` + manifest, `sandboxed: []`), který v nainstalované `0.28.1` neexistuje. Ověřeno přímo v `.d.mts`:

| # | Zjištění |
| --- | --- |
| N0-1 | `PluginDescriptor.format?: "standard" \| "native"`. `"native"` — entrypoint exportuje `createPlugin(options)` vracející `ResolvedPlugin` (výstup `definePlugin()` z `"emdash"`, ne `"emdash/plugin"`). Může běžet **jen** v `plugins: []`. |
| N0-2 | Native routy mají **jednoargumentový** handler: `(ctx: RouteContext<TInput>) => Promise<unknown>`, kde `RouteContext<TInput> extends PluginContext` a navíc nese `input: TInput`, `request: Request` (**skutečný** `Request`, ne sériový záznam jako u standard formátu), `requestMeta: RequestMeta`. Všechny 4 routy v `sandbox-entry.ts` (`public/csrf`, `public/availability`, `public/reserve`, `admin`) potřebují přepsat signaturu. |
| N0-3 | `PluginDescriptor.adminEntry` — modulový specifikátor (např. `"@emdash-reservations/plugin-reservations/admin"`). Modul musí exportovat `PluginAdminModule = { widgets?: Record<string, ComponentType>, pages?: Record<string, ComponentType>, fields?: Record<string, ComponentType> }` (`@emdash-cms/admin`, `dist/index.d.ts:58`). Klíče `pages` musí odpovídat `adminPages[].path` (dnes `/reservations`). |
| N0-4 | **Rozpor s `search_docs`:** dokumentace “React admin pages” ukazuje import `{ Card, Button, Input, Select, Toggle, Table, Pagination, Alert, Loading }` a `usePluginAPI` z `@emdash-cms/admin`. **Žádné z toho v nainstalované `@emdash-cms/admin@0.28.1` neexistuje** (ověřeno vypsáním všech exportů z `dist/index.d.ts`) — `usePluginAPI` není nikde v žádném nainstalovaném `@emdash-cms/*` balíčku. Skutečně dostupné z `@emdash-cms/admin`: `usePluginPage`, `usePluginWidget`, `usePluginField`, `usePluginAdmins`, `usePluginHasPages`, `apiFetch` (generický fetch wrapper), `PluginAdminProvider`. UI prvky (tlačítka, inputy, dialogy...) se musí brát přímo z `@cloudflare/kumo` — viz §7. |
| N0-5 | `@cloudflare/kumo@2.6.0`'s `Input` (`dist/src/components/input/input.d.ts`) je tenký wrapper nad `@base-ui/react/input`, typ props `Omit<ComponentPropsWithoutRef<typeof BaseInput>, "size">` — **`type` není vyloučené**, takže `<Input type="color" .../>` je platné a vykreslí skutečný nativní color picker prohlížeče. Ověřeno staticky (typy), ne live — viz NATIVE_PLAN N0 pro runtime ověření. |
| N0-6 | Kumo obsahuje potřebné komponenty pro celý rozsah ADMIN_SPEC: `button`, `dialog` (potvrzovací dialogy s libovolným obsahem), `table`, `pagination`, `switch` (toggle), `select`, `banner` (chybové hlášky), `field`, `input`, `input-group`, `loader`, `toast`. Žádná komponenta nechybí pro plnou paritu s ADMIN_SPEC §1–§7. |
| N0-7 | `options?: TOptions` na `PluginDescriptor` je nyní použitelné (native-only pole) — dnes plugin žádné konstruktorové opce nepotřebuje, necháváme nevyplněné. |
| N0-8 | **Živě ověřeno na POC (`src/poc/runtime.ts`), ne jen staticky:** emdash 0.28.1 generuje `import { createPlugin } from entrypoint` (`dist/astro/index.mjs:1159`) — vyžaduje **pojmenovaný** export. `export default function createPlugin()` (jak §3 dřív ukazovalo) shodí načtení `virtual:emdash/plugins` a s ním **celý web** (`TypeError: createPlugin is not a function`), ne jen tento plugin. §3 opraveno na `export function createPlugin()`. |
| N0-9 | **NT-2 uzavřeno, živě ověřeno na POC `ping` routě:** nepublic native routa (bez `public: true`) neprojde bez admin session -- `curl` bez cookie vrátí `401 {"error":{"code":"UNAUTHORIZED"}}`; s dev-bypass cookie **a** hlavičkou `X-EmDash-Request: 1` vrátí `200`. Bez té hlavičky (i s platnou cookie) vrátí `403 CSRF_REJECTED` -- tedy nejen session cookie, i `X-EmDash-Request` header je vyžadovaný pro *všechny* metody (ne jen POST). `apiFetch` z `@emdash-cms/admin`/`emdash/plugin-utils` ho nastavuje automaticky, takže React admin (N3+) nemusí nic navíc řešit, pokud vždy volá přes `apiFetch`. |
| N0-10 | **NT-3 uzavřeno, reprodukováno i na native dispatcheru:** autentizované GET s `X-EmDash-Request` header a `input:` Zod schématem + query parametrem vrátí `400 {"error":{"code":"VALIDATION_ERROR","message":"Invalid request body"}}` -- dispatcher se pořád pokusí parsovat JSON tělo bez ohledu na metodu, stejná vlastnost jako u standard formátu (PLAN.md fáze 3). Potvrzuje, že NATIVE_SPEC §4 rozhodnutí (všechny admin routy POST) je správné, ne jen opatrné. |
| N0-12 | **Objeveno po N3, uživatel nahlásil "nevidím to v adminu":** stránka se vykreslila správně na přímou navigaci (URL), ale **nikde v adminu na ni nevedl žádný odkaz** -- sidebar neměl sekci pluginu. Příčina: descriptor's `adminEntry`/`adminPages` (`src/index.ts`) řídí jen build-time načtení modulu (proto přímá navigace fungovala) -- **klientský manifest** (`/_emdash/api/manifest`, `plugins.<id>.adminMode`/`adminPages`, co čte sidebar) se počítá z `plugin.admin` na *resolved* pluginu (`emdash-runtime.ts`: `hasAdminEntry = !!plugin.admin?.entry; adminMode = hasAdminEntry ? "react" : hasAdminPages\|\|hasWidgets ? "blocks" : "none"`) -- tedy z pole `admin: { entry, pages }` uvnitř **`definePlugin()`**, ne z descriptoru. To pole jsem v N1 do `definePlugin()` nedoplnil (jen na descriptor) -- `adminMode` bylo `"none"`, žádný nav link. **Oprava:** `runtime.ts`'s `definePlugin()` teď má `admin: { entry: ".../admin", pages: [{ path: "/reservations", ... }] }`, duplicitně s descriptorem (NT-4). Po opravě `adminMode: "react"`, sidebar má sekci "Plugins → Reservations", klik navede na správnou stránku. **POC (`reservations-native-poc`) má stejnou vadu, neopraveno** -- byl to jen ověřovací kód, ne finální implementace (NATIVE_PLAN N0/N7 ho stejně maže). |
| N0-11 | **Objeveno v NATIVE_PLAN N2, živě reprodukováno:** `throw new PluginRouteError(...)` (i přes statické factory `.conflict()`/`.notFound()`/`.badRequest()`) z routy tohoto pluginu **nikdy** neprojde jako svůj HTTP status -- vždy skončí jako `500 {"error":{"code":"INTERNAL_ERROR","message":"An internal error occurred"}}`. Příčina: `pnpm-lock.yaml` ukazuje, že plugin balíček (peer na `emdash`, `@emdash-cms/admin`, `@cloudflare/kumo`) resolvuje `emdash` do **jiné** pnpm peer-dependency instance (`.pnpm/emdash@0.28.1_..._fbf93d17...`) než hostitelský web/dispatcher (`.pnpm/emdash@0.28.1_..._241157261d...`) -- `error instanceof PluginRouteError` v `PluginRouteHandler.invoke`'s catch bloku (`emdash/src/plugins/routes.ts:148`) proto selže napříč těmito dvěma fyzicky odlišnými třídami, i když jde o stejnou verzi balíčku. Ověřeno přímo stack tracem (throw v jedné `.pnpm` cestě, catch v druhé). **Dopad:** jakýkoliv `throw PluginRouteError` z routy tohoto pluginu je efektivně nepoužitelný -- včetně již existujícího `public/availability`'s `PluginRouteError.badRequest` pro neplatný `weekStart` (potvrzeno stejným chováním, `500` místo `400`; v praxi neškodné, protože `calendar.ts` vždy posílá platný `weekStart`, ale přímé/škodlivé volání API by dostalo špatný status i zprávu). **Řešení pro N2:** všechny nové admin routy vrací `AdminActionResult<T>` (`{ ok, data } \| { ok:false, code, message }`) jako normální `200` odpověď místo throw -- stejný vzor jako `public/reserve` už používal. `public/availability`'s dva pre-existing throwy zůstávají zatím nedotčené (mimo rozsah N2, viz PLAN.md odchylky) -- do budoucna by je měl stejný vzor nahradit. Kořenová příčina (duplicitní pnpm instance) neopravena -- vyžadovalo by zásah do workspace dependency resolution (mimo rozsah tohoto pluginu). |

## 3. Descriptor a entrypointy

`src/index.ts` (beze změny v principu — čistý, side-effect-free descriptor):

```ts
export function reservationsPlugin(): PluginDescriptor {
  return {
    id: "reservations",
    version: "0.2.0",
    format: "native",                                              // było "standard"
    entrypoint: "@emdash-reservations/plugin-reservations/runtime", // přejmenováno ze "/sandbox"
    adminEntry: "@emdash-reservations/plugin-reservations/admin",   // nové
    capabilities: ["email:send"],
    storage: { /* beze změny */ },
    adminPages: [{ path: "/reservations", label: "Reservations", icon: "calendar" }],
  };
}
```

`src/sandbox-entry.ts` → přejmenovat na `src/runtime.ts` (název "sandbox" už neodpovídá realitě — native neběží v sandboxu). Default export mění tvar z holého `{ hooks, routes } satisfies SandboxedPlugin` na:

```ts
import { definePlugin } from "emdash";

export function createPlugin() { // pojmenovaný export -- viz N0-8, default shodí celý web
  return definePlugin({
    id: "reservations",
    version: "0.2.0",
    capabilities: ["email:send"],
    storage: { /* stejné jako descriptor.storage */ },
    hooks: { /* beze změny obsahu, jen typy z "emdash" místo "emdash/plugin" */ },
    routes: { /* přepsané signatury, viz §4 */ },
  });
}
```

Poznámka k duplicitě `id`/`version`/`capabilities`/`storage` mezi descriptorem a `definePlugin()`: obojí je required v této verzi (native runtime přes `definePlugin` je samostatně typované, ne odvozené z descriptoru) — udržet ručně v sync, NATIVE_PLAN N1 na to má explicitní ověřovací krok.

## 4. Routy

Všechny routy (`public/csrf`, `public/availability`, `public/reserve` beze změny v logice, jen v obálce) přejdou na jednoargumentovou signaturu:

```ts
// před (standard):
handler: async (routeCtx, ctx) => { ... routeCtx.input ... routeCtx.request.url ... }

// po (native):
handler: async (ctx) => { ... ctx.input ... ctx.request.url ... }
```

`readRequestMeta` helper padá pryč — `ctx.requestMeta` je už typované jako `RequestMeta`, žádné ruční `unknown` přetypování.

**`public/availability` zůstává obezřetná u GET:** PLAN.md fáze 3 zjistila, že `handlePluginApiRoute` v této verzi vždy volá `request.json()` bez ohledu na metodu, takže `input:` Zod validace na GET routách nefunguje a query parametry se musí parsovat ručně z `ctx.request.url`. Tohle zjištění bylo o standard-formátu; jestli native dispatcher má stejnou vlastnost, se **musí ověřit znovu** (NATIVE_PLAN N0) — pravděpodobně sdílená infrastruktura, ale nejistota trvá, dokud se neotestuje živě.

**Blok Kit `admin` routa mizí úplně.** Nahrazuje ji sada JSON API rout pro admin stránku (React ji volá z prohlížeče, ne server-side jako Block Kit). Návrh — **všechny POST**, i čtecí, aby se obešla nejistota kolem GET/`input:` z bodu výše (jednotné, ověřitelné chování bez ohledu na to, jak native dispatcher GET řeší):

| Routa | Vstup (Zod) | Výstup | Nahrazuje |
| --- | --- | --- | --- |
| `admin/settings-get` | — | `ReservationSettings` | `buildSettingsFormBlocks` čtecí část |
| `admin/settings-save` | `Partial<ReservationSettings>` | `ReservationSettings` | `saveSettingsFromForm` |
| `admin/overview` | — | `{ thisWeek, pending, confirmed, cancelled }` | `buildOverviewBlocks` |
| `admin/reservations-list` | `AdminListFilterDto` (§6) | `{ items: AdminReservationSummaryDto[], nextCursor? }` | `buildPendingListBlocks` + `buildReservationsTableBlocks`, sjednoceno do jednoho filtrovatelného seznamu (ADMIN_SPEC §3) |
| `admin/reservation-detail` | `{ id: string, fromHistory?: boolean }` | `AdminReservationDetailDto` | nové (ADMIN_SPEC §4) |
| `admin/reservation-confirm` | `{ id: string }` | `AdminReservationDetailDto` | `confirmReservation` |
| `admin/reservation-cancel` | `{ id: string }` | `AdminReservationDetailDto` | `cancelReservation` + nově automatická `notifyCancellation` (ADMIN_SPEC §5, §6) |
| `admin/reservation-delete` | `{ id: string, fromHistory?: boolean }` | `{ ok: true }` | nové (ADMIN_SPEC §5) |
| `admin/reservation-create` | `AdminUpsertReservationDto` | `AdminReservationDetailDto` | nové (ADMIN_SPEC §5, §9) |
| `admin/reservation-update` | `{ id: string } & AdminUpsertReservationDto` | `AdminReservationDetailDto` | nové, včetně re-key při změně slotu (ADMIN_SPEC §5) |

Žádná z těchto rout je `public: true` — chráněné admin session autentizací hostitele (výchozí chování pro nepublic native routy; ověřit v NATIVE_PLAN N0, nikdy to nebylo potřeba testovat, protože Block Kit `admin` routa fungovala implicitně přes existující admin session stránky).

## 5. Admin UI (React)

### 5.1 Struktura modulu

```
src/admin/
  index.tsx                 # export const pages = { "/reservations": ReservationsAdminPage }
  ReservationsAdminPage.tsx # view-state router (list/detail/edit/create/settings), nahrazuje ADMIN_SPEC §2 action_id konvenci
  api.ts                    # typované volání admin/* rout (fetch + Zod parse odpovědí)
  views/
    ListView.tsx            # filtr + tabulka + Pagination (Kumo table + pagination)
    DetailView.tsx          # Kumo field/text bloky + akční tlačítka dle stavu (ADMIN_SPEC §4 tabulka)
    EditView.tsx            # sdílený s CreateView přes společný <ReservationForm>
    CreateView.tsx
    SettingsView.tsx        # formulář nastavení, viz §5.3
  components/
    ColorField.tsx           # viz §5.3
    ConfirmButton.tsx        # Kumo Dialog + Button, nahrazuje ButtonElement.confirm
    StatCards.tsx            # overview čísla
```

### 5.2 Navigace

`ReservationsAdminPage` drží `useState<{ view: "list" | "detail" | "edit" | "create" | "settings"; id?: string; filters: AdminListFilterDto }>`. Žádné kódování do URL/`value` payloadu — to byl Block Kit obchvat kvůli stateless routě (ADMIN_SPEC §2), v Reactu zbytečný. Volitelné pozdější vylepšení (mimo rozsah v1): TanStack Router `useNavigate`/`useParams` je už peer-dostupný přes `@tanstack/react-router` (vidět v `@emdash-cms/admin` importech) pro syncování view do URL — nice-to-have, ne blokující.

### 5.3 Barvy nastavení — původní zadání této práce

```tsx
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-kumo-line p-1"
        aria-label={`${label} – color picker`}
      />
      <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
    </div>
  );
}
```

Použití holého `<input type="color">` (ne Kumo `Input` s `type="color"`) je záměr — Kumo `Input` přidává Field wrapper (label, error, description) navržený pro textové vstupy; nativní `<input type="color">` je vizuálně malý čtvereček a nepotřebuje ten aparát. Pokud se v NATIVE_PLAN N0 ukáže, že Kumo `Input` s `type="color"` vypadá lépe / stačí, lze sjednotit — otevřené na implementaci, ne blokující rozhodnutí.

Živý náhled = přímo obsah color inputu (prohlížeč ho vykresluje jako barevný čtverec) + `value` v sousedním textovém poli se aktualizuje při každé změně (`useState`, žádný submit/reload jako u dnešního Block Kit řešení, které ukazovalo jen barvu z posledního uloženého stavu v labelu).

### 5.4 Zbytek ADMIN_SPEC.md — beze změny v doménové logice

Sekce ADMIN_SPEC §3 (seznam), §4 (detail), §5 (sémantika akcí), §6 (notifikace), §7 (DTO) platí **obsahově beze změny** — mění se jen transportní vrstva (JSON API routy místo Block Kit interakcí) a render (React views místo block builderů). Konkrétně přebírá se beze změny:

- Filtrace/řazení/stránkování (ADMIN_SPEC §3) — `admin/reservations-list` implementuje shodnou in-memory kombinaci filtru a řazení nad plochými indexy.
- Tabulka akcí podle stavu (ADMIN_SPEC §4) — `DetailView` vykresluje tlačítka podle stejné matice.
- Sémantika Potvrdit/Upravit/Storno/Smazat/Vytvořit včetně re-key při přesunu slotu a admin-výjimek při ručním vytvoření (ADMIN_SPEC §5).
- `notifyCancellation`, `renderCancellationEmail`, rozšíření `notifications.ts` (ADMIN_SPEC §6).
- `AdminReservationDetailDto`, `AdminUpsertReservationDto`, `AdminListFilterDto`, `toAdminDetailDto`, `fromAdminUpsert` (ADMIN_SPEC §7) — DTO se navíc doplní o `AdminReservationSummaryDto` (odlehčená verze pro řádky seznamu, bez plného meta).

## 6. Sdílené DTO (`shared/dto.ts`)

Nové Zod schémata vedle stávajících veřejných DTO:

```ts
export const AdminListFilterDto = z.object({
  status: z.enum(["pending", "confirmed"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  email: z.string().optional(),
  showCancelled: z.boolean().default(false),
  cursor: z.string().optional(),
});

export const AdminUpsertReservationDto = z.object({
  date: z.string(),
  startTime: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  note: z.string().optional(),
  status: z.enum(["pending", "confirmed"]).default("confirmed"),
});
```

`AdminReservationDetailDto`/`AdminReservationSummaryDto` jsou plain TS typy (výstupní, ne vstupní validace).

## 7. Závislosti a `package.json`

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./runtime": "./src/runtime.ts",       // přejmenováno z "./sandbox"
    "./admin": "./src/admin/index.tsx",    // nové
    "./components": "./src/components/index.ts"
  },
  "peerDependencies": {
    "astro": "^7.0.0",
    "emdash": "^0.28.1",
    "react": "^19.0.0",           // nové — verze podle nainstalovaného react@19.2.4 v hostitelském webu
    "react-dom": "^19.0.0",       // nové
    "@cloudflare/kumo": "2.6.0"   // nové, přesně pinned jako emdash (§ pod tímto blokem) — ne rozsah, viz zdůvodnění
  }
}
```

**`@cloudflare/kumo` jako peerDependency, přesně pinned (ne `^2.6.0`).** Kumo je interní design systém hostitelského admin UI, ne stabilní veřejné API — stejné zdůvodnění jako u úzkého `emdash` peer rozsahu (NPM_SPEC §5): plugin vykresluje Kumo komponenty *do stejného React stromu* jako hostitel, takže musí použít přesně tu verzi, kterou hostitel dodává (jinak riziko duplicitních React kontextů / vizuálních nekonzistencí při vydání nové major verze Kumo s breaking změnami tříd/props). Rozšíření rozsahu = re-verifikace, stejně jako u emdash peer.

`@types/react`, `@types/react-dom` do `devDependencies` pro typecheck.

**`@emdash-cms/blocks` odstraněna (NATIVE_PLAN N7).** Byla `dependencies` jen kvůli Block Kit builderům v `server/admin-ui.ts`, smazaném v N3 — od té chvíle nepoužitá. Rozhodnutí "nechat pro případné budoucí `fieldWidgets`/`portableTextBlocks`" zvráceno: YAGNI, nic takového se neplánuje; přidat zpátky je triviální, kdyby to jednou bylo potřeba.

## 8. Mimo rozsah

Beze změny z ADMIN_SPEC §8, plus:

- **Vstupní pole "důvod stornování"** (ADMIN_SPEC §9 bod 2) — Block Kit omezení, které přechodem na native mizí, ale do v1 se nezařazuje (drží se rozsah bodu 2 z konverzace: plný ADMIN_SPEC rozsah, nic navíc).
- Synchronizace view-state do URL (TanStack Router) — nice-to-have, viz §5.2.
- Marketplace/sandboxed distribuce — potvrzeno mimo rozsah i pro native (native to navíc explicitně technicky zakazuje, viz §1).

## 9. Rizika

| # | Riziko | Dopad | Mitigace |
| --- | --- | --- | --- |
| NT-1 | ✅ **Uzavřeno** (viz N0-3/N0-3-ověření v N1). `adminEntry` resolvuje a vykresluje React (ověřeno na `src/admin/index.tsx` placeholderu i na POC), i po studeném restartu dev serveru. |
| NT-2 | ✅ **Uzavřeno** (N0-9). Nepublic native routy vyžadují admin session cookie + `X-EmDash-Request` header; bez session `401`, bez headeru `403 CSRF_REJECTED`. |
| NT-3 | ✅ **Uzavřeno** (N0-10). GET/`input:` bug se reprodukuje i u native dispatcheru -- potvrzuje, že "všechny admin routy POST" (§4) je nutné, ne jen opatrné. |
| NT-4 | Duplicitní deklarace `id`/`version`/`capabilities`/`storage` **a `admin`** mezi descriptorem a `definePlugin()` | Rozjetí při update jen na jedné straně | ⚠️ **Skutečně se to stalo** (viz N0-12) -- `admin: { entry, pages }` se v N1 nedostalo do `definePlugin()`, jen na descriptor. NATIVE_PLAN N1 explicitní diff-check krok tohle nezachytil (nebyl striktně proveden); doplněno zpětně. |
| NT-5 | Kumo verze se v hostitelském webu časem posune | Native admin stránka se vizuálně/funkčně rozjede od zbytku adminu | Přesný pin (§7), re-verifikace při každém emdash/kumo upgradu |
| NT-6 | Rozsah práce je výrazně větší než prostý "port" (ADMIN_SPEC celý rozsah + native migrace zároveň) | Delší doba do funkčního stavu, víc příležitostí k regresi veřejné strany | NATIVE_PLAN fázovaný tak, že po každé fázi je web funkční (stejný princip jako PLAN.md); veřejná strana (`public/*`) se mění jen v obálce (§4), nikdy v logice |
