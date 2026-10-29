# Email alert for new booking requests (free, with Resend)

The app can email one address when a **new booking request** arrives, so you do not have to keep checking the app. It is **off until you turn it on**; nothing else changes if you never do.

It emails **only for new requests**. Appointment changes stay quiet by design, so the inbox stays calm. (Texts to the owner, if turned on, are separate; see [sms-setup.md](sms-setup.md).)

## What the email says

Deliberately generic, in both languages, with a link to the app:

> **Subject:** AnyGer's: nueva solicitud / new booking request
>
> Tiene una solicitud nueva. Abra la app para verla:
> You have a new booking request. Open the app to see it:
> https://your-app.onrender.com

It **never** contains a client's name, phone, address, email, or note. Email passes through a third-party service and sits in an inbox forever, so the details stay in the app, behind the login. A test checks this.

## Which service, and why

[Resend](https://resend.com) has a free plan and asks for no payment method. I believe it allows about 3,000 emails a month and 100 a day, but **check their [pricing page](https://resend.com/pricing)** when you sign up, because I have not verified the current numbers. Without your own domain, Resend can only send to **the email address you signed up with**. That is exactly this use: an alert to you.

The app also protects the free allowance on its own: at most **100 emails a month** (`EMAIL_MONTHLY_LIMIT`), and **one email per 10 minutes** (`EMAIL_COOLDOWN_MINUTES`), so a burst of requests becomes a single email.

## Setup (about 10 minutes)

1. Create a free account at resend.com, **using the email address where you want the alerts**.
2. In Resend, open **API Keys**, click **Create API Key**, give it **Sending access**, and copy the key. Treat it like a password: keep it in a password manager and never paste it into a chat.
3. In Render (service > Environment) add these, then **Save, rebuild, and deploy**:

   | Name             | Value                                                                   |
   | ---------------- | ----------------------------------------------------------------------- |
   | `EMAIL_PROVIDER` | `resend`                                                                |
   | `NOTIFY_EMAIL`   | the **same** address you signed up to Resend with                       |
   | `RESEND_API_KEY` | your key                                                                |
   | `APP_URL`        | the app's address (`https://...onrender.com`), if it is not already set |

   A missing or misspelled setting makes the app **refuse to start**, and the log names it (never its value), so a typo cannot quietly turn alerts off.

4. **Try it:** submit a test request at `/book`. Within a minute an email should arrive. Check the spam folder the first time and mark it "not spam". Then decline the test request.

To turn it off, set `EMAIL_PROVIDER` to `none` and redeploy.

## What happens when something goes wrong

A failure never affects the client's booking: the request is saved either way. Each failure logs one line with no personal data:

- `email failed ... reason: rejected`: Resend refused it. The most common cause is `NOTIFY_EMAIL` not matching the address the Resend account was created with (the free test sender only delivers to that address), or a wrong key.
- `reason: timeout` or `network`: Resend was slow or unreachable.
- `email skipped: monthly limit reached`: the app's own cap of 100 was hit; it resets next month.

Count what was sent (real numbers for your résumé):

```sql
SELECT event, sum(count) FROM usage_counters WHERE event LIKE 'email_%' GROUP BY event;
```

## For developers

Email sits behind a small `EmailProvider` interface (`server/src/services/email/`), the same idea as `SmsProvider`: a Resend adapter and a fake for tests. `createEmailNotifier` (`server/src/services/email-notify.ts`) holds the rules (new requests only, cooldown, monthly cap) and is combined with the text notifier in `server/src/index.ts`. Using your own domain later would only need `EMAIL_FROM`.
