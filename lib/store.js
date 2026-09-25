/**
 * The memory layer. Supabase over its REST API, so there is no client library
 * and no build step. If SUPABASE_URL and SUPABASE_SERVICE_KEY are not set the
 * engine still runs end to end, it just forgets. Nothing here ever deletes:
 * rejected notes and rejected drafts are what show you where the engine is weak.
 */
const enabled = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!enabled()) return null;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.warn(`supabase ${method} ${path} failed:`, (await res.text()).slice(0, 300));
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export const store = {
  enabled,

  async saveNote(note) {
    const rows = await rest('notes', {
      method: 'POST',
      body: [note],
      prefer: 'return=representation',
    });
    return rows?.[0] || null;
  },

  async saveDraft(draft) {
    const rows = await rest('drafts', {
      method: 'POST',
      body: [draft],
      prefer: 'return=representation',
    });
    return rows?.[0] || null;
  },

  async setDraftStatus(id, status) {
    return rest(`drafts?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status, decided_at: new Date().toISOString() },
      prefer: 'return=representation',
    });
  },

  async latestPendingDraft(chatId) {
    const rows = await rest(
      `drafts?chat_id=eq.${encodeURIComponent(chatId)}&status=eq.pending&order=created_at.desc&limit=1`
    );
    return rows?.[0] || null;
  },

  /** Telegram retries a webhook it believes failed. Process each update once. */
  async claimUpdate(updateId) {
    if (!enabled()) return memoryClaim(updateId);
    const rows = await rest('processed_updates', {
      method: 'POST',
      body: [{ update_id: updateId }],
      prefer: 'return=representation,resolution=ignore-duplicates',
    });
    if (rows === null) return memoryClaim(updateId); // storage down: fail open
    return rows.length > 0;
  },
};

const seen = new Set();
function memoryClaim(updateId) {
  if (seen.has(updateId)) return false;
  seen.add(updateId);
  if (seen.size > 500) seen.clear();
  return true;
}
