# Translating client notes (free, with Cloudflare)

Clients write notes in English or Spanish. The app can show your parents each note **in the language they are reading the app in**, with the **original always shown first and unchanged**, and the translation beneath it labelled "Traducción automática".

It is **off until you turn it on**, and it is never required: if it is off or down, the note simply shows as written.

## Which service does the translating, and why

| Option                                                   | Free?                                                                                                                                                                                                                                                                                                  | Used?                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Cloudflare Workers AI** (model `@cf/meta/m2m100-1.2b`) | Yes: [10,000 free "neurons" a day, and when used up requests **fail instead of billing**](https://developers.cloudflare.com/workers-ai/platform/pricing/). Cloudflare says it [does not train on or store your content by default](https://developers.cloudflare.com/workers-ai/platform/data-usage/). | **Yes, this is the real one.**                    |
| **Claude API** (the original plan)                       | **No.** [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) offers only "a small amount of free credits to test the API" for new users, then billing per use with a card.                                                                                             | Built and tested, **off by default** (see below). |
| Google Gemini free tier                                  | Free, but Google's page says free-tier content [is used to improve their products](https://ai.google.dev/gemini-api/docs/pricing).                                                                                                                                                                     | No: clients' notes should not go there.           |

At about 31,000 neurons per million tokens, a typical note (a few dozen tokens) uses a tiny fraction of the daily allowance. The app also caps itself at **200 translations a day** (`TRANSLATE_DAILY_LIMIT`) and **never translates the same note twice** (cached for 30 days).

## What is sent, and what is not

Only the **text of one note** is sent to Cloudflare, and only when it is in the other language. Names, addresses, and phone numbers are never sent. (If a client types an address _inside_ their note, that text goes along with it, which is a reason this uses a provider that says it does not store or train on content.)

## Setup (about 15 minutes)

I have read Cloudflare's getting-started page, but I have **not** used a live Cloudflare account, so check the wording against [their guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) if a screen looks different.

1. Create a **free account** at cloudflare.com. No payment method is needed to use the free allowance.
2. In the Cloudflare dashboard open **Workers AI**, choose **Use REST API**, and **Create a Workers AI API Token**. Copy the token and your **Account ID**. (A custom token needs the permissions _Workers AI - Read_ and _Workers AI - Edit_.) Treat the token like a password.
3. **Test it from your terminal** before touching the app (this is the check I could not do for you). The token is typed at a hidden prompt so it never lands in your shell history:

   ```bash
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN     # paste the token, press Enter
   export CLOUDFLARE_ACCOUNT_ID=your-account-id
   curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/m2m100-1.2b" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
     -d '{"text":"Please use the back door","source_lang":"en","target_lang":"es"}'
   unset CLOUDFLARE_API_TOKEN
   ```

   You should get JSON containing a Spanish sentence (`translated_text`). If you get an error about the language values, try `"source_lang":"english","target_lang":"spanish"` instead; Cloudflare's docs show both forms. If the names work, set `CLOUDFLARE_LANG_FORMAT=name` in step 4.

4. In Render (service > Environment > Edit) add these, then **Save, rebuild, and deploy**:

   | Name                     | Value                               |
   | ------------------------ | ----------------------------------- |
   | `TRANSLATE_PROVIDER`     | `cloudflare`                        |
   | `CLOUDFLARE_ACCOUNT_ID`  | your Account ID                     |
   | `CLOUDFLARE_API_TOKEN`   | your token                          |
   | `CLOUDFLARE_LANG_FORMAT` | only if step 3 needed names: `name` |

   A missing setting makes the app **refuse to start** and the log names it (never its value), so a typo cannot quietly turn translation off.

5. **Try it:** submit a booking request at `/book` with an English note, open it on the owners' side, and the Spanish translation should appear under the original. Then delete the test request.

To turn it off, set `TRANSLATE_PROVIDER` to `none` and redeploy.

## What happens when something goes wrong

The original note is always there. Below it you may see a small **"No se pudo traducir ahora. Intentar de nuevo"**. Each failure logs one line with no note text:

- `translation failed ... reason: rejected`: the provider refused it (wrong token or account ID, wrong language format).
- `reason: quota`: the daily allowance is used up; it resets the next UTC day.
- `reason: timeout` or `network`: Cloudflare was slow or unreachable.
- `translation skipped: daily limit reached`: the app's own cap of 200.

Count what was translated (real numbers for your résumé):

```sql
SELECT event, sum(count) FROM usage_counters WHERE event LIKE 'translations_%' GROUP BY event;
```

## The Claude adapter (off by default)

Translation sits behind a small `Translator` interface (`server/src/services/translate/`), the same idea as the text-message provider. A **Claude adapter** is included, built on Anthropic's official SDK and tested against a stand-in client: it uses `claude-opus-5-5` at low effort, keeps the note fenced as data with an instruction never to obey it, and enables the API's refusal fallbacks. Because the Claude API is not free, you would only turn it on if you ever have credits:

`TRANSLATE_PROVIDER=claude`, `ANTHROPIC_API_KEY=...`, and optionally `ANTHROPIC_MODEL`.

It has **not** been run against the real Claude API, since that needs a funded key. Claude would translate better than Cloudflare's model, especially for informal text, which is the trade you make by staying free.
