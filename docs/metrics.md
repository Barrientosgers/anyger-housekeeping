# Metrics

Every number below was **measured**, with the date and how. Nothing is estimated. The one section that needs your data is marked, because I cannot read the production database.

## Product usage (needs your real data)

The app counts usage anonymously (event name + day + count; no names, addresses, or phone numbers). To print the real figures from production, run this on your own computer so the database address never goes through chat or shell history:

```bash
cd ~/anyger-housekeeping
read -rs DATABASE_URL && export DATABASE_URL     # paste the Neon connection string, press Enter
npm run usage -w server
unset DATABASE_URL
```

It prints counters by month (appointments created and cancelled, repeating series created, booking requests received / accepted / declined, texts sent / failed, translations performed / failed) and counts of what is currently stored. Copy the real numbers into the table and use only those on a résumé.

| Measure                         | Value                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| Appointments created            | `[fill in: appointments_created]`                                 |
| Repeating series created        | `[fill in: series_created]`                                       |
| Booking requests received       | `[fill in: requests_received]`                                    |
| Booking requests accepted       | `[fill in: requests_accepted]`                                    |
| Texts sent / failed             | `[fill in: sms_sent / sms_failed]` (0 until texting is turned on) |
| Translations performed / failed | `[fill in]` (0 until translation is turned on)                    |
| Weeks in real use by the owners | `[fill in]`                                                       |

## Quality (measured 2026-10-05)

| Measure                                 | Value                                                                              | How                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Automated tests                         | **278** (212 server, 66 web)                                                       | `npm test`                                                                                                                      |
| Server coverage                         | 94.4% lines, 87.8% branches, 93.6% statements                                      | `npm run coverage -w server`                                                                                                    |
| Web coverage                            | 91.1% lines, 92.4% branches, 90.8% statements                                      | `npm run coverage -w web`                                                                                                       |
| Continuous integration                  | 54-68 s per run (median 68 s)                                                      | GitHub Actions; lint, typecheck, tests with coverage, build, `npm audit`, full-history secret scan                              |
| Known dependency vulnerabilities        | **0** (production and dev)                                                         | `npm audit`                                                                                                                     |
| Secrets or personal data in git history | **0 found**                                                                        | gitleaks and TruffleHog over every commit on every branch (35; merge commits carry no changes of their own), plus a regex sweep |
| Black-box security checks passed        | 25 of 25 locally; 23 of 25 on the previously deployed build (the 2 are fixed here) | `scripts/security-probe.sh`                                                                                                     |

## Performance and accessibility (live site, public page `/book`)

Lighthouse, mobile profile (simulated mid-range phone on a slow connection), three runs, 2026-10-05. The site is on a free host.

| Category          | Score (3 runs)                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Performance       | 96, 99, 99                                                                                                                      |
| **Accessibility** | **100, 100, 100**                                                                                                               |
| Best practices    | 100, 100, 100                                                                                                                   |
| SEO               | 82, 82, 82 before adding a meta description and `robots.txt`; those two fixes are in this phase and are **not yet re-measured** |

| Measure                                                      | Value                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| First / Largest Contentful Paint                             | 1.5 s / 1.5 s                                                                                         |
| Cumulative Layout Shift                                      | 0                                                                                                     |
| Total Blocking Time                                          | 70-200 ms                                                                                             |
| Page weight                                                  | 110 KiB                                                                                               |
| API latency, warm (`/healthz`, 20 requests, from my network) | min 87 ms, median 122 ms, p95 157 ms                                                                  |
| Free-tier cold start                                         | **not measured** (it depends on how long the service has been idle; Render documents roughly 30-60 s) |

The accessibility score is Lighthouse's automated checks only (contrast, labels, names, tap targets, document structure). It is not a substitute for testing with real users; that happened informally with the two owners.

## Size and shape (measured from the repository)

| Measure                        | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| Commits / merged pull requests | 35 / 9, over 4 days                                                   |
| Server source                  | 2,435 lines TypeScript + 112 lines SQL                                |
| Web source                     | 1,945 lines (TypeScript, TSX, CSS)                                    |
| Test code                      | 2,562 lines (server) + 994 lines (web)                                |
| Documentation                  | 699 lines across 7 Markdown files                                     |
| API routes / SQL migrations    | 15 / 4                                                                |
| Runtime dependencies           | 13 (server), 5 (web)                                                  |
| Production bundle              | JS 343 KB (107 KB gzipped), CSS 4.7 KB (1.6 KB gzipped)               |
| Container image                | 271 MB (Node 24 Alpine, runs as non-root)                             |
| Hosting cost                   | **$0** (Render free web service, Neon free Postgres, no card on file) |
