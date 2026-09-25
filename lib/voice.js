import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Voice of AUM lives in one place: voice-skill.txt at the repo root.
 * Every model call that writes or judges copy receives this text as its
 * system instruction. Edit the file, redeploy, and the whole engine changes voice.
 */
function load() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'voice-skill.txt'),
    join(here, '..', 'voice-skill.txt'),
    join(here, '..', '..', 'voice-skill.txt'),
  ];
  for (const path of candidates) {
    try {
      const text = readFileSync(path, 'utf8').trim();
      if (text) return text;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'voice-skill.txt was not found. It must sit at the repo root and be listed under ' +
    'functions["api/webhook.js"].includeFiles in vercel.json.'
  );
}

export const VOICE = load();
