import { VOICE } from './voice.js';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(text) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error(`Model did not return JSON: ${cleaned.slice(0, 200)}`);
  }
}

async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!err.retryable) break;
      await sleep(1200 * 2 ** attempt);
    }
  }
  throw Object.assign(new Error(`${label}: ${lastErr?.message || lastErr}`), {
    retryable: lastErr?.retryable,
  });
}

const FALLBACKS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

function modelList(explicit, envName) {
  const fromEnv = String(explicit || process.env[envName] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...FALLBACKS])];
}

async function callGemini(name, parts, temperature, system) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature, responseMimeType: 'application/json' },
      }),
    }
  );
  if (!res.ok) {
    const err = new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    err.retryable = RETRYABLE.has(res.status);
    throw err;
  }
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('empty response');
  return parseJson(text);
}

export async function gemini(parts, { model, temperature = 0.7, system = VOICE, envName = 'GEMINI_MODEL' } = {}) {
  const names = modelList(model, envName);
  const failures = [];
  for (const name of names) {
    try {
      return await withRetry(() => callGemini(name, parts, temperature, system), `Gemini (${name})`, 2);
    } catch (err) {
      failures.push(`${name}: ${err.message.replace(/^Gemini \([^)]+\): /, '')}`);
      if (err.status === 400) break;
    }
  }
  throw new Error(`No Gemini model answered.
${failures.join('\n')}`);
}

export async function claude(prompt, { temperature = 0.8, system = VOICE } = {}) {
  const name = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  return withRetry(async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: name,
        max_tokens: 2000,
        temperature,
        system: `${system}

Always reply with JSON only. No prose around it.`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const err = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      err.retryable = RETRYABLE.has(res.status);
      throw err;
    }
    const json = await res.json();
    const text = (json.content || []).map((b) => b.text || '').join('');
    if (!text) throw new Error('empty response');
    return parseJson(text);
  }, `Claude (${name})`);
}

export async function draftModel(prompt) {
  const choice = (process.env.DRAFT_MODEL || 'gemini').toLowerCase();
  if (choice === 'claude') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('DRAFT_MODEL is claude but ANTHROPIC_API_KEY is not set.');
    }
    return claude(prompt);
  }
  return gemini([{ text: prompt }], {
    model: process.env.GEMINI_DRAFT_MODEL || process.env.GEMINI_MODEL,
    temperature: 0.85,
  });
}
