# Text messages to your dad (free, using an Android phone)

The app can text one phone number when a booking request arrives or an appointment is created, changed, or cancelled. It is **off until you turn it on**; nothing else changes if you never do.

## How it works

The app tells [httpSMS](https://httpsms.com) "send this text". httpSMS tells a small app on an **Android phone you own** to send it, using that phone's normal text plan. So there is no per-message fee, as long as the phone's plan includes texts. httpSMS's free plan allows 200 messages a month (check their pricing page; free-tier terms can change).

```
 booking request / appointment change
        v
   AnyGer's app  --(generic text)-->  httpSMS cloud  -->  sender Android phone  -->  Dad's phone
```

What you need:

- An Android phone with a text plan that stays **on and online** (for example your mom's Pixel). It must be a **different phone** from your dad's: a phone texting itself does not notify anyone.
- A free httpSMS account.

## Privacy: what the texts say

Texts are deliberately generic, for example:

> AnyGer's: tiene una solicitud nueva. Revise la app: https://anyger-housekeeping.onrender.com

They never contain a client's name, address, phone number, or notes. httpSMS and the sender phone only ever see your dad's number and that generic sentence. Your dad's number lives only in a Render setting, never in the code or GitHub.

## Setup (about 20 minutes)

I have read httpSMS's API documentation, but I have **not** installed their Android app, so follow httpSMS's own getting-started guide for steps 1-3, since their screens may differ from what is described here.

1. **Create a free account** at httpsms.com.
2. **Install their Android app** on the sender phone (they link it from their site), allow it to send SMS, and sign in.
3. **Copy your API key** from httpsms.com/settings. Treat it like a password.
4. **Set these in Render** (service > Environment > Edit), then **Save, rebuild, and deploy**:

   | Name                  | Value                                      |
   | --------------------- | ------------------------------------------ |
   | `SMS_PROVIDER`        | `httpsms`                                  |
   | `NOTIFY_PHONE_NUMBER` | your dad's number, like `+15551234567`     |
   | `HTTPSMS_FROM`        | the sender phone's number, same format     |
   | `HTTPSMS_API_KEY`     | the key from step 3                        |
   | `APP_URL`             | `https://anyger-housekeeping.onrender.com` |

   Numbers must start with `+` and the country code. If a setting is missing or malformed, the app **refuses to start** and the Render log names the setting (never its value), so a typo cannot silently drop texts.

5. **Test it:** create a test appointment in the app. Your dad's phone should get a text within about a minute. Then cancel the test appointment.

To turn texting off at any time, set `SMS_PROVIDER` to `none` (or delete the variable) and redeploy.

## Safety limits (built in)

| Limit                                   | Default                                               | Why                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Cooldown between texts of the same kind | 10 minutes (`SMS_COOLDOWN_MINUTES`)                   | A burst of requests, or several edits, becomes one text instead of buzzing a phone repeatedly. The banner and calendar show everything. |
| Monthly cap                             | 150 (`SMS_MONTHLY_LIMIT`)                             | Stays under the 200 free messages so you can never pay by surprise.                                                                     |
| Spam                                    | The public form's trap field and rate limit run first | Dropped spam never reaches the text step.                                                                                               |

Two parents share one login, so the app cannot tell who made a change. Your dad will also get a text for changes he makes himself. Accepting a request does **not** send a text.

## If a text does not arrive

Look at the Render logs. Each text logs one line with no personal data:

- `sms sent`: the app handed it to httpSMS. If it still did not arrive, check that the **sender phone is on, online, and not in battery-saver mode**, and that the httpSMS app is running.
- `sms failed ... reason: rejected`: httpSMS refused it. Usually a wrong or expired API key, a wrong sender number, or the free allowance is used up.
- `sms failed ... reason: network` or `timeout`: httpSMS was unreachable. The app keeps working; a failed text does not block the next one.
- `sms skipped: monthly limit reached`: the cap was hit.

Count what was sent this month (real numbers for your résumé):

```sql
SELECT event, sum(count) FROM usage_counters WHERE event LIKE 'sms_%' GROUP BY event;
```

## Switching provider later

Texting sits behind a small `SmsProvider` interface (`server/src/services/sms/`). Adapters exist for httpSMS (used), Twilio (code and mocked tests only; **not free beyond a trial**, so it is not used), and a fake for tests. Adding another provider is one new file plus a case in `createSmsProvider`.
