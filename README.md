# AnyGer's Housekeeping

A calm, Spanish-first scheduling app that replaces a paper calendar for a small family house-cleaning business. Built for my parents, who are not tech-savvy, and engineered like production software: tested, secured, deployed, and documented.

**Live:** https://anyger-housekeeping.onrender.com (free hosting; the first load after idle can take 30-60 seconds)
**Status:** Phase 1 of 6 deployed (appointments + calendar + auth + CI). See the roadmap below.

## Who it's for

- **My parents** (primary users): older, more comfortable in Spanish. Big text, big buttons, plain words, few choices per screen, no hidden gestures.
- **Their clients** (Phase 3): a public booking-request form.
- **Me**: admin and developer.

There is deliberately **no "today's work" dashboard**. The calendar is the home screen, and every screen is useful on its own.

## Screenshots

Mobile view with fake demo data.

| Login                                  | Month                                           | Day                                     |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| ![Login](docs/screenshots/1-login.png) | ![Month calendar](docs/screenshots/2-month.png) | ![Day list](docs/screenshots/3-day.png) |

| Appointment                                          | New appointment                      |
| ---------------------------------------------------- | ------------------------------------ |
| ![Appointment detail](docs/screenshots/4-detail.png) | ![Form](docs/screenshots/5-form.png) |

## What works today (Phase 1)

- Create, edit, and cancel an appointment (client, address, phone, date, time, duration, notes). Cancelling asks "are you sure?" first.
- Calendar home screen with **month**, **week** and **day** views. Tapping a day in the month opens that day with its list of clients (feedback from the first real users).
- Overlapping appointments save, with a plain warning (a crew may work in parallel).
- Spanish UI (English strings are already in place; the one-tap toggle arrives in Phase 2).
- Login required for everything. Sessions last 90 days so the parents rarely sign in.
- Times are stored in UTC and shown in Pacific Time, with daylight-saving cases tested.

## Roadmap

| Phase | Scope                                                                  | Status                             |
| ----- | ---------------------------------------------------------------------- | ---------------------------------- |
| 1     | Git/GitHub, appointments, calendar, auth, tests, CI, deploy            | deployed; awaiting parent feedback |
| 2     | Recurring cleanings (weekly / every 2 weeks / monthly), English toggle | planned                            |
| 3     | Public booking requests, accept/decline, spam protection               | planned                            |
| 4     | SMS to my father behind a swappable `SmsProvider`                      | planned                            |
| 5     | Claude API translation, original always kept, graceful fallback        | planned                            |
| 6     | Public-repo hardening: history scan, metrics write-up                  | planned                            |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, react-router, i18next (hand-written CSS, no UI framework)
- **Backend:** Node 24, Express, TypeScript, Zod, pino, helmet
- **Database:** PostgreSQL 16 (plain SQL migrations)
- **Auth:** argon2id passwords, server-side sessions in Postgres
- **Tests:** Vitest, Testing Library, Supertest against a real Postgres
- **CI:** GitHub Actions (lint, typecheck, tests with coverage, build, `npm audit`)
- **Hosting (free tier only):** Render + Neon, via Docker

Why one app and one database instead of microservices: see [docs/architecture.md](docs/architecture.md).

## Run it locally

Requirements: Node 22+, Docker (for Postgres).

```bash
git clone https://github.com/Barrientosgers/anyger-housekeeping.git
cd anyger-housekeeping
npm install
cp .env.example .env            # then set SESSION_SECRET: openssl rand -hex 32
                                # and DATABASE_URL=postgres://anyger:anyger_local_only@127.0.0.1:5433/anyger
npm run db:up                   # starts Postgres in Docker on port 5433
npm run migrate -w server       # creates tables
npm run user:create -w server -- you@example.com admin   # asks for a password (hidden)
npm run dev:server              # API on http://localhost:3000
npm run dev:web                 # app on http://localhost:5173 (proxies /api)
```

Run the checks:

```bash
npm run lint
npm test            # server + web (needs `npm run db:up`)
npm run coverage    # with coverage report
```

## Quality, with real numbers (Phase 1)

|                                 | Tests | Line coverage | Branch coverage |
| ------------------------------- | ----- | ------------- | --------------- |
| Server (unit + API integration) | 34    | 88.1%         | 69.6%           |
| Web (unit + component)          | 19    | 80.8%         | 76.7%           |

CI passes on GitHub Actions. Coverage will be re-measured each phase; these numbers are not targets, only what was measured.

## Security and privacy

See [SECURITY.md](SECURITY.md) for the OWASP Top 10 mapping, threat model, what personal data is stored and how it is protected, and a list of known gaps.

## Documentation

- [docs/architecture.md](docs/architecture.md): diagram, data model, decisions and tradeoffs
- [docs/deploy.md](docs/deploy.md): free deployment on Render + Neon
- [SECURITY.md](SECURITY.md)
- [CLAUDE.md](CLAUDE.md): project rules and goals for AI-assisted sessions
