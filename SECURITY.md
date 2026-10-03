# Security

This document describes how security is designed into AnyGer's Housekeeping, what personal data it holds, and where the known gaps are. It is written to be accurate, not impressive: items that are not done are listed as gaps.

## What we protect

The app stores clients' **names, phone numbers, street addresses, and cleaning notes** (personal data), plus a login for the business owners. Nothing else sensitive: no payment data, no government IDs.

### Data minimization

- Only the fields needed to do the job are stored: name, address, optional phone, optional notes. No email, birthdate, payment, or tracking data for clients.
- The **audit log** records who did what and to which record id. It never contains names, addresses, or notes.
- **Usage counters** are `event + day + count`. They contain no identifiers, so they can be reported publicly.
- **Logs** contain method, path (without query string), status code, and timing. Request bodies and headers are never logged; a redaction list is a second safety net.
- **Error tracking** (Sentry, optional) is configured to drop request bodies, cookies, headers, query strings, and user info before an event is sent.
- Demo and test data is fake (`example.com`, invented names).

### How the data is protected

- In transit: HTTPS (terminated by the host), `Secure` + `HttpOnly` + `SameSite=Lax` session cookies, TLS to the database in production.
- At rest: the managed Postgres provider encrypts storage. This app does not add application-level encryption of these fields; that is a deliberate scale tradeoff (see Gaps).
- Access: every API route except `/healthz` and login requires an authenticated session. Only the business owners have accounts.
- Deletion: a client's data can be removed by deleting or editing the appointment rows (a deletion/anonymize script is planned before the booking form goes public in Phase 3).

## OWASP Top 10 (2021) mapping

| #   | Risk                                     | What this app does                                                                                                                                                                                                                     | Where                                                                |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A01 | Broken Access Control                    | `requireAuth` guards all `/api/appointments*`; ids are random UUIDs; single-business app, so no cross-tenant data. Tests assert 401 when logged out.                                                                                   | `server/src/middleware/security.ts`, `test/integration/auth.test.ts` |
| A02 | Cryptographic Failures                   | Passwords hashed with argon2id (`@node-rs/argon2`); session secret from env, validated to 32+ chars; HTTPS only in production; secure cookies.                                                                                         | `routes/auth.ts`, `config.ts`                                        |
| A03 | Injection                                | All SQL is parameterized (`pg` placeholders), never string-built. Zod validates every body/query. React escapes output; tests confirm markup in notes renders as text.                                                                 | `services/appointments.ts`, `web/src/__tests__/pages.test.tsx`       |
| A04 | Insecure Design                          | Threat model below; data minimization; overlap is a warning, not a trust boundary; public form (Phase 3) is the only unauthenticated write and will be rate limited.                                                                   | this file                                                            |
| A05 | Security Misconfiguration                | `helmet` headers incl. CSP; `x-powered-by` off; env validated at startup (fails closed); non-root container; no secrets in repo (`.env` ignored).                                                                                      | `app.ts`, `Dockerfile`                                               |
| A06 | Vulnerable Components                    | Lockfile committed; `npm audit` fails CI on high severity; Dependabot weekly.                                                                                                                                                          | `.github/workflows/ci.yml`, `dependabot.yml`                         |
| A07 | Identification & Authentication Failures | Login rate limit (10 / 15 min / IP); identical error for wrong password vs unknown email, with a dummy hash verification so timing does not reveal accounts; session id regenerated on login; logout destroys the server-side session. | `routes/auth.ts`                                                     |
| A08 | Software & Data Integrity                | CI on every push; lockfile-pinned installs (`npm ci`); no runtime code download.                                                                                                                                                       | CI                                                                   |
| A09 | Logging & Monitoring Failures            | Structured JSON logs with request ids; audit log of logins and changes; optional error tracking; no PII in any of them.                                                                                                                | `logger.ts`, `services/usage.ts`                                     |
| A10 | SSRF                                     | No user-controlled outbound requests today. Phase 5 translation calls a fixed Anthropic host only.                                                                                                                                     | n/a yet                                                              |

### CSRF

State-changing requests must include `X-Requested-With: anyger`. Browsers cannot add that header to a cross-site request without a CORS preflight, and the server does not enable CORS. This is layered with `SameSite=Lax` cookies. Tested in `auth.test.ts`.

## Threat model (short)

| Threat                               | Mitigation                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Stranger guesses the login           | Strong password required at account creation (12+ chars), rate limit, argon2id                                |
| Stranger reads or edits appointments | Auth on all data routes; UUID ids                                                                             |
| Malicious client note (XSS)          | Output encoding by React; CSP; stored as plain text                                                           |
| Stolen phone with open session       | 90-day rolling session; logout button; server-side sessions can be revoked by deleting rows in `sessions`     |
| Leaked secret in git                 | `.env` ignored; `.env.example` has placeholders only; full-history scan before the repo goes public (Phase 6) |
| Personal data in logs/errors         | Never logged; Sentry scrubbed; verified by smoke test (0 matches for client name/address in logs)             |
| Spam on the public form (Phase 3)    | Rate limit + honeypot, CAPTCHA if needed                                                                      |

## Known gaps (honest list)

- **Shared login, no MFA.** Both parents use one account for simplicity (they are not tech-savvy). Trade-off accepted; revisit if more staff are added.
- **Rate limit is per IP and in memory.** Fine for one instance; would need a shared store if scaled out.
- **No application-level field encryption.** Relies on provider encryption at rest.
- **Free-tier hosting** has no uptime or backup guarantees. Back up with `pg_dump` periodically (see `docs/deploy.md`).
- **No external penetration test.** Only automated tests, dependency audit, and my own review.
- CSP uses helmet's default style policy (inline styles allowed); tightening is a possible follow-up.

## Reporting

This is a private small-business app. If you find a problem, contact the repository owner directly rather than opening a public issue.
