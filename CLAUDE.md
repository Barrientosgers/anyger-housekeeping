# AnyGer's Housekeeping — project guide

Bilingual (Spanish default / English) scheduling app for a small family house-cleaning business, replacing a paper calendar. Real product for real users AND a portfolio project (SWE / Forward Deployed / security-leaning roles). Build it like production software: tested, secure, deployed, documented, measurable. AI is one feature, not the center.

## Users

- Owners (primary users): older, Spanish-first, not tech-savvy. Treat as real customers; feedback gathered after each phase.
- Clients: public booking form (Phase 3).
- Gerson: admin and developer.

## Design rules

- Senior-friendly: large text/buttons, high contrast, few choices per screen, words not icons alone, no hidden gestures, mobile-first.
- NO "today's work" dashboard. Calendar (month/week) is the home screen.
- Calm, pleasant, not corporate. Useful even if only partly used.

## Engineering rules

- Stack: React (Vite, TS) + Node/Express (TS) + Postgres. One app, one DB, one deploy. No microservices/Kubernetes.
- Times stored UTC (`timestamptz`), displayed in America/Los_Angeles. Recurrence stores local wall-clock rule; tests must cover DST.
- SMS and translation sit behind interfaces (`SmsProvider`, `Translator`) with fake adapters for tests.
- Translation: always keep original next to translation; app must work if the API is down.
- Security by design: auth on everything except the public form; Zod validation, output encoding, rate limiting + spam protection, secrets only in env vars, never log PII or keys. Map to OWASP Top 10 in SECURITY.md.
- Minimize personal data (names, phones, addresses). Audit log and usage counters contain no PII.
- Observability: structured logs (pino), Sentry, privacy-respecting usage counts. Never invent metrics; résumé numbers must be real (mark estimates "~").
- Tests: unit (scheduling/recurrence) + integration (API). Report coverage. CI = lint + tests on every push.

## Cost rule

- FREE TIER ONLY, forever. Never add a paid service or anything needing a credit card. Hosting: Render free web service + Neon free Postgres. Local dev/test: Docker Postgres (docker-compose.yml, port 5433).

## Workflow

- `main` branch, small clear commits, one feature branch per phase (`phase-N-...`) that Gerson merges after testing.
- Build one phase at a time; stop at the end of each phase.
- End of phase: summary + decisions, 2-3 honest résumé bullets (real numbers only), 2 interview questions with key points.
- The repo is PUBLIC (since 2026-10-06) after a full-history secret/PII scan. Never commit secrets or real client data; secret scanning and push protection are on.

## Phases

1. Git/GitHub, appointments + calendar (Spanish), auth, tests, CI, deploy (done, live)
2. Recurrence + English toggle (done, live)
3. Public booking requests (done, live)
4. SMS via httpSMS (an Android phone sends; texts are generic, no PII) (merged; off until set up)
5. Translation of notes: Cloudflare Workers AI (free) is the real provider; the Claude adapter is built but OFF because the Claude API is not free (built; needs a free Cloudflare token)
6. Public-repo hardening, metrics write-up (built; repo stays PRIVATE until the owner decides)

## Status (as of 2026-10-06) and how to resume

- **All 6 phases are built, tested, merged, and live.** `main` is the only branch. The repo is PUBLIC with an MIT license; `main` is protected (required checks `test` and `secret-scan`; no force-push or deletion). Hosting is free-tier (Render + Neon).
- **Off until the owner sets them up (optional):** texts to the owner (`docs/sms-setup.md`) and note translation (`docs/translation-setup.md`).
- **Waiting on real use:** the owners are starting to use the app. After 2-4 weeks, run `npm run usage -w server` (steps in `docs/metrics.md`), subtract the **baseline recorded there (2026-10-06)**, and turn the difference into final résumé bullets. Never present development or testing counts as customer activity.
- **Decisions already made:** keep the author email in history as is; describe the project as "a small family business app" (no family details in docs); the repo was published as is (author email, older wording, and the live address remain in old commits, accepted). If the address must change later, move the app to a custom domain and retire the old one.
- **How we work:** one step at a time with exact commands; never ask for secrets in chat (use `read -rs` hidden prompts); open a pull request for every change and merge only when asked; report only measured numbers.
- **Common tasks:** add or reset a login = `npm run user:create -w server -- <email> admin` (see `docs/deploy.md`). Security probe = `scripts/security-probe.sh <url>`. If `tsx` commands fail with a missing `@esbuild` file, see the README troubleshooting note.
