# Deploying for free (Render + Neon)

No credit card and nothing paid. Free tiers can change; check each provider's current limits.

## 1. Database (Neon)

1. Sign up at neon.tech with GitHub or email.
2. Create a project (region closest to California, e.g. US West).
3. Copy the **connection string** (looks like `postgres://user:...@ep-xxx.neon.tech/neondb?sslmode=require`). Treat it as a secret.

## 2. Web service (Render)

1. Sign up at render.com with GitHub.
2. **New > Blueprint**, pick this repo; Render reads `render.yaml`.
3. When asked, paste `DATABASE_URL` (the Neon string). `SESSION_SECRET` is generated for you. `SENTRY_DSN` is optional; leave blank.
4. Deploy. The app creates its tables on first start. The live URL looks like `https://anyger-housekeeping.onrender.com`.
5. Check `https://<your-url>/healthz` returns `{"ok":true}`.

## 3. Create the parents' login

From your laptop, without putting the secret in shell history:

```bash
read -rs DATABASE_URL && export DATABASE_URL     # paste the Neon string, press Enter
npm run user:create -w server -- parents@example.com admin
unset DATABASE_URL
```

You will be asked for the password twice (hidden). Use a long passphrase they can type, 12+ characters.

## 4. Share the booking link

Clients use `https://<your-url>/book`. Put it on a business card, text it to new clients, or save it as a shortcut on your phone. Requests show up as a yellow banner on the calendar. Nothing is emailed or texted yet (Phase 4 adds a text to your dad).

## 5. Keep it awake (optional, free)

Render's free service sleeps when idle, so the first open can take 30-60 seconds. Create a free monitor at uptimerobot.com (or cron-job.org) that requests `https://<your-url>/healthz` every 10-14 minutes.

## 6. Backups

Neon free-tier backup retention is limited. Take a manual backup occasionally:

```bash
read -rs DATABASE_URL && export DATABASE_URL
pg_dump "$DATABASE_URL" > anyger-backup-$(date +%F).sql   # contains personal data: keep it private, never commit
unset DATABASE_URL
```

Files named `anyger-backup-*.sql` are git-ignored, but keep backups outside the repo anyway.

## Usage numbers (for your résumé, real only)

```sql
SELECT event, sum(count) FROM usage_counters GROUP BY event;
```
