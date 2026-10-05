# AnyGer's Housekeeping

A calm, Spanish-first scheduling app that replaces a paper calendar for a small family house-cleaning business. Built for my parents, who are not tech-savvy, and engineered like production software: tested, secured, deployed, and documented.

**Live:** https://anyger-housekeeping.onrender.com (free hosting; the first load after idle can take 30-60 seconds)
**Status:** All 6 phases built; security review complete (see below). Live, in use by the owners. See the roadmap below.

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

Phase 2: repeating, choosing what to change, and English.

| Repeat options                                   | Only this one, or the following                 | English                                          |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| ![Repeat options](docs/screenshots/6-repeat.png) | ![Scope question](docs/screenshots/8-scope.png) | ![English month](docs/screenshots/9-english.png) |

Phase 3: the public form and the owners' review screens.

| Public form (Spanish)                            | New-request banner                        | A request                                          |
| ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------- |
| ![Booking form](docs/screenshots/10-booking.png) | ![Banner](docs/screenshots/11-banner.png) | ![Request](docs/screenshots/13-request-detail.png) |

Phase 5: a note and its automatic translation (shown here with a stand-in translator, since no live Cloudflare account is connected yet), and what the owners see if translation is down.

| Original + translation                                  | Translation unavailable                                       |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| ![Translated note](docs/screenshots/14-translation.png) | ![Translation down](docs/screenshots/15-translation-down.png) |

## What works today (Phases 1-5)

- Create, edit, and cancel an appointment (client, address, phone, date, time, duration, notes). Cancelling asks "are you sure?" first.
- Calendar home screen with **month**, **week** and **day** views. Tapping a day in the month opens that day with its list of clients (feedback from the first real users).
- Overlapping appointments save, with a plain warning (a crew may work in parallel).
- **Recurring cleanings:** every week, every 2 weeks, or every month on the same weekday (e.g. the 2nd Tuesday), with an optional end date. Editing or cancelling asks "only this one" or "this and the following".
- **Spanish and English** with a one-tap toggle. Spanish is the default; each phone remembers its own choice.
- **Booking requests:** clients fill in a public form at `/book` (Spanish or English). Requests wait as "pending" until the owners **Aceptar** (the form opens prefilled so they can adjust the date or time, and it becomes an appointment or repeating series) or **Rechazar**. A banner on the calendar shows how many are waiting. Spam is handled by a hidden trap field, a rate limit, and a cap on pending requests; old requests are deleted automatically.
- **Text messages to the owner** (off until configured): a generic text when a request arrives or an appointment is created, changed, or cancelled. Sent for free by an Android phone you own via httpSMS, behind a swappable `SmsProvider` interface, with a cooldown and a monthly cap. See [docs/sms-setup.md](docs/sms-setup.md).
- **Translation of client notes** (off until configured): a note in the other language is shown with an automatic translation beneath it, and the **original is always kept and shown first**. Free (Cloudflare Workers AI) because the Claude API is not; a Claude adapter is built but off. If translation is down the note simply shows as written. See [docs/translation-setup.md](docs/translation-setup.md).
- Login required for everything except the booking form. Sessions last 90 days so the parents rarely sign in.
- Times are stored in UTC and shown in Pacific Time. Repeating visits keep their wall-clock time across daylight-saving changes (tested).

## Roadmap

| Phase | Scope                                                                  | Status                               |
| ----- | ---------------------------------------------------------------------- | ------------------------------------ |
| 1     | Git/GitHub, appointments, calendar, auth, tests, CI, deploy            | deployed and in use                  |
| 2     | Recurring cleanings (weekly / every 2 weeks / monthly), English toggle | deployed and in use                  |
| 3     | Public booking requests, accept/decline, spam protection               | deployed                             |
| 4     | Text messages to the owner behind a swappable `SmsProvider`            | merged; off until set up             |
| 5     | Translation of client notes, original always kept, graceful fallback   | built; needs a free Cloudflare token |
| 6     | Security review, history scan, metrics write-up, public-repo prep      | built                                |

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

## Quality, with real numbers (measured after Phase 6)

|                                 | Tests | Line coverage | Branch coverage |
| ------------------------------- | ----- | ------------- | --------------- |
| Server (unit + API integration) | 213   | 94.4%         | 87.8%           |
| Web (unit + component)          | 66    | 91.1%         | 92.4%           |

CI passes on GitHub Actions. Coverage will be re-measured each phase; these numbers are not targets, only what was measured.

## Metrics

Measured, not estimated: 279 automated tests (94% / 91% line coverage), CI in about a minute, 0 known vulnerable dependencies, Lighthouse accessibility 100 and performance 96-99 on the live public page, 110 KiB page weight, and $0 hosting. Full table with dates and methods in [docs/metrics.md](docs/metrics.md). Real usage counts come from the app's own anonymous counters.

## Security and privacy

A full pre-publication review (history scans with two tools, code review, live probing, 38 security regression tests, and the six issues it found and fixed) is in [docs/security-review.md](docs/security-review.md). See [SECURITY.md](SECURITY.md) for the OWASP Top 10 mapping, threat model, what personal data is stored and how it is protected, and a list of known gaps.

## Documentation

- [docs/architecture.md](docs/architecture.md): diagram, data model, decisions and tradeoffs
- [docs/deploy.md](docs/deploy.md): free deployment on Render + Neon
- [docs/sms-setup.md](docs/sms-setup.md): turning on free text messages
- [docs/translation-setup.md](docs/translation-setup.md): turning on free translation of notes
- [docs/security-review.md](docs/security-review.md): the Phase 6 security review
- [docs/metrics.md](docs/metrics.md): measured quality, performance, and usage numbers
- [SECURITY.md](SECURITY.md)
- [CLAUDE.md](CLAUDE.md): project rules and goals for AI-assisted sessions
