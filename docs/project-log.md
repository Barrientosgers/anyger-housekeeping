# Project log

A running, dated record of what changed, why, and what is still open. **Newest first.** Add an entry at the end of every working session. It records facts only: numbers here were measured, and anything unverified says so.

For how the system works see [architecture.md](architecture.md); for security see [../SECURITY.md](../SECURITY.md); for usage numbers see [metrics.md](metrics.md).

## Open items (keep this list current)

| Item                                       | Status          | Notes                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real usage numbers for résumé bullets      | Waiting on time | After 2-4 weeks of real use run `npm run usage -w server`, subtract the baseline in [metrics.md](metrics.md), and **also subtract the test submissions listed there**. Never count development or testing as customer activity. |
| Render free hours                          | To verify       | Believed to be 750 instance-hours a month, which one always-awake service (about 744 h) fits. Not confirmed; check Render's usage page.                                                                                         |
| Resend free limits                         | To verify       | Believed ~3,000 emails/month and 100/day. Not confirmed; check resend.com/pricing. The app caps itself at 100/month regardless.                                                                                                 |
| Dependabot PRs #20-#24                     | Unreviewed      | Small version bumps. May need updating after the 2026-10-29 library fixes. Merge only after review.                                                                                                                             |
| Texts to the owner (httpSMS)               | Off, optional   | Setup in [sms-setup.md](sms-setup.md).                                                                                                                                                                                          |
| Feedback from the owners and other testers | Ongoing         | A few months of real use is the current trial. Ask for feedback first when resuming.                                                                                                                                            |

## 2026-10-29: email alert, security advisories

**Email alert for new booking requests (PR #26), live.**

- One generic, two-language email to the owner when a booking request arrives, free via Resend. It never contains a client's name, phone, address, email, or note (a test asserts this).
- New requests only; appointment changes stay quiet. A 10-minute cooldown turns bursts into one email; a hard cap of 100 a month protects the free plan. A failed send never fails or delays the client's booking.
- Built behind an `EmailProvider` interface (Resend + fake adapters), like `SmsProvider`. Off by default; a half-configured setup fails closed at startup and names the missing setting, never its value.
- Turned on in production the same day (`EMAIL_PROVIDER=resend`, `NOTIFY_EMAIL`, `RESEND_API_KEY`, `APP_URL` in Render) and **verified with a real test request: the email arrived.**
- Tests added: 23 (server 241, web 74 after this change).

**Security advisories fixed (PR #27).**

- New advisories against `body-parser` (high), `zod` (high), `qs`, and `ip-address` made the `npm audit` step in CI fail on `main`. Updated to body-parser 2.4.0, zod 4.6.7, qs 6.17.1, ip-address 10.7.5; `npm audit --omit=dev` then reported 0 vulnerabilities.
- **Lesson:** `npm audit fix` (and even a plain `npm install`) on macOS deletes the 26 `@esbuild/*` platform packages from `package-lock.json`, which would break installs on Linux CI (the same problem PR #13 fixed). Edit only the changed packages' lockfile entries instead, then verify with a clean `npm ci`.
- Live check after deploying: `scripts/security-probe.sh` passed 25 of 25, `/healthz` and `/book` responded 200, and a complete valid booking with the hidden bot-trap field filled was accepted (201) and not stored.

## 2026-10-22: CI failure on main

- The run after PR #19 failed for two reasons. First, the Postgres service container did not start (a GitHub-side flake; a re-run got past it). Second, six booking-form web tests failed because they typed the fixed date 2026-10-20 into a form that correctly refuses past dates. Reproduced locally.
- PR #25: the tests now type a date 30 days from today. **Lesson:** never hard-code calendar dates in tests that go through date validation. The app was never affected.

## 2026-10-21: keep-awake monitor

- Render's free service sleeps after about 15 minutes idle, so the first visitor waited up to two minutes (one cold start measured at 22 s).
- Added a free UptimeRobot monitor that requests `https://<app>/healthz` every 5 minutes. A one-off "down" from the Europe probe during the first check was a timeout while the app was waking; all regions were up afterward.
- PR #19: docs now say translation is live and verified.

## 2026-10-16: booking form changes and translation

**Booking form feedback (PR #18).** From the owners' review of `/book`:

- Contact preference: call, text, or email. The email box appears only when email is chosen; an email typed and then not chosen is neither sent nor stored.
- Cleaning type: apartment, house, office.
- How often: one time, every week, every 2 weeks, every month, move-in clean, move-out clean (a move is always a single visit, never combined with a repeat).
- City and a 5-digit ZIP are required; street and unit are optional. Phone must be a 10-digit US number and is stored in one format.
- The owners' request list, request page, and the pre-filled accept form show all of it; the cleaning type and move-in/out go at the start of the appointment notes. Old requests still display.
- Migration `005_booking_details.sql` is additive. `SECURITY.md` was updated: email is now collected, only when chosen, on the short-lived request.

**Note translation turned on.** Cloudflare Workers AI (free) set up in Render; an English test note showed its Spanish translation beneath the original on the owners' side, using the default language codes. The original is always shown first, and if translation is down the note shows as written.

## 2026-10-06: published

- All six phases built, tested, merged, and live. Repository made public (MIT) after a full-history secret and personal-data scan; `main` protected (required checks `test` and `secret-scan`). Usage baseline recorded in [metrics.md](metrics.md).

## How we work (reminders)

- One step at a time with exact commands. Never put secrets in chat: use `read -rs` hidden prompts, or type them straight into Render's Environment screen.
- Free tier only, forever. Never add a paid service or anything needing a card.
- Every change is a pull request; merge only when asked. Small, clear commits.
- Report only measured numbers; mark estimates with "~".
- Live-site check after a deploy: `scripts/security-probe.sh https://<app>` (sends only harmless requests; skip `--rate-limit` on production), plus `/healthz` and `/book`.
