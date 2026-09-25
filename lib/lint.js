/**
 * The guardrail. The model is told the rules in voice-skill.txt; this checks
 * whether it followed them. Anything it flags goes back for one repair pass,
 * and whatever survives is shown to the founder alongside the draft.
 */
const BANNED = [
  'unlock', 'game-changer', 'game changer', 'skyrocket', 'multibagger', 'to the moon',
  'financial freedom', 'wealth creation', "don't miss", 'revolutionary', 'empower',
  'guaranteed', 'target price', 'stop loss', 'stop-loss', 'follow for more',
  'dm us', 'comment below', 'link in bio',
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

export function lint(out) {
  const issues = [];
  const thread = out.x_thread || [];
  const all = [out.linkedin || '', out.x_post || '', ...thread].join('\n');

  if (/[—–]/.test(all)) issues.push('uses an em or en dash; use a full stop or a comma');
  if (/!/.test(all)) issues.push('uses an exclamation mark');
  if (/\p{Extended_Pictographic}/u.test(all)) issues.push('contains an emoji');
  if (/#\w/.test(out.linkedin || '')) issues.push('the LinkedIn post has a hashtag');

  for (const word of BANNED) {
    if (new RegExp(`\\b${escape(word)}\\b`, 'i').test(all)) issues.push(`banned phrase "${word}"`);
  }
  if (/\b(buy|sell|accumulate|exit|book profits?)\b[^.]{0,40}\b(now|today|this week|at \d)/i.test(all)) {
    issues.push('reads as a buy or sell call');
  }
  if (/\b(will|can|could|should) (double|triple|give you \d|return \d)/i.test(all)) {
    issues.push('implies a return promise');
  }

  const words = (out.linkedin || '').split(/\s+/).filter(Boolean).length;
  if (words < 90 || words > 260) issues.push(`the LinkedIn post is ${words} words; aim for 120 to 220`);
  if ((out.x_post || '').length > 280) issues.push(`the X post is ${out.x_post.length} characters; 280 is the limit`);
  thread.forEach((t, i) => {
    if (t.length > 280) issues.push(`thread post ${i + 1} is over 280 characters`);
  });

  return issues;
}

export const clean = (s) =>
  String(s || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
