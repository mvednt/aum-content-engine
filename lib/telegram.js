const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({ ok: false }));
  if (!json.ok) console.warn(`telegram ${method} failed:`, JSON.stringify(json).slice(0, 300));
  return json;
}

/** Telegram caps a message at 4096 characters. Split on paragraph breaks. */
function chunk(text, limit = 3900) {
  const out = [];
  let rest = String(text ?? '').trim() || ' ';
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.4) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

export async function send(chatId, text, opts = {}) {
  let last;
  for (const part of chunk(text)) {
    last = await call('sendMessage', {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: true,
      ...opts,
    });
  }
  return last;
}

/** Downloads a voice note and returns it as base64, for Gemini's inline_data. */
export async function fileAsBase64(fileId) {
  const meta = await call('getFile', { file_id: fileId });
  if (!meta.ok) throw new Error('Telegram would not hand over the voice note.');
  const res = await fetch(
    `https://api.telegram.org/file/bot${TOKEN()}/${meta.result.file_path}`
  );
  if (!res.ok) throw new Error(`Voice note download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export const telegram = { call, send, fileAsBase64 };
