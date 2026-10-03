# AnyGer's Housekeeping — project guide

Bilingual (Spanish default / English) scheduling app for my parents' house-cleaning business, replacing a paper calendar. Real product for real users AND a portfolio project (SWE / Forward Deployed / security-leaning roles). Build it like production software: tested, secure, deployed, documented, measurable. AI is one feature, not the center.

## Users
- Parents (primary): older, Spanish-first, not tech-savvy. Treat as real customers; feedback gathered after each phase.
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

## Workflow
- `main` branch, small clear commits, one feature branch per phase (`phase-N-...`) that Gerson merges after testing.
- Build one phase at a time; stop at the end of each phase.
- End of phase: summary + decisions, 2-3 honest résumé bullets (real numbers only), 2 interview questions with key points.
- Repo is PRIVATE until a full-history secret/PII scan is done.

## Phases
1. Git/GitHub, appointments + calendar (Spanish), auth, tests, CI, deploy
2. Recurrence + English toggle
3. Public booking requests
4. SMS
5. AI translation
6. Public-repo hardening, metrics write-up
