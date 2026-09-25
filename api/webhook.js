import { telegram } from '../lib/telegram.js';
import { store } from '../lib/store.js';
import { score, context, draft, formatDraft } from '../lib/pipeline.js';

const HELP = [
  'Send a note to this channel. A voice note or a few typed lines both work.',
  '',
  'What happens: the note is transcribed, scored 0 to 10 for whether it is worth',
  'publishing, given a market or news hook if one genuinely fits, and drafted as',
  'one LinkedIn post and one X post in the Voice of AUM.',
  '',
  'On a draft: reply APPROVE or REJECT. Reply with your own notes to redraft.',
  'Notes scoring below the threshold come back with the reason and no draft.',
].join('\n');

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'AUM Content Engine',
      draft_model: process.env.DRAFT_MODEL || 'gemini',
      memory: store.enabled() ? 'supabase' : 'off',
    });
  }
  if (req.method !== 'POST') return res.status(405).end();

  // Telegram sends this header when setWebhook was called with secret_token.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).end();
  }

  // Answer Telegram no matter what happens below. A 500 makes it retry the
  // same update for hours, which would mean the same note drafted many times.
  try {
    await route(req.body || {});
  } catch (err) {
    console.error(err);
    const chatId = chatIdOf(req.body) || process.env.TELEGRAM_CHAT_ID;
    if (chatId) {
      await telegram
        .send(chatId, `Something broke before the draft was ready.\n\n${err.message}`)
        .catch(() => {});
    }
  }
  return res.status(200).json({ ok: true });
}

const chatIdOf = (update) => {
  const msg = update?.message || update?.channel_post;
  return msg?.chat?.id ? String(msg.chat.id) : null;
};

async function route(update) {
  const msg = update.message || update.channel_post;
  if (!msg) return;

  if (update.update_id && !(await store.claimUpdate(update.update_id))) return;

  const chatId = String(msg.chat.id);

  // The bot answers exactly one chat: the capture channel.
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (allowed && chatId !== String(allowed)) {
    console.warn(`ignoring chat ${chatId}; TELEGRAM_CHAT_ID is ${allowed}`);
    return;
  }

  const text = (msg.text || msg.caption || '').trim();
  const audio = msg.voice || msg.audio;

  if (/^\/(start|help)\b/i.test(text)) return telegram.send(chatId, HELP);
  if (/^\/id\b/i.test(text)) return telegram.send(chatId, `This chat's ID is ${chatId}`);

  const verdict = text.match(/^(approve|reject)\b/i);
  if (verdict) return decide(chatId, verdict[1].toLowerCase());

  if (audio) return handleNote(chatId, { audio });
  if (text && !text.startsWith('/')) return handleNote(chatId, { text });
}

async function decide(chatId, verdict) {
  const pending = await store.latestPendingDraft(chatId);
  if (!pending) {
    return telegram.send(
      chatId,
      store.enabled()
        ? 'No draft is waiting on a decision.'
        : 'Memory is off, so there is nothing to mark. Set SUPABASE_URL and SUPABASE_SERVICE_KEY to track approvals.'
    );
  }
  await store.setDraftStatus(pending.id, verdict === 'approve' ? 'approved' : 'rejected');
  return telegram.send(
    chatId,
    verdict === 'approve'
      ? 'Approved and saved. The copy above is ready to post.'
      : 'Rejected and kept. Rejected drafts are what show where the engine is weak.'
  );
}

async function handleNote(chatId, input) {
  await telegram.send(chatId, input.audio ? 'Listening and scoring.' : 'Scoring.');

  const note = input.audio
    ? {
        audioBase64: await telegram.fileAsBase64(input.audio.file_id),
        mimeType: input.audio.mime_type || 'audio/ogg',
      }
    : { text: input.text };

  const scored = await score(note);
  const minScore = Number(process.env.MIN_SCORE ?? 6);

  const savedNote = await store.saveNote({
    chat_id: chatId,
    source: input.audio ? 'voice' : 'text',
    transcript: scored.transcript,
    score: scored.score,
    breakdown: scored.breakdown,
    core_insight: scored.insight,
    reason: scored.reason,
    search_phrase: scored.searchPhrase,
    status: scored.score < minScore ? 'rejected' : 'drafting',
  });

  if (scored.score < minScore) {
    return telegram.send(
      chatId,
      [
        `Scored ${scored.score}/10. No draft.`,
        '',
        scored.reason,
        '',
        `Transcript: ${scored.transcript}`,
      ].join('\n')
    );
  }

  await telegram.send(
    chatId,
    `Scored ${scored.score}/10. Core idea: ${scored.insight}\nLooking for a hook and drafting.`
  );

  const news = await context(scored.searchPhrase);
  const drafted = await draft(scored, news);

  const savedDraft = await store.saveDraft({
    chat_id: chatId,
    note_id: savedNote?.id ?? null,
    linkedin: drafted.linkedin,
    x_post: drafted.x_post,
    x_thread: drafted.x_thread,
    hook_title: drafted.hook?.title ?? null,
    hook_source: drafted.hook?.source ?? null,
    hook_url: drafted.hook?.url ?? null,
    guardrail_flags: drafted.issues,
    model: process.env.DRAFT_MODEL || 'gemini',
    version: 1,
    status: 'pending',
  });

  return telegram.send(
    chatId,
    formatDraft(scored, drafted, { id: savedDraft?.id, version: 1 })
  );
}
