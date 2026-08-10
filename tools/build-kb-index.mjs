// tools/build-kb-index.mjs — build the cross-lesson search index.
//
// Reads every api/_kb/<lessonKey>.json (plaintext, local only) and writes
// api/_kb/_search-index.json: a compact inverted index of stem -> [[lessonIdx,
// weight]]. The lesson coach uses it to decide WHICH other lessons to decrypt
// and read for a given question, instead of loading all 129 files (~2.4MB).
//
// Run after tools/split-kb.mjs, then re-run tools/encrypt-kb.mjs so the
// ciphertext (_search-index.json.enc) is what ships — the repo is public.
//
//   node tools/build-kb-index.mjs
//   KB_SECRET=<hex64> node tools/encrypt-kb.mjs --verify
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { tokenize } from '../api/_lib/retrieval.js';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const KB_DIR = path.join(ROOT, 'api', '_kb');

const TOP_TERMS_PER_LESSON = 320;   // enough to cover a lesson's real topics
const MAX_POSTINGS_PER_TERM = 25;   // a term that's everywhere isn't a signal
const MAX_DF_RATIO = 0.6;           // drop terms present in >60% of lessons

const files = fs.readdirSync(KB_DIR)
  .filter(f => f.endsWith('.json') && f !== '_index.json' && !f.startsWith('apply-') && !f.startsWith('_search-index'))
  .sort();

if (!files.length) {
  console.error('[index] no plaintext KB files found in api/_kb — run tools/split-kb.mjs first');
  process.exit(1);
}

const lessons = [];
const docs = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(KB_DIR, f), 'utf8'));
  const key = j.key || f.replace(/\.json$/, '');
  const title = j.title || key;
  // The title is part of the searchable surface: a learner often asks using
  // the module's name, which may never be spoken inside the transcript.
  const terms = tokenize(`${title}\n${title}\n${j.text || ''}`);
  if (!terms.length) continue;
  lessons.push({ key, title });
  docs.push(terms);
}

const N = docs.length;
const df = new Map();
for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);

// tf-idf per lesson, keep the strongest terms only
const postings = new Map();
docs.forEach((d, li) => {
  const tf = new Map();
  for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
  const scored = [];
  for (const [t, f] of tf) {
    const n = df.get(t);
    if (n / N > MAX_DF_RATIO) continue;
    const idf = Math.log(1 + N / n);
    scored.push([t, (1 + Math.log(f)) * idf]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  for (const [t, w] of scored.slice(0, TOP_TERMS_PER_LESSON)) {
    if (!postings.has(t)) postings.set(t, []);
    postings.get(t).push([li, Math.round(w * 1000) / 1000]);
  }
});

const terms = {};
let kept = 0;
for (const [t, list] of postings) {
  list.sort((a, b) => b[1] - a[1]);
  terms[t] = list.slice(0, MAX_POSTINGS_PER_TERM);
  kept++;
}

const out = { built: new Date().toISOString().slice(0, 10), lessons, terms };
const outPath = path.join(KB_DIR, '_search-index.json');
fs.writeFileSync(outPath, JSON.stringify(out), 'utf8');

const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
console.log(`[index] ${N} lessons · ${kept} terms · ${kb}KB -> api/_kb/_search-index.json`);
console.log('[index] next: KB_SECRET=<hex64> node tools/encrypt-kb.mjs --verify');
