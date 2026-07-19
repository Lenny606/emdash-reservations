# Specifikace: NPM balíček „Reservations"

Specifikace distribuce rezervačního pluginu ([SPEC.md](./SPEC.md)) jako samostatného npm balíčku. Cílový uživatel: provozovatel libovolného EmDash webu, který si plugin nainstaluje přes `npm install` a zaregistruje v `astro.config.mjs` — bez přístupu k tomuto repozitáři. Implementační kroky řeší [NPM_PLAN.md](./NPM_PLAN.md).

**Předpoklad:** plugin je dokončený a funkční ve workspace (PLAN.md fáze 1–7). Tento dokument popisuje cílový stav balíčku, ne jeho vývoj.

## 1. Distribuční model

| Rozhodnutí | Volba | Zdůvodnění |
| --- | --- | --- |
| Kanál | **Veřejný npm registry** | Standardní cesta pro config-based EmDash pluginy (docs: „Distributing native plugins"). |
| Režim u uživatele | **Trusted, in-process** (`plugins: []`) | Od NATIVE_PLAN N1 plugin běží ve `format: "native"` — tenhle režim teď není jen doporučený, ale **technicky vynucený**: `PluginDescriptor.format: "native"` smí běžet jen v `plugins: []`, nemůže do `sandboxed: []` ani na marketplace (NATIVE_SPEC §1). Původní důvody (`.astro` komponenta, same-origin captcha `fetch`) platí beze změny a jsou teď jen jeden z několika argumentů, ne jediný. |
| Marketplace | **Mimo rozsah** (viz §8) | Vyžadoval by změnu architektury, ne jen přebalení. |
| Vývojové prostředí | Tento repozitář zůstává na `workspace:*` | Web v tomto repu je testbed pluginu; publikovaná verze se ověřuje v čistém projektu mimo workspace (NPM_PLAN fáze N4). |

## 2. Identita balíčku (otevřená rozhodnutí)

Bez těchto rozhodnutí nelze publikovat; blokují fázi N1:

| # | Rozhodnutí | Varianty | Doporučení |
| --- | --- | --- | --- |
| 1 | **Jméno** — současné `@emdash-reservations/plugin-reservations` je workspace-lokální; scope na npm neexistuje | (a) založit org scope, (b) osobní scope `@<npm-username>/emdash-plugin-reservations`, (c) nescoped `emdash-plugin-reservations` | (b) — bez zakládání org, jasná konvence `emdash-plugin-*`. Dostupnost ověřit `npm view` předem. Přejmenování se propíše do descriptor `entrypoint` a importů webu. |
| 2 | **Licence** | MIT / Apache-2.0 / proprietární | MIT (bezpečný default, npm ji prakticky vyžaduje) |
| 3 | **Veřejný repozitář** — pole `repository`/`bugs`/`homepage` | tento repo / samostatné repo / žádné | Samostatné repo až při potřebě CI release workflow; do té doby bez `repository` pole nebo odkaz sem |
| 4 | **Zdroj Zod** | ponechat `astro/zod` / vlastní `zod` dependency | Ponechat `astro/zod` — astro je tak jako tak povinný peer, jedna závislost méně |

## 3. Obsah balíčku: co se buildí a co zůstává zdrojem

Klíčové architektonické rozhodnutí distribuce — balíček má **dvě povahy obsahu**:

| Část | Distribuce | Důvod |
| --- | --- | --- |
| `src/index.ts` (descriptor), `src/runtime.ts` (+ jejich importy ze `server/`, `shared/`) | **Kompilované ESM + `.d.ts` v `dist/`** (tsdown) | Server kód; uživatelův bundler ho nemá kompilovat z TS zdroje |
| `src/components/*.astro` | **Zdroj** | Astro konzumuje `.astro` soubory přímo, bez buildu (stejný mechanismus jako `componentsEntry` u native pluginů) |
| `src/client/*.ts`, `src/shared/*.ts` | **Zdroj** | Importuje je `<script>` v `.astro` komponentě — kompiluje je Vite uživatelova webu. `shared/` musí být ve zdroji, protože klient z něj bere DTO typy (server verze téhož kódu je zabalená v `dist/`) |
| `src/admin/**/*.tsx` (React admin, `adminEntry`) | **Otevřené — mimo rozsah tohoto dokumentu** | Přibylo s NATIVE_PLAN N1-N6, po sepsání této specifikace. Vyžaduje vlastní rozhodnutí (kompilovat do `dist/` jako server kód, nebo distribuovat jako zdroj podobně jako `.astro` komponenta — admin běží v hostitelově React/Vite stromu, ne izolovaně) — dořeší NPM_PLAN, až se distribuce reálně naplánuje. |
| SPEC.md, PLAN.md, NATIVE_SPEC.md, NATIVE_PLAN.md, NPM_SPEC.md, NPM_PLAN.md, testy | **Nebalí se** | Interní dokumenty; uživatel dostává `README.md` |

Omezení z toho plynoucí:

- `ReservationCalendar.astro` importuje klienta **relativní cestou** (`../client/...`), nikdy přes package self-reference — self-reference z `node_modules` nemusí resolvovat.
- `src/index.ts` (descriptor) nesmí importovat nic ze `shared/`/`server/` — zůstává minimální a side-effect-free (běží ve Vite při buildu webu).
- Duplicitní kompilace `shared/` (jednou v `dist/`, jednou jako zdroj pro klienta) je záměr, ne chyba — obě strany potřebují stejné DTO kontrakty ve své kompilační doméně.

## 4. Kontrakt package.json

```jsonc
{
	"name": "<dle §2.1>",
	"version": "0.2.0",
	"type": "module",
	"license": "<dle §2.2>",
	"description": "Weekly reservation calendar plugin for EmDash CMS (7 days × 30min slots) with a native React admin.",
	"keywords": ["emdash", "emdash-plugin", "reservations", "booking", "astro"],
	"exports": {
		".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
		"./runtime": { "types": "./dist/runtime.d.ts", "import": "./dist/runtime.js" },
		"./admin": "<TBD -- distribuční strategie ještě nerozhodnutá, viz §3>",
		"./components": "./src/components/index.ts" // zdroj — záměrně, viz §3
	},
	"files": ["dist", "src/components", "src/client", "src/shared", "README.md"], // src/admin přibude, viz §3
	"sideEffects": false,
	"engines": { "node": ">=20" }, // Web Crypto + fetch globálně
	"peerDependencies": {
		"emdash": ">=0.28.1 <0.29.0", // viz §5
		"astro": "^7.0.0",
		"react": "^19.0.0", // nové s native adminem (NATIVE_PLAN N1) -- admin běží v hostitelově React stromu
		"react-dom": "^19.0.0", // nové
		"@cloudflare/kumo": "2.6.0" // nové, přesně pinned -- interní design systém hostitelského adminu, ne stabilní veřejné API; stejné zdůvodnění jako úzký emdash rozsah v §5
	},
	"scripts": {
		"build": "tsdown",
		"prepublishOnly": "pnpm build"
	}
}
```

Klient (`src/client/*.ts`) zůstává vanilla TS, žádné runtime dependencies tam (Zod přes `astro/zod`, viz §2.4) — React/Kumo peery jsou nové výhradně kvůli admin bundlu (`src/admin/**`), ne kvůli veřejné straně.

## 5. Kompatibilita a verzování

- **Peer rozsah emdash je záměrně úzký: `>=0.28.1 <0.29.0`.** Plugin staví na interním tvaru API ověřeném reverse-engineeringem `node_modules` (PLAN fáze 0, NATIVE_SPEC §2): `format: "native"` + pojmenovaný `export function createPlugin()` vracející `definePlugin({...})` z `"emdash"` (**ne** `export default` — shodí celý web, NATIVE_SPEC N0-8), jednoargumentové routy (`RouteContext<TInput>`), admin manifest (`adminMode`) čtený z `definePlugin()`'s `admin: { entry, pages }`, ne z descriptoru (NATIVE_SPEC N0-12). Dokumentace popisuje novější, odlišné API — tvar se mezi verzemi mění. Široký rozsah by u uživatelů rozbíjel plugin při minor updatech emdash.
- **Rozšíření rozsahu = re-verifikace.** Každá nová podporovaná verze emdash projde plnou verifikací mimo workspace (NPM_PLAN N4) a zvedne minor verzi balíčku.
- **Verzování balíčku:** semver; `0.x` dokud je peer rozsah takto svázaný. `CHANGELOG.md` (ručně, changesets až s CI).
- **README musí kompatibilitu uvádět viditelně** — podporovaný rozsah emdash a fakt, že plugin je trusted-only.

## 6. Dokumentace balíčku (README.md)

Povinný obsah — jediný dokument, který uživatel dostane:

1. Instalace a registrace (`npm install`, `plugins: [reservationsPlugin()]`, trusted-only poznámka).
2. Setup stránky: import `ReservationCalendar` z `<name>/components`, příklad stránky včetně `Astro.cache.set`.
3. Konfigurace: tabulka všech `settings:*` klíčů (SPEC §6) + kde je najít v adminu (React stránka „Reservations" v sidebaru pod „Plugins").
4. Integrační kontrakty: captcha plugin (SPEC §10) a e-mail transport — co nainstalovat, aby se funkce aktivovaly; fail-closed chování captchy.
5. Bezpečnostní model: co CSRF/honeypot/rate-limit chrání a nechrání (PLAN riziko #4).
6. Kompatibilita (§5) a changelog.

## 7. Kvalitativní brány publikace

Publikace je platná jen po průchodu všemi branami (pořadí v NPM_PLAN):

1. **Build brána** — `pnpm build` produkuje kompletní `dist/` včetně `.d.ts`.
2. **Tarball brána** — `pnpm publish --dry-run`: obsah tarballu odpovídá `files` whitelistu položku po položce.
3. **Izolační brána** — tarball nainstalovaný do čistého EmDash starteru mimo workspace: dev server, end-to-end rezervace, admin stránka, `astro check` (typy z `.d.ts`), `astro build`. Workspace maskuje chyby v `exports`/`files` — tato brána je proto povinná, ne volitelná.
4. **Release brána** — git tag verze až po průchodu izolační branou; `--provenance` při publikaci z CI.

## 8. Mimo rozsah

- **EmDash Marketplace** (`emdash plugin bundle`/`publish`). Marketplace instaluje sandboxed, kde: (a) `.astro` komponenta se nedistribuuje — web by musel kalendář stavět sám proti API routám; (b) delegovaný captcha verify přes globální `fetch` sandbox zablokuje; (c) marketplace tooling v docs odpovídá novějšímu API než nainstalovaná verze emdash. Marketplace verze by byla samostatná specifikace s úpravou architektury (headless API-only varianta), ne přebalení.
- **CI release pipeline** (GitHub Actions, changesets) — dává smysl až se samostatným veřejným repozitářem (§2.3); první publikace proběhne ručně.
- **Vícebalíčková distribuce** (oddělený `@.../reservations-ui`) — zbytečné, dokud je jediný konzument komponenty Astro.

## 9. Rizika

| # | Riziko | Dopad | Mitigace |
| --- | --- | --- | --- |
| N-1 | Závislost na interním tvaru API emdash 0.28.x (§5) | Minor update emdash u uživatele rozbije plugin | Úzký peer rozsah; README kompatibilita; re-verifikace před každým rozšířením |
| N-2 | Chyby v `exports`/`files` neviditelné ve workspace (self-reference, chybějící soubor) | Nefunkční balíček po instalaci | Izolační brána (§7.3) + dry-run kontrola tarballu (§7.2) |
| N-3 | Kompilace `.astro`/TS zdroje z `node_modules` u uživatele | Build chyby mimo naši kontrolu | Izolační brána běží na čistém starteru bez speciální konfigurace — co projde tam, projde obecně |
| N-4 | Jméno/scope na npm nedostupné | Blokuje publikaci | §2.1 rozhodnout a ověřit `npm view` před fází N1 |
