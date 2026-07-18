# Specifikace: Správa rezervací v administraci

Specifikace admin modulu pro správu rezervací. Nahrazuje minimální admin stránku ze [SPEC.md](./SPEC.md) §6 a **rozšiřuje její už implementovanou základní verzi** (PLAN.md fáze 5: settings formulář, přehled, read-only tabulka, pending seznam s Confirm/Cancel) o plnohodnotnou sekci: seznam s filtry, detail každé rezervace, editaci, mazání, ruční vytváření a storno s automatickou notifikací. Implementační kroky řeší [ADMIN_PLAN.md](./ADMIN_PLAN.md).

Platí zjištění z PLAN.md fází 0 a 5:

- Standard formát ⇒ **žádný React, celé UI je Block Kit** vracený z `admin` routy; nastavení KV + Block Kit formulář (žádný `settingsSchema`).
- **`table` blok je read-only** (žádné řádkové akce) — akceschopné řádky se renderují jako `section` s accessory tlačítkem, případně `section` + `actions` dvojice (vzor z fáze 5).
- **Potvrzovací dialog existuje** (`ButtonElement.confirm`) — Smazat/Storno ho používají bez mezikroku.
- Texty admin UI jsou **anglicky** (konzistence s implementovanou fází 5 i visitor-facing textem webu); české názvy v tomto dokumentu jsou popisné, ne doslovné labely.

## 1. Přehled funkcí

| Funkce | Popis |
| --- | --- |
| **Seznam** | Tabulka rezervací s filtry (status, období, e-mail), stránkováním a přepínačem aktivní/stornované. |
| **Detail** | Samostatný pohled na jednu rezervaci — všechna data včetně PII a meta, akční tlačítka. |
| **Editace** | Úprava kontaktních údajů a poznámky; přesun na jiný slot (re-key, viz §5). |
| **Smazání** | Tvrdé odstranění záznamu (aktivního i z historie), s potvrzovacím dialogem. Bez notifikace. |
| **Ruční vytvoření** | Admin založí rezervaci formulářem — mimo veřejnou bezpečnostní pipeline (viz §5). |
| **Storno** | Samostatná akce: rezervace → `cancelled`, přesun do historie, uvolnění slotu, **automatická notifikace zákazníkovi**. |
| **Potvrzení** | Stávající akce `pending → confirmed` (přenesená z původního rozsahu SPEC §6). |

## 2. UI model: Block Kit stavový automat

Block Kit je stateless — každá interakce (`page_load`, `block_action`, `form_submit`) dostane odpověď s kompletními bloky pohledu. Stav pohledu se proto **kóduje do `action_id`/`value` interakcí** a `admin` routa funguje jako router:

```
action_id konvence:  <doména>:<akce>[:<id>]
  nav:list | nav:detail:<id> | nav:edit:<id> | nav:create | nav:settings
  rsv:confirm:<id> | rsv:storno:<id> | rsv:delete:<id>
  form action_id:  rsv:create_save | rsv:edit_save:<id> | list:filter | settings:save
```

Pohledy (všechny renderuje `server/admin-ui.ts`, routa jen routuje a volá doménové operace):

| Pohled | Vstup | Obsah |
| --- | --- | --- |
| `list` (default po `page_load`) | filtr, cursor | Navigace (Seznam · Nová rezervace · Nastavení), `stats` přehled, filtr `form`, `table`, stránkování |
| `detail` | id | `fields` bloky se všemi údaji, `actions` řádek dle stavu (§4) |
| `edit` | id | Předvyplněný `form` |
| `create` | — | Prázdný `form` |
| `settings` | — | Stávající formulář nastavení (SPEC §6) — přesouvá se ze společné stránky do vlastního pohledu |

Filtr a cursor se při navigaci do detailu a zpět předávají ve `value` (serializovaný stav), aby se admin vrátil na stejné místo seznamu.

## 3. Seznam

- **Řádky:** `table` blok řádkové akce neumí (viz úvod), proto se seznam renderuje jako `section` na rezervaci — text s datem + časem slotu, jménem, e-mailem, statusem a stářím — s accessory tlačítkem „Detail" (`nav:detail:<id>`).
- **Filtry:** status (vše / pending / confirmed), období od–do (`date_input`), e-mail (přesná shoda — využívá `email` index), přepínač „zobrazit stornované" (dotazuje `reservations_history` místo `reservations`).
- **Řazení:** `createdAt desc` (index). Alternativní řazení podle data slotu využívá `date` index; kombinace filtru a řazení nad rámec plochých indexů se dořeší in-memory nad stránkou výsledků (composite indexy nejsou v této verzi emdash dostupné — SPEC §2).
- **Stránkování:** kurzorové (`query().cursor`), tlačítko „Další"; návrat na začátek přes reset filtru. Zpětné stránkování storage API nenabízí — mimo rozsah.
- **Kompaktní režim:** volitelně lze nad seznam přidat read-only `table` pro rychlý přehled, ale zdrojem interakcí jsou vždy `section` řádky s tlačítkem.

## 4. Detail

Zobrazuje: slot (datum, čas), status, jméno, e-mail, telefon, poznámku, `createdAt`/`updatedAt`, meta (`ipHash`, `userAgent` — u ručně vytvořených prázdné, viz §5). Admin kontext smí PII zobrazovat — jde o chráněnou `admin` routu; do veřejných DTO nadále nic z toho neprosakuje.

Akční tlačítka podle stavu:

| Akce | `pending` | `confirmed` | `cancelled` (historie) |
| --- | --- | --- | --- |
| Potvrdit | ✔ | — | — |
| Upravit | ✔ | ✔ | — |
| Stornovat | ✔ | ✔ | — |
| Smazat | ✔ (confirm dialog) | ✔ (confirm dialog) | ✔ (confirm dialog) |
| Zpět na seznam | ✔ | ✔ | ✔ |

## 5. Sémantika akcí

| Akce | Efekt | Validace | Notifikace zákazníkovi |
| --- | --- | --- | --- |
| **Potvrdit** | `status: pending → confirmed`, update in place, `updatedAt` | — | `notifyStatusChange` (potvrzení termínu) |
| **Upravit** | Kontaktní pole + poznámka: update in place. **Přesun slotu = re-key:** `id === slotKey`, takže nový slot znamená kolizní check na novém `slotKey` → `put` nového záznamu (zachovat `createdAt`, nový `updatedAt`) → `delete` starého. Kolize ⇒ chybový `banner`, beze změny. | Sanitizace + business validace jako u veřejné cesty (rastr, otevírací doba, aktivní den); e-mail formát | Ne (v1 — viz §9 otevřené rozhodnutí) |
| **Storno** | `status → cancelled`, přesun `reservations` → `reservations_history` (delete + put pod novým ULID), slot se uvolní. Mechanika je hotová ve fázi 5 (`cancelReservation`) — nové je nasměrování notifikace na zákazníka | Jen na aktivní rezervaci | **Ano, automaticky** — `notifyCancellation` (§6) |
| **Smazat** | Tvrdý delete (z aktivních ⇒ slot se uvolní; z historie ⇒ záznam zmizí). Účel: úklid spamu, GDPR výmaz. | Potvrzovací dialog povinný | Ne — pro komunikované zrušení je Storno |
| **Vytvořit** | Nový záznam přes formulář; status volitelně `pending`/`confirmed` (default `confirmed` — admin termín domlouvá přímo); `meta` prázdné | Kolizní check slotu + business validace, ale **bez** veřejné security pipeline (žádný CSRF/captcha/honeypot/rate-limit — routa je za admin session) a **bez** `maxDaysAhead` a `enabled` omezení (admin může plánovat dál a i při vypnutých veřejných rezervacích) | Ano, pokud `notifyEnabled` — potvrzení termínu |

Každá mutace se loguje přes `ctx.log.info` (akce, id rezervace, výsledek). Identita admina není v route kontextu této verze emdash dostupná — audit trail s identitou je mimo rozsah (§8).

## 6. Notifikace

Rozšíření `server/notifications.ts` (šev z SPEC §7 zůstává: fire-and-forget, `ctx.email` + `notifyEnabled` guard, no-op fallback s logem, chyba nikdy neshodí operaci):

| Funkce | Trigger | Příjemce | Šablona |
| --- | --- | --- | --- |
| `notifyCancellation(ctx, r)` | Akce **Storno** | zákazník (`r.email`) | `renderCancellationEmail(r)` — termín, informace o zrušení |
| `notifyStatusChange(ctx, r)` | Akce Potvrdit | zákazník | `renderConfirmationEmail(r)` |
| `notifyNewReservation(ctx, r)` | Veřejná rezervace i ruční vytvoření | správce (`notifyEmail`), při ručním vytvoření zákazník | stávající + `renderConfirmationEmail` |

Šablony jsou čisté funkce `(r: Reservation) => { subject, text }` — testovatelné bez ctx.

## 7. Data a DTOs

Storage schéma se **nemění** — stávající kolekce a indexy stačí (`status`, `date`, `email`, `createdAt` na obou kolekcích). Nové jsou jen DTO a mappery:

- `AdminReservationDetailDto` — všechna pole včetně PII a meta (jen pro `admin` routu).
- `AdminUpsertReservationDto` (Zod) — vstup create/edit: `{ date, startTime, name, email, phone?, note?, status? }`; sdílí sanitizaci a business validaci s veřejnou cestou (`validation.ts`), liší se jen vypnutými admin výjimkami (§5 Vytvořit).
- `AdminListFilterDto` — `{ status?, dateFrom?, dateTo?, email?, showCancelled?, cursor? }`.
- Mappery: `toAdminDetailDto(r)`, `fromAdminUpsert(dto, existing?)` — druhý parametr pro edit (zachování `createdAt`, `meta`).

## 8. Mimo rozsah

- Audit trail s identitou admina (route kontext identitu nenese) a historie změn rezervace.
- Hromadné akce (multi-select storno/mazání), CSV export.
- Zpětné kurzorové stránkování (storage API neumí).
- Samoobslužné storno zákazníkem (vyžaduje e-mail s tokenem ⇒ až po e-mail transport pluginu; naváže na `notifyCancellation` šablony).
- Přizpůsobení textů notifikací v adminu (šablony jsou v kódu).

## 9. Otevřená rozhodnutí

| # | Otázka | Default v této specifikaci |
| --- | --- | --- |
| 1 | Má ruční vytvoření respektovat otevírací dobu a aktivní dny? | **Ano** (drží konzistenci kalendáře); obejít lze změnou nastavení |
| 2 | Storno s důvodem (text od admina v notifikaci)? | **Ne v v1** — Block Kit confirm dialog nemá vstupní pole; vyžadovalo by mezikrok s formulářem |
| 3 | Notifikovat zákazníka při přesunu slotu (Upravit)? | **Ne v v1** — admin změnu domlouvá se zákazníkem přímo; šablona `renderRescheduleEmail` se může doplnit později |
| 4 | Default status ručně vytvořené rezervace | `confirmed` |
