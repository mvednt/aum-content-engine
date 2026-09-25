import { gemini, draftModel } from './models.js';
import { fetchNews, marketPulse, dedupe, verifyFlag } from './news.js';
import { lint, clean } from './lint.js';

/* ------------------------------------------------------------------ */
/* 1. Score                                                            */
/* ------------------------------------------------------------------ */

const scorePrompt = (text) => `${
  text
    ? `FOUNDER NOTE (text):\n${text}`
    : 'FOUNDER NOTE: the attached voice note. Transcribe it faithfully first. Keep Hinglish phrases as spoken, drop filler words.'
}

Score this note against the triage rubric below. Be strict. Most raw notes land at 4 to 6.
A logistics reminder, a to-do, or an abandoned half-thought scores 3 or below.

Recognition (0 to 3): will an investor see their own behaviour in it?
Specificity (0 to 2): a concrete behaviour, number or situation, not a platitude.
Freshness (0 to 2): says something the feed is not already saying.
Evidence (0 to 2): supportable by the note, a data point, or a known behavioural finding.
Safety (0 to 1): works without a tip, a prediction or a return promise.

Return JSON only:
{"transcript": string,
 "score": integer 0-10,
 "breakdown": {"recognition":0,"specificity":0,"freshness":0,"evidence":0,"safety":0},
 "core_insight": "the one idea worth posting, in one plain sentence",
 "reason": "one line on why it scored this, and what is missing if it is low",
 "search_phrase": "3 to 5 words for a Google News India search that could give this idea a timely hook"}`;

export async function score(note) {
  const parts = [];
  if (note.audioBase64) {
    parts.push({
      inline_data: { mime_type: note.mimeType || 'audio/ogg', data: note.audioBase64 },
    });
  }
  parts.push({ text: scorePrompt(note.text) });

  const out = await gemini(parts, { temperature: 0.2 });
  return {
    transcript: clean(out.transcript || note.text || ''),
    score: Number(out.score) || 0,
    breakdown: out.breakdown || {},
    insight: out.core_insight || '',
    reason: out.reason || '',
    searchPhrase: out.search_phrase || '',
  };
}

/* ------------------------------------------------------------------ */
/* 2. Context                                                          */
/* ------------------------------------------------------------------ */

export async function context(searchPhrase) {
  const [topical, pulse] = await Promise.all([
    fetchNews(searchPhrase || 'Indian investors mutual funds', 4),
    marketPulse(),
  ]);
  return dedupe([...topical, ...pulse]).slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* 3. Draft                                                            */
/* ------------------------------------------------------------------ */

const draftPrompt = (scored, news, feedback, previous) => `FOUNDER NOTE (transcript):
${scored.transcript}

CORE INSIGHT: ${scored.insight}

RECENT HEADLINES (India, last few days):
${news.map((n, i) => `${i}. ${n.title} | ${n.source} | ${n.date}`).join('\n') || '(none found)'}
${previous ? `\nPREVIOUS DRAFT (write a clearly different one):\nLinkedIn: ${previous.linkedin}\nX: ${previous.x_post}\n` : ''}${feedback ? `\nFOUNDER FEEDBACK ON THE LAST DRAFT (follow it):\n${feedback}\n` : ''}
Write one LinkedIn post and one X post in the Voice of AUM, from the founder note.

On the headline: use at most one, and only if it genuinely makes the insight sharper or timelier.
If none fits, use none and set hook_index to null. Never force it.
On numbers: use only figures from the note or from the headline you chose. Name the source of any
market figure in plain words. Invent nothing.
Optionally add an X thread of 3 to 5 posts if the idea has real steps. Otherwise return [].

Run the self-check from your instructions before answering.

Return JSON only:
{"hook_index": integer or null,
 "hook_reason": "one line, or empty",
 "linkedin": string,
 "x_post": string,
 "x_thread": [string]}`;

const repairPrompt = (out, issues) => `This AUM draft failed the guardrail check.
Fix only these, and keep everything else as close to the original as you can:
- ${issues.join('\n- ')}

DRAFT:
${JSON.stringify({ linkedin: out.linkedin, x_post: out.x_post, x_thread: out.x_thread })}

Return JSON only, same keys: {"linkedin": string, "x_post": string, "x_thread": [string]}`;

export async function draft(scored, news, { feedback, previous } = {}) {
  const first = await draftModel(draftPrompt(scored, news, feedback, previous));

  let out = {
    linkedin: clean(first.linkedin),
    x_post: clean(first.x_post),
    x_thread: (first.x_thread || []).map(clean).filter(Boolean),
  };

  let issues = lint(out);
  if (issues.length) {
    try {
      const fixed = await draftModel(repairPrompt(out, issues));
      const repaired = {
        linkedin: clean(fixed.linkedin) || out.linkedin,
        x_post: clean(fixed.x_post) || out.x_post,
        x_thread: (fixed.x_thread || out.x_thread).map(clean).filter(Boolean),
      };
      // Keep the repair only if it actually improved things.
      if (lint(repaired).length < issues.length) {
        out = repaired;
        issues = lint(out);
      }
    } catch (err) {
      console.warn('repair pass failed:', err.message);
    }
  }

  const idx = first.hook_index;
  const hook = Number.isInteger(idx) && news[idx] ? news[idx] : null;

  return { ...out, issues, hook, hookReason: first.hook_reason || '' };
}

/* ------------------------------------------------------------------ */
/* 4. Present                                                          */
/* ------------------------------------------------------------------ */

export function formatDraft(scored, drafted, { id, version = 1 } = {}) {
  const lines = [
    `DRAFT ${id ? `#${id} ` : ''}v${version}  ·  note scored ${scored.score}/10`,
    drafted.issues.length
      ? `Guardrail: ${drafted.issues.join('; ')}`
      : 'Guardrail: clean',
    '',
    '== LINKEDIN ==',
    '',
    drafted.linkedin,
    '',
    '== X ==',
    '',
    drafted.x_post,
  ];

  if (drafted.x_thread.length) {
    lines.push('', '== X THREAD ==', '', drafted.x_thread.join('\n\n'));
  }
  if (drafted.hook) {
    lines.push('', verifyFlag(drafted.hook));
    if (drafted.hookReason) lines.push(`Why this hook: ${drafted.hookReason}`);
  } else {
    lines.push('', 'No news hook used.');
  }

  lines.push('', 'Reply APPROVE or REJECT. Reply with notes to redraft.');
  return lines.join('\n');
}
