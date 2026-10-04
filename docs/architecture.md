# Architecture

AnyGer's Housekeeping is **one Node app and one Postgres database**. The Express server exposes a JSON API and also serves the built React app, so there is a single deploy, a single URL, and a single thing to monitor.

## System diagram

```mermaid
flowchart LR
  P["Parents' phone<br/>(React app, Spanish)"] -->|HTTPS| S
  C["Clients (Phase 3)<br/>public booking form"] -->|HTTPS, rate limited| S
  subgraph Render["Render free web service (Docker)"]
    S["Express API + static React build<br/>helmet, sessions, zod, pino"]
  end
  S -->|TLS| DB[("Neon free Postgres")]
  S -. "Phase 4" .-> SMS["SmsProvider interface<br/>Twilio / fake"]
  S -. "Phase 5" .-> TR["Translator interface<br/>Claude API / fake"]
  S -.-> SE["Sentry (optional)"]
```

Dotted lines are later phases or optional.

## Why this size is right (no microservices, no Kubernetes)

The load is two users and a few requests an hour. Splitting into services would add network failure modes, deploy pipelines, and cost, and would buy nothing at this scale. A modular monolith with clear internal seams (`domain/`, `services/`, `routes/`, and adapter interfaces for SMS and translation) is cheap to run and easy to change. If it ever outgrew this, those seams are where it would be split.

## Postgres vs SQLite

SQLite would perform fine at this data size (hundreds of rows a year). Postgres was chosen because:

- Free hosts often have **ephemeral disks**; a SQLite file there can vanish with a redeploy. A managed Postgres survives redeploys and has provider backups.
- `timestamptz` and range operators (used for overlap detection) are first-class.
- Tests run against **real Postgres** in CI, the same engine as production.

Cost of the choice: one more moving part locally (Docker Compose) and a network hop. Accepted.

## Data model

```mermaid
erDiagram
  users ||--o{ appointments : created_by
  series ||--o{ appointments : exceptions
  users ||--o{ audit_log : user_id
  users {
    uuid id PK
    text email UK
    text password_hash
    text role
    text locale
  }
  appointments {
    uuid id PK
    text client_name
    text client_phone
    text address
    timestamptz starts_at
    int duration_min
    text notes
    text status
    uuid created_by FK
    uuid series_id FK
    date original_date
  }
  series {
    uuid id PK
    text client_name
    text address
    date start_date
    text local_time
    int duration_min
    text freq
    date until_date
    text status
  }
  audit_log {
    bigint id PK
    timestamptz at
    uuid user_id FK
    text action
    text entity
    uuid entity_id
  }
  usage_counters {
    text event PK
    date day PK
    int count
  }
  sessions {
    varchar sid PK
    json sess
    timestamp expire
  }
```

Phase 2 added `series` and two columns on `appointments` (`series_id`, `original_date`; see Recurrence below). Planned: `booking_requests` (Phase 3), `translations` (Phase 5).

## Key decisions and tradeoffs

### Time zones

- **Stored as UTC** `timestamptz`. **Displayed in America/Los_Angeles.**
- Conversion lives in one module, `server/src/domain/time.ts`, using Luxon. The **server** returns each appointment's Pacific `date` and `time`; the browser never converts time zones for appointments, so there is one place to get DST right.
- Spring forward: a time that does not exist (02:30 on 2026-03-08) is **rejected** with a plain-language error instead of silently shifting.
- Fall back: an ambiguous time (01:30 on 2026-11-01) resolves to the **first** occurrence (daylight time). Documented and tested.
- Range queries ask for whole Pacific days, so days are 23, 24, or 25 hours long around DST and tests assert this.
- Tradeoff: the calendar is fixed to Pacific Time. Right for this business; a per-business time zone setting would be needed to generalize.

### Recurrence (built in Phase 2)

- A **series** stores the rule: a Pacific start date, a wall-clock time (`"09:00"`), a frequency (`weekly`, `biweekly`, `monthly`), and an optional inclusive end date. Visits are **generated for the days on screen** (`domain/recurrence.ts`), not stored, so a series is one row however long it runs.
- **Monthly means the same weekday of the month** (e.g. the 2nd Tuesday). A series that starts on the 29th-31st means "the last <weekday>", so no month is ever skipped. The API returns the ordinal so the label ("2nd" vs "last") is always right.
- Only **exceptions** are stored: an edited or cancelled single visit is a row in `appointments` with `(series_id, original_date)`, unique per visit. When listing, a generated visit is dropped if an exception exists for its date, so a moved visit shows once, at its new time.
- Two edit scopes, deliberately, to keep choices few for non-technical users: **only this one** (writes or updates an exception) and **this and the following**. The latter ends the old series the day before and starts a new one (or edits the series in place when started from the first visit); one-off edits after that point are replaced. "Edit the whole series" is "this and the following" from the first visit, and past visits are never rewritten.
- **Daylight saving:** generation uses the stored wall-clock time, so 9:00 AM stays 9:00 AM while its UTC value shifts. A generated visit whose time does not exist that day (e.g. 02:30 on spring-forward) moves to the next valid time instead of failing; a time typed in by a person is still rejected. Tested at both transitions.
- Tradeoffs: listing does a little more work than reading rows (fine at this scale), and "this and the following" discards later one-off edits (the same behaviour as common calendar apps, and called out in the UI by the question itself).

### Language

Spanish is the default. The one-tap toggle stores the choice **per device** in `localStorage` (guarded, since storage can be blocked), because both parents share one login and may prefer different languages. The server stays language-neutral: it returns error codes and the UI translates them. A test enforces that the Spanish and English files have identical keys.

### SMS abstraction (Phase 4)

`SmsProvider { send(to, body) }` with Twilio and in-memory fake adapters, selected by `SMS_PROVIDER`. Business logic only knows the interface, so tests never hit the network and the provider can be swapped. Failures are logged and counted, never block saving an appointment.

### Translation fallback (Phase 5)

`Translator` interface with a Claude adapter. The original text is **always stored next to** the translation. On timeout or API error, the app saves the original and shows "not translated yet"; nothing in the core flow depends on the API being up.

### Authentication

- Email + password, argon2id, server-side sessions in Postgres (revocable), 90-day rolling cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) so older users are not constantly logged out.
- One shared account for the parents; the schema supports more users and roles.
- CSRF: custom-header requirement + `SameSite`. See `SECURITY.md`.
- Tradeoff: sessions in Postgres cost one query per request; irrelevant at this scale and avoids JWT revocation problems.

### Overlapping appointments

A **warning, not a block**: the parents may have a crew. The API returns `overlaps: n` and the UI says so in plain Spanish.

### Free-tier hosting

Render free web service (sleeps after ~15 minutes idle, so the first open can take 30-60 s) + Neon free Postgres. A free uptime pinger on `/healthz` can keep it warm during the day. The database is plain Postgres, so leaving a provider is a `pg_dump` and restore. Risk: free-tier terms can change.

### Observability

- `pino` JSON logs (no PII), request ids, `/healthz` for the host.
- Optional Sentry with request data stripped.
- `usage_counters` hold anonymous daily counts (`appointments_created`, `appointments_cancelled`; later requests received, SMS sent, translations). Read them with SQL; they are the only source for any number quoted in a résumé.

## Folder structure

```
server/src/
  domain/        pure logic (time, later recurrence)
  routes/        HTTP handlers (thin)
  services/      DB access and business rules
  middleware/    auth + CSRF
  db/            pool, migration runner, SQL migrations
  scripts/       create-user CLI
web/src/
  pages/         Calendar, form, detail, cancel, login
  i18n/          es.json (default), en.json
  dates.ts       calendar math on plain date strings
```
