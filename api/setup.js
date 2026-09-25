import { telegram } from '../lib/telegram.js';

/**
 * One-time wiring. Open this URL in a browser once after the first deploy and
 * the deployment points Telegram at itself, using the token already in the
 * environment. That keeps the bot token out of a browser address bar.
 *
 * Safe to call again: it only ever points the webhook at this same deployment.
 * Delete this file once the engine is running if you would rather not have it.
 */
export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `https://${host}/api/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set.' });
  }

  const me = await telegram.call('getMe', {});
  const set = await telegram.call('setWebhook', {
    url,
    allowed_updates: ['message', 'channel_post'],
    ...(secret ? { secret_token: secret } : {}),
  });
  const info = await telegram.call('getWebhookInfo', {});

  return res.status(200).json({
    ok: Boolean(set.ok),
    bot: me.ok ? `@${me.result.username}` : 'token rejected',
    webhook: url,
    telegram_said: set.description || set.description === '' ? set.description : null,
    pending_updates: info.ok ? info.result.pending_update_count : null,
    last_error: info.ok ? info.result.last_error_message || null : null,
    next: 'Post /id in your capture channel. The bot replies with the chat ID.',
  });
}
