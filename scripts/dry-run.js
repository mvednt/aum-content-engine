/**
 * Runs the whole pipeline on a sample note, with no Telegram involved.
 * Use it to tune the voice and the score threshold before touching the bot.
 *
 *   node --env-file=.env scripts/dry-run.js
 *   node --env-file=.env scripts/dry-run.js "your own note text here"
 */
import { score, context, draft, formatDraft } from '../lib/pipeline.js';

const SAMPLE =
  'Something from our user calls this week. People describe themselves as long term investors, ' +
  'but the ones holding twelve or more funds are the ones opening the app most on red days. ' +
  'Three of them said they add a new fund after every dip. It makes them feel like they are doing something.';

const WEAK = 'Remember to renew the AMC registration and call the designer about the app icons.';

const note = process.argv[2] || SAMPLE;

const missing = ['GEMINI_API_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}. Try: node --env-file=.env scripts/dry-run.js`);
  process.exit(1);
}

console.log('NOTE\n' + note + '\n');

const scored = await score({ text: note });
console.log('SCORE', scored.score, JSON.stringify(scored.breakdown));
console.log('INSIGHT:', scored.insight);
console.log('REASON:', scored.reason);
console.log('SEARCH:', scored.searchPhrase, '\n');

const min = Number(process.env.MIN_SCORE) || 6;
if (scored.score < min) {
  console.log(`Below the threshold of ${min}. No draft. This is the correct outcome for a note like:`);
  console.log(`  "${WEAK}"`);
  process.exit(0);
}

const news = await context(scored.searchPhrase);
console.log('HEADLINES');
news.forEach((n, i) => console.log(`  ${i}. ${n.title} (${n.source}, ${n.date})`));
console.log('');

const drafted = await draft(scored, news);
console.log(formatDraft(scored, drafted, { id: 'dry', version: 1 }));
