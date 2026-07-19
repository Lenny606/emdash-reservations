# @emdash-reservations/plugin-reservations

A native-format EmDash plugin that adds a weekly reservation calendar (7 days × 30-minute
slots) to the site, with a React admin app (list, detail, edit, manual creation, settings) to
configure it and manage bookings.

See [SPEC.md](./SPEC.md) for the original design and [PLAN.md](./PLAN.md) for the phase 1-7
implementation log. The admin was later rewritten from Block Kit to native React —
[NATIVE_SPEC.md](./NATIVE_SPEC.md) and [NATIVE_PLAN.md](./NATIVE_PLAN.md) are the current
source of truth for the admin; [ADMIN_SPEC.md](./ADMIN_SPEC.md)/[ADMIN_PLAN.md](./ADMIN_PLAN.md)
are superseded (kept as historical record). [NPM_PLAN.md](./NPM_PLAN.md) covers turning this
into a standalone published package.

## Install (this workspace)

Already wired up:

- `pnpm-workspace.yaml` includes `packages/*`.
- `astro.config.mjs` registers it: `plugins: [reservationsPlugin()]`.
- `src/pages/reservations.astro` renders the `<ReservationCalendar />` component.

## Admin UI

Visit `/_emdash/admin/plugins/reservations/reservations` (or the "Reservations" item under
"Plugins" in the admin sidebar). Three views:

- **Reservations** — filterable list (status, date range, email, a "show cancelled" toggle
  that switches to the history collection), with stat cards (this week / pending / confirmed /
  cancelled) above it. Click a row for the full detail: contact info, meta (IP hash, user
  agent — empty for manually-created reservations), and status-dependent actions (Confirm,
  Edit, Cancel, Delete — see ADMIN_SPEC.md §4 for the exact matrix).
- **New reservation** — manually create a booking. Bypasses the public security pipeline
  (CSRF/captcha/honeypot/rate-limit) and the `maxDaysAhead`/`enabled` gates — opening hours and
  active days still apply. Sends the customer (not the admin) a confirmation email if **Email
  notifications** is on.
- **Settings** — the form below, including a live color picker (native `<input type="color">`
  synced with a hex text field) for the four calendar colors.

| Setting | Default | Notes |
| --- | --- | --- |
| Enabled | on | Turns the whole feature off: availability shows every slot as closed, `reserve` returns `disabled`. |
| Opening / closing time | 08:00 / 18:00 | 30-minute grid. |
| Active days | 1,2,3,4,5 | 1=Monday .. 7=Sunday, comma-separated. |
| Max days ahead | 28 | How far into the future a visitor can book. |
| Auto-confirm | off | Off: new reservations are `pending` and need admin confirmation. On: they're `confirmed` immediately. |
| Colors | green/red/amber/gray | Slot colors, read by the client from the availability response. |
| Captcha plugin ID | *(empty)* | See "Captcha integration" below. Empty = no captcha check. |
| Email notifications | off | See "Email notifications" below. |

## Routes

Base: `/_emdash/api/plugins/reservations/<route>`

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `public/availability` | GET | public | Slot statuses for a week (`?weekStart=YYYY-MM-DD`, must be a Monday). No PII. |
| `public/csrf` | GET | public | Issues a short-lived signed CSRF token. |
| `public/reserve` | POST | public | Creates a reservation (full security pipeline below). |
| `admin/settings-get`, `admin/settings-save` | POST | admin session | Read/write plugin settings. |
| `admin/overview` | POST | admin session | Stat card counts. |
| `admin/reservations-list` | POST | admin session | Filtered, cursor-paginated list (active or history). |
| `admin/reservation-detail`, `-confirm`, `-cancel`, `-delete`, `-create`, `-update` | POST | admin session | Per-reservation actions. All return a normal `200` with `{ ok, ... }` even on business-logic failure (not found, slot taken) -- see NATIVE_SPEC.md N0-11 for why these never throw. |

## Security model

- **CSRF**: stateless HMAC-signed token (`state:csrfSecret`, generated lazily on first use),
  15-minute expiry. Protects against cross-site form submission; it is not a bot defense.
- **Honeypot**: hidden `website` field. If filled in, the request is silently accepted
  (fake success) without writing anything, so a bot gets no signal that it was caught.
- **Rate limiting**: per-IP-hash KV counters (5/minute, 20/hour). IP is hashed
  (`SHA-256(ip:secret)`), never stored raw.
- **Captcha**: delegated to a *separate* plugin (see below) — this plugin only carries the
  integration contract, no captcha implementation of its own.
- **Race safety**: the active `reservations` collection uses `slotKey` as the document id, so
  two reservations for the same slot can't coexist. A create does `exists` → `put` → re-read
  and compares a per-request nonce; a losing concurrent write is detected and reported as
  `slot_taken`.

## Captcha plugin integration contract

This plugin ships the visitor- and server-side half of a captcha integration but no captcha
provider. To wire one up, install/build a separate plugin that:

1. Exposes `POST /_emdash/api/plugins/<id>/verify` taking `{ token, remoteIpHash? }` and
   returning `{ ok: boolean, code?: string }`.
2. Renders its widget into the `<div data-rsv-captcha>` slot in the reservation form and
   writes the solved token into the hidden `input[name="captchaToken"]`.
3. Configures itself independently (provider, site key, secret) — this plugin never sees
   those.

Then set **Captcha plugin ID** in this plugin's settings to that plugin's id. Until you do,
the captcha step is skipped entirely (honeypot + rate limiting are the only bot defenses).

## Email notifications

No email transport ships with this plugin. `server/notifications.ts` calls `ctx.email.send()`
(fire-and-forget, never fails the reservation) when **Email notifications** is on, a
**Notification email** is set, and a transport plugin (e.g. a Resend integration providing
`email:deliver`) is installed. Until then, it logs a skip message instead.

## Known limitations (v1, see SPEC.md §9)

- Single time zone (the site's local time) -- no per-visitor conversion.
- No multi-slot / multi-resource bookings, no recurring reservations.
- No self-service cancellation by visitors (would need email + token, i.e. after an email
  transport exists).
- List pagination is forward-only cursor-based ("Next" button, no page numbers or going back
  to a specific page) -- the underlying storage API doesn't support backward pagination.
- No cancellation reason field, no audit trail of which admin made a change (route context
  doesn't carry admin identity in this emdash version).
