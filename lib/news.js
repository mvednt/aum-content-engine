/**
 * Google News RSS. No account, no key, no quota to manage.
 * India edition, because AUM's readers are Indian investors.
 */
const FEED = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;

const strip = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const field = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? strip(m[1]) : '';
};

function formatDate(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

export async function fetchNews(query, limit = 4) {
  try {
    const res = await fetch(FEED(`${query} when:5d`), {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AUMContentEngine/1.0)' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const blocks = xml.split('<item>').slice(1, limit + 1);
    return blocks
      .map((b) => {
        const source = field(b, 'source');
        let title = field(b, 'title');
        if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
        return { title, source, date: formatDate(field(b, 'pubDate')), url: field(b, 'link') };
      })
      .filter((n) => n.title);
  } catch (err) {
    console.warn('news fetch failed:', err.message);
    return [];
  }
}

/** A market pulse the note's own query would not surface. */
export async function marketPulse() {
  const [close, flows] = await Promise.all([
    fetchNews('Sensex Nifty close', 2),
    fetchNews('mutual fund SIP inflows AMFI', 2),
  ]);
  return [...close, ...flows];
}

export function dedupe(items) {
  const seen = new Set();
  return items.filter((n) => {
    const key = n.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The verify flag. The answer key is explicit that this is not optional:
 * a fact published in the founder's name that they have not checked is the
 * exact failure the pipeline exists to prevent.
 */
export function verifyFlag(news) {
  if (!news) return '';
  return [
    '------------------------------',
    `NEWS SOURCE: ${news.title}`,
    `FROM: ${news.source || 'unknown'} · ${news.date || 'undated'}`,
    `LINK: ${news.url || 'none'}`,
    'Check this before publishing. You are the author of this claim.',
    '------------------------------',
  ].join('\n');
}
