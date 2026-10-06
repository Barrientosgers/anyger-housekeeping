# Case study: replacing a paper calendar for a small family business

A bilingual (Spanish/English) scheduling app, built for the owners of a small house-cleaning business who kept their appointments on a paper calendar. It is live, has been handed to the owners, runs on free hosting, and was built to production standards: tested, secured, deployed, and documented.

## The problem

The owners are older, more comfortable in Spanish, and not technical. The paper calendar worked, but it could not be shared between two people, could not repeat a weekly cleaning, and gave clients no way to ask for a booking without a phone call. The goal was to **replace or supplement the paper calendar without making them depend on complicated technology**.

## Constraints that shaped every decision

| Constraint                        | What it forced                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users who are not tech-savvy      | Large text, high contrast, plain words next to every action, few choices per screen, no hidden gestures, no "dashboard". The calendar is the home screen.   |
| **Never pay for anything**        | Free-tier hosting only, and every paid-looking dependency checked against its provider's own pricing page. This changed the design of two features (below). |
| Personal data about clients       | Collect only name, phone, address, and notes; keep it out of logs and third parties wherever possible; delete short-lived data automatically.               |
| One developer, a handful of users | A single app and a single database. No microservices, no Kubernetes.                                                                                        |

## What was built

Appointments and a month, week, and day calendar; recurring cleanings (weekly, every two weeks, monthly) with "only this one" or "this and the following" edits; a one-tap Spanish/English toggle; a public booking-request form that the owners accept or decline; optional text-message alerts to the owner; and optional machine translation of clients' notes. Details are in the [README](../README.md).

## Decisions worth explaining

**A modular monolith on Postgres, not microservices or SQLite.** At this scale a split would add failure modes and cost for no benefit. Postgres rather than SQLite because free hosts often have ephemeral disks, `timestamptz` and range operators fit the problem, and tests run on the same database engine as production. The seams for later splitting are real: SMS and translation sit behind interfaces. ([architecture](architecture.md))

**Time is the hard part of a calendar.** Instants are stored in UTC and shown in Pacific Time; the server decides which local day an appointment is on, so the browser never converts time zones. A time that does not exist (2:30 AM on the spring-forward day) is rejected when a person types it, but a _generated_ repeat that lands there moves to the next valid time instead of failing. Tests pin both daylight-saving transitions.

**Recurrence stores a rule, not rows.** A series is one row (a local start time, a frequency, an optional end date); visits are generated for the days on screen, and only edited or cancelled visits are stored as exceptions. "Monthly" means the same weekday of the month ("the 2nd Tuesday"), and a series that starts on the 29th-31st means "the last Tuesday", so no month is skipped. I deliberately offered **two** edit choices instead of three, to keep the interface simple for the owners.

**The "free" constraint changed two features.**

- _Text messages:_ carrier email-to-text gateways have been reported shut down or winding down, Twilio's free trial expires, and Textbelt allows one free text a day. The only durable free sender is a phone the owners already pay for, so alerts go through an Android phone via httpSMS, behind a swappable `SmsProvider` interface. Messages are deliberately generic ("you have a new request, open the app") so no client details pass through a third party.
- _Translation:_ the original plan was the Claude API, but Anthropic's pricing page offers only a small one-time credit, not a free tier. The live translator is Cloudflare Workers AI, which has a daily free allowance and **fails instead of billing**, and states it does not train on or store content. A Claude adapter (official SDK, tested against a stand-in) is built but off by default. The original note is always shown first, and a translation failure never hides it.

Both features are implemented and tested but are **not switched on in production**, so I do not claim them as live.

## Security

Security was designed in, then audited before publication ([full review](security-review.md), [controls and OWASP mapping](../SECURITY.md)).

- **Controls:** argon2id passwords, server-side sessions (new id on login, destroyed on logout), a CSRF header requirement, validation with Zod on every input, parameterized SQL only, output rendered as text, a strict same-origin content security policy, rate limits on login and the public form, a hidden trap field and a cap on pending requests, and automatic deletion of short-lived personal data.
- **The review found real problems.** The most instructive: the booking form's "5 per hour per visitor" limit did not work in production. Behind the host's CDN the app saw a rotating proxy address instead of the visitor, so I measured it from outside (forged-header requests were all let through), keyed the limits on the CDN's trusted header behind an explicit setting, added tests that fail on the old code, and corrected the claim in the docs. Five smaller issues were fixed the same way.
- **Secrets:** environment variables only. The full git history was scanned with two independent tools (no real secrets found), and a CI job now scans the full history on every push.

## How it is verified

| Measure                                      | Result (measured 2026-10-05)                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Automated tests                              | 279 (213 server, 66 web)                                                              |
| Line coverage                                | 94.4% server, 91.1% web                                                               |
| Continuous integration                       | lint, typecheck, tests, build, dependency audit, and a secret scan, in about a minute |
| Known dependency vulnerabilities             | 0                                                                                     |
| Accessibility (Lighthouse, live public page) | 100                                                                                   |
| Performance (Lighthouse, mobile)             | 96-99                                                                                 |
| Hosting cost                                 | $0                                                                                    |

Full method and dates are in [metrics.md](metrics.md). Usage figures will be added after the first weeks of real use; the app currently has a recorded baseline from development, so only the difference will be quoted as real activity.

## What went wrong, and what I learned

- **A lockfile quietly dropped a platform's native files.** Adding a dependency made npm rewrite `package-lock.json` without esbuild's per-platform binaries. Tests, builds, and the live site were unaffected, so nothing flagged it; it surfaced only when a local script was run on a fresh install. I fixed the lockfile and added a CI step that runs a TypeScript script and checks the lockfile, so it cannot recur unnoticed.
- **"Free" claims need primary sources.** Blog posts and search results disagreed about free tiers; reading each provider's own pricing and data-use pages changed two design decisions.
- **Verify security controls in the real environment.** The rate-limit flaw was invisible in tests and obvious from a few `curl` requests against the deployed site.

## Limitations and what I would do next

- The owners originally shared one login. A second login now exists, and fully separate logins would let the app avoid texting someone about their own edits (not yet implemented).
- Rate limits are in memory, which is fine for a single instance.
- No CAPTCHA; the next step if real spam appears (Cloudflare Turnstile is free).
- Machine translation by a free model is less accurate than a large model on informal text, which is why the UI labels it "automatic" and keeps the original beside it.
- Free hosting sleeps when idle: one measured cold start was 22 seconds. A free keep-awake monitor or a custom domain on better hosting would address it.

## How it was built

This project was built with **Claude Code** (Anthropic's AI coding assistant) as a pair programmer, and its commits are co-authored accordingly. The product decisions, the zero-cost constraint, the privacy choices, the deployment, and testing with the real users were mine, and every claim in this repository was checked against measured results rather than assumed.
