/**
 * Diagnostics. Lists the Gemini models this key can actually call, so the
 * model name in GEMINI_MODEL is a fact rather than a guess. Model names change
 * and old ones get retired for new keys, which is exactly the failure this
 * endpoint is here to make visible.
 */
export default async function handler(req, res) {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY is not set.' });
  }

  const listed = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } }
  );
  if (!listed.ok) {
    return res.status(200).json({ ok: false, status: listed.status, body: (await listed.text()).slice(0, 400) });
  }

  const usable = (await listed.json()).models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));

  // A live one-token call tells you whether a model is up right now, which the
  // listing does not: a listed model can still answer 503 under load.
  const probe = String(req.query.probe || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const results = {};
  for (const name of probe.slice(0, 6)) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with {"ok":true}' }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 20 },
          }),
        }
      );
      results[name] = r.ok ? 'up' : `${r.status} ${(await r.text()).slice(0, 120)}`;
    } catch (err) {
      results[name] = `threw: ${err.message}`;
    }
  }

  return res.status(200).json({
    ok: true,
    configured: process.env.GEMINI_MODEL || '(default)',
    usable,
    probed: probe.length ? results : 'add ?probe=name1,name2 to test models live',
  });
}
