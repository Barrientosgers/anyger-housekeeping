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
- Deletion: a client's data can be removed by deleting or editing the appointment rows. Booking requests delete themselves automatically (see "Retention").

## OWASP Top 10 (2021) mapping

| #   | Risk                                     | What this app does                                                                                                                                                                                                                     | Where                                                                |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A01 | Broken Access Control                    | `requireAuth` guards all `/api/appointments*`; ids are random UUIDs; single-business app, so no cross-tenant data. Tests assert 401 when logged out.                                                                                   | `server/src/middleware/security.ts`, `test/integration/auth.test.ts` |
| A02 | Cryptographic Failures                   | Passwords hashed with argon2id (`@node-rs/argon2`); session secret from env, validated to 32+ chars; HTTPS only in production; secure cookies.                                                                                         | `routes/auth.ts`, `config.ts`                                        |
| A03 | Injection                                | All SQL is parameterized (`pg` placeholders), never string-built. Zod validates every body/query. React escapes output; tests confirm markup in notes renders as text.                                                                 | `services/appointments.ts`, `web/src/__tests__/pages.test.tsx`       |
| A04 | Insecure Design                          | Threat model below; data minimization; overlap is a warning, not a trust boundary; the public booking form (`POST /api/public/requests`) is the only unauthenticated write and has its own layered defenses (see below).               | this file                                                            |
| A05 | Security Misconfiguration                | `helmet` headers incl. CSP; `x-powered-by` off; env validated at startup (fails closed); non-root container; no secrets in repo (`.env` ignored).                                                                                      | `app.ts`, `Dockerfile`                                               |
| A06 | Vulnerable Components                    | Lockfile committed; `npm audit` fails CI on high severity; Dependabot weekly.                                                                                                                                                          | `.github/workflows/ci.yml`, `dependabot.yml`                         |
| A07 | Identification & Authentication Failures | Login rate limit (10 / 15 min / IP); identical error for wrong password vs unknown email, with a dummy hash verification so timing does not reveal accounts; session id regenerated on login; logout destroys the server-side session. | `routes/auth.ts`                                                     |
| A08 | Software & Data Integrity                | CI on every push; lockfile-pinned installs (`npm ci`); no runtime code download.                                                                                                                                                       | CI                                                                   |
| A09 | Logging & Monitoring Failures            | Structured JSON logs with request ids; audit log of logins and changes; optional error tracking; no PII in any of them.                                                                                                                | `logger.ts`, `services/usage.ts`                                     |
| A10 | SSRF                                     | No user-controlled outbound requests. The server only calls fixed hosts: the text provider's API (api.httpsms.com, or api.twilio.com if that adapter is ever enabled). Phase 5 will call a fixed Anthropic host.                       | `services/sms/`                                                      |

### CSRF

State-changing requests must include `X-Requested-With: anyger`. Browsers cannot add that header to a cross-site request without a CORS preflight, and the server does not enable CORS. This is layered with `SameSite=Lax` cookies. Tested in `auth.test.ts`.

## Security review

A full review before the repository goes public is recorded in [docs/security-review.md](docs/security-review.md): history scans with two tools, a code review against the OWASP list, a black-box probe of the live site, and 38 regression tests. It found and fixed six issues, including rate limits that were not tied to the real visitor behind Render's proxy (F1). Re-run the probe any time with `scripts/security-probe.sh <url>`.

Controls added by the review: strict same-origin-only content security policy, `Cache-Control: no-store` on every API response, proper 413/415 errors for bad bodies, error logs without message text, and a CI job that scans the whole git history for secrets on every push.

## Public booking form

`/book` is the only page that works without a login, and `POST /api/public/requests` is the only unauthenticated write. It is treated as hostile input.

| Control       | Detail                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation    | Zod schema: name, phone (7+ digits, digits and `+()-.` only), address, date (today to 1 year ahead), time (must exist in Pacific Time), repeat, notes (1000 chars), language. Errors list **field names only**, never the submitted values.                                                                                                                                                                |
| Honeypot      | A hidden `website` field, invisible to people and screen readers. If filled, the request is **silently dropped** and the bot still sees a success response.                                                                                                                                                                                                                                                |
| Rate limit    | 5 submissions per hour **per visitor**, answered with a translatable `429`. Behind Render the app sits behind Cloudflare, so the visitor's address is taken from `CF-Connecting-IP` (only when `TRUST_CLOUDFLARE_IP=true`; a forged header is ignored otherwise). In-memory, per instance (see gaps). The first version keyed on the proxy's address and was leaky; found and fixed in the Phase 6 review. |
| Flood cap     | At most 100 pending requests are stored; beyond that the form returns `503 busy` so a distributed flood cannot fill the database.                                                                                                                                                                                                                                                                          |
| Size limits   | 20 KB request body, column length `CHECK`s in the database.                                                                                                                                                                                                                                                                                                                                                |
| CSRF          | Still requires the `X-Requested-With` header, which blocks naive cross-site form posts. (Bots can send it; the other controls handle bots.)                                                                                                                                                                                                                                                                |
| No data back  | The response is `{ "ok": true }` and never echoes input. There is no way to read, list, or look up requests without logging in.                                                                                                                                                                                                                                                                            |
| Output        | Notes and names are plain text in the database and rendered as text by React; tests assert markup does not become HTML.                                                                                                                                                                                                                                                                                    |
| Logs          | Method, path, status only. Submissions never appear in logs (verified in a browser run: 0 matches for the submitted name, address, phone).                                                                                                                                                                                                                                                                 |
| Owner actions | Listing, accepting and declining are behind login. Accepting claims the request atomically (`WHERE status = 'pending'`) so two taps cannot create two appointments, and a failed accept puts the request back so nothing is lost.                                                                                                                                                                          |

### Retention

Booking requests hold a stranger's name, phone, and address, so they are deleted automatically: **decided requests after 30 days**, **unanswered ones after 60 days**. A cleanup runs at startup and every 12 hours. Accepting a request copies the details into an appointment the owners control; the request itself is not kept longer. Tested.

## Text messages

Texts to the owner add an outbound channel and a new way for a stranger to cause side effects (the public form can trigger a text), so they are constrained:

| Concern                                   | Control                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Personal data leaving the server          | Texts are fixed, generic sentences. A test asserts none of a client's name, address, phone, or note ever appears in a message. The provider and the sender phone only see the owner's number and that sentence.                            |
| Public form used to flood or run up costs | Dropped spam and invalid submissions send nothing; the form is rate limited (5/hour/IP); a **10-minute cooldown** per kind of text turns bursts into one; a **hard monthly cap** (default 150, under the free 200) stops sending entirely. |
| Secrets                                   | API key, sender number, and the owner's number are environment variables only, never logged. Misconfiguration **fails closed at startup** and names the setting, never its value.                                                          |
| Provider outage or slowness               | Sending is fire-and-forget with a 5 s timeout. A failure never fails or delays the user's request; it is counted (`sms_failed`) and logged without personal data.                                                                          |
| Logs                                      | One line per text: event, provider, outcome. Never the number or message body (verified by running the built server: 0 matches).                                                                                                           |
| Lock-in                                   | `SmsProvider` interface with httpSMS, Twilio (mocked tests only), and fake adapters.                                                                                                                                                       |

## Translation of notes

Translating means a client's free-text note leaves our server for a third party, so the design limits what, when, and how much:

| Concern           | Control                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is sent      | Only the text of **one note**, never a name, address, or phone number. The note field is the only free text, and the owners decide nothing is sent unless it is in the other language.                                                                                                   |
| Which provider    | Chosen for its data terms as well as cost: Cloudflare Workers AI states it does not train on or store customer content by default. Google's free Gemini tier was rejected because its terms allow using free-tier content to improve their products.                                     |
| Not an open proxy | `POST /api/translations` is login-only and takes an **id, never text**. The server reads the note from its own database, so a caller cannot use it to translate arbitrary text or spend the free allowance. Rate limited, plus an app-wide **daily cap** (200).                          |
| Cost and quota    | Each distinct note is translated once and cached; the cache stores only a hash, the languages, and the translation (never who it belongs to or the original), and **entries are deleted after 30 days**. The free provider fails rather than bills when its allowance is spent.          |
| Prompt injection  | The Claude adapter fences the note in `<note>` tags and tells the model the note is data to translate, never instructions. Any provider's output is length-checked, stored as plain text, and rendered by React as text, so a hostile note or translation cannot become markup (tested). |
| Failure           | Every failure is a normal answer, counted (`translations_failed`) and logged without the text. The original note is always shown first, so a provider outage can never hide or alter what a client wrote.                                                                                |
| Secrets           | Account ID, API token, and any Claude key are environment variables only, never logged. Misconfiguration **fails closed at startup** and names the setting, never its value.                                                                                                             |

## Threat model (short)

| Threat                               | Mitigation                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stranger guesses the login           | Strong password required at account creation (12+ chars), rate limit, argon2id                                                                                                |
| Stranger reads or edits appointments | Auth on all data routes; UUID ids                                                                                                                                             |
| Malicious client note (XSS)          | Output encoding by React; CSP; stored as plain text                                                                                                                           |
| Stolen phone with open session       | 90-day rolling session; logout button; server-side sessions can be revoked by deleting rows in `sessions`                                                                     |
| Leaked secret in git                 | `.env` ignored; `.env.example` has placeholders only; full-history scan before the repo goes public (Phase 6)                                                                 |
| Personal data in logs/errors         | Never logged; Sentry scrubbed; verified by smoke test (0 matches for client name/address in logs)                                                                             |
| Spam or flooding on the public form  | Strict validation, hidden trap field, 5 requests/hour/IP, a cap of 100 pending requests, 20 KB body limit, and automatic deletion of old requests (see "Public booking form") |

## Known gaps (honest list)

- **Shared login, no MFA.** The owners share one account for simplicity (they are not tech-savvy). Trade-off accepted; revisit if more staff are added.
- **Rate limit is per IP and in memory.** Fine for one instance; would need a shared store if scaled out. A determined attacker with many IPs is limited only by the 100-pending cap, not stopped; if real spam appears, add a free CAPTCHA (Cloudflare Turnstile).
- **Translations depend on a third party and are machine quality.** A note that contains an address is sent along with it. Cloudflare's model is free but less accurate than a large model on informal text, and the owners are told it is an _automatic_ translation. The original is always shown beside it.
- **Texts depend on a third-party relay and a phone.** If httpSMS is down or the sender phone is off, texts are delayed or lost (the app keeps working and records the failure). httpSMS offers end-to-end encryption, which is not enabled because the content is already generic.
- **Shared login.** The app cannot tell which owner made a change, so the owner is also texted about their own edits.
- **No confirmation to the client.** Clients are not emailed or texted (by design: less data). A request is also not verified to come from the phone number given.
- **No application-level field encryption.** Relies on provider encryption at rest.
- **Free-tier hosting** has no uptime or backup guarantees. Back up with `pg_dump` periodically (see `docs/deploy.md`).
- **No external penetration test.** Only automated tests, dependency audit, and my own review.

## Reporting a problem

Please report security issues **privately**, not in a public issue: use GitHub's "Report a vulnerability" button on the repository's Security tab. This is a small-business app maintained by one person, so there is no bounty and no guaranteed response time, but reports are taken seriously.
