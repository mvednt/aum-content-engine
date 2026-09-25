# AUM Content Engine

A note goes into a private Telegram channel. A scored, news-anchored LinkedIn post and X post come back in the Voice of AUM, for you to approve.

Nothing publishes itself. The founder stays the author.

## The flow

1. You drop a voice note or a few typed lines into the capture channel.
2. Gemini Flash transcribes it and scores it 0 to 10 on the AUM rubric.
3. Below the threshold: it comes back with the reason and no draft.
4. At or above: Gemini pulls a search phrase, Google News gives a hook if one genuinely fits.
5. The drafting model writes one LinkedIn post and one X post from the note and the voice skill.
6. A guardrail checks for tips, return promises, hype words, dashes, emoji and length. One repair pass.
7. The draft arrives in Telegram with a verify flag on any news claim.
8. You reply APPROVE or REJECT, or reply with notes to redraft.

## Setup

### 1. Telegram

Follow the pre-session guide: private channel, bot via @BotFather, bot added as channel
administrator with Post Messages only, chat ID from @userinfobot. The chat ID is a negative
number starting with `-100`.

### 2. Deploy

Push this repo to GitHub, then import it in Vercel. Before the first deploy, add the
environment variables from `.env.example` under Settings, Environment Variables.

Required: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `TELEGRAM_CHAT_ID`.

### 3. Connect Telegram to the deployment

Open this in a browser tab, with your own values:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook
```

You should see `{"ok":true}`. If you set `TELEGRAM_WEBHOOK_SECRET`, append
`&secret_token=<the same value>`.

Check the deployment is alive by opening `https://<your-project>.vercel.app/api/webhook`
in a browser. It answers with a small JSON status.

### 4. Memory (optional)

Create a Supabase project, run `supabase.sql` in the SQL editor, then add `SUPABASE_URL`
and `SUPABASE_SERVICE_KEY` in Vercel. Without these the engine still drafts, it just does
not remember, and APPROVE and REJECT have nothing to mark.

The service key bypasses row level security. It belongs in Vercel's environment variables
and nowhere else.

## Tuning it

`voice-skill.txt` is the voice. Every model call that judges or writes copy receives it as
its system instruction. Edit that file, redeploy, and the engine's voice changes. It is the
one file worth spending real time on.

`MIN_SCORE` sets the gate. 6 is the course default. Raise it if too much gets through, and
watch what gets rejected: if everything passes, the scoring prompt is too lenient.

`DRAFT_MODEL` is `gemini` or `claude`. Scoring and keyword extraction stay on Gemini Flash
either way, because that work is mechanical and should stay cheap. Claude tends to hold a
voice better across a full post, which is why the course moves drafting to it after the
first session. Switching needs `ANTHROPIC_API_KEY`.

## Testing without Telegram

```
cp .env.example .env     # fill in GEMINI_API_KEY
node --env-file=.env scripts/dry-run.js
node --env-file=.env scripts/dry-run.js "your own note here"
```

Run a strong note and a weak one. A logistics reminder should score 3 or below and produce
no draft. If everything scores well, the rubric is not doing its job.

## Files

```
api/webhook.js     the endpoint Telegram calls
lib/pipeline.js    score, context, draft, format
lib/models.js      Gemini and Claude, with the drafting switch
lib/news.js        Google News RSS and the verify flag
lib/lint.js        the guardrail
lib/telegram.js    sending, chunking, voice note download
lib/store.js       Supabase, optional
voice-skill.txt    the Voice of AUM
supabase.sql       the three tables
```

## Notes

- Telegram retries a webhook it believes failed. Each update is processed once, through
  `processed_updates` when Supabase is on and in memory when it is not. Without Supabase a
  cold start can let a retry through as a duplicate draft.
- The function answers Telegram even when the pipeline throws, and reports the error into
  the channel. A 500 would make Telegram retry the same note for hours.
- `TELEGRAM_CHAT_ID` is what keeps the bot private. Without it the bot answers anyone who
  finds it.
