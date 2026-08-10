// Hebrew-aware lexical retrieval over the course transcripts.
//
// WHY THIS EXISTS (2026-08-10): the lesson coach used to send
// `transcript.slice(0, 30000)` — the FIRST 30k chars of the current lesson,
// and nothing else. Two consequences we measured:
//   1. 16 of 129 lessons are longer than 30k (the seminars reach 124k), so on
//      those the coach answered confidently from the opening minutes and was
//      blind to the rest.
//   2. A question answered in a different lesson got "this isn't covered in
//      this lesson" even though the course does cover it.
//
// This module fixes both without embeddings, an external vector store, or a
// build step: BM25 over paragraph chunks, plus a small prebuilt inverted index
// (api/_kb/_search-index.json, built by tools/build-kb-index.mjs) that lets us
// find WHICH other lessons are worth loading before we load them. Loading all
// 129 KB files per request would be ~2.4MB of decryption for nothing.
//
// Hebrew notes: we fold final letters (ך→כ), strip niqqud, and strip the
// clitic prefixes ו/ה/ב/ל/מ/כ/ש (up to two, e.g. "ולהצעה" → "הצעה"). No suffix
// stemming — it produced false merges on this corpus.

const NIQQUD = /[֑-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const PREFIX_LETTERS = 'והבלמכש';
const SPLIT = /[^֐-׿A-Za-z0-9]+/;

// Hebrew function words + course filler that carry no retrieval signal.
const STOP = new Set([
  'של', 'את', 'עם', 'זה', 'זאת', 'אני', 'אתה', 'הוא', 'היא', 'הם', 'הן', 'אנחנו',
  'לא', 'כן', 'גם', 'רק', 'אבל', 'או', 'כי', 'אם', 'כמו', 'יותר', 'מאוד', 'הכי',
  'יש', 'אין', 'היה', 'היתה', 'להיות', 'תהיה', 'יהיה', 'הזה', 'הזאת', 'האלה',
  'כל', 'כאן', 'שם', 'עכשיו', 'אחרי', 'לפני', 'בין', 'על', 'אל', 'עד', 'לי',
  'לך', 'לו', 'לה', 'לנו', 'להם', 'אותו', 'אותה', 'אותם', 'שלי', 'שלך', 'שלו',
  'שלה', 'שלנו', 'שלהם', 'מה', 'מי', 'איך', 'למה', 'מתי', 'איפה', 'כמה', 'האם',
  'צריך', 'אפשר', 'רוצה', 'עושה', 'אומר', 'אומרת', 'בעצם', 'ממש', 'טוב', 'אוקיי',
  'כאילו', 'בסדר', 'תראו', 'תראה', 'הנה', 'ככה', 'אז', 'עוד', 'פה', 'דבר',
]);

export function foldFinals(s) {
  return s.replace(/[ךםןףץ]/g, ch => FINALS[ch]);
}

export function stem(token) {
  let t = foldFinals(token);
  // strip up to two clitic prefixes while a meaningful root remains
  for (let i = 0; i < 2; i++) {
    if (t.length >= 4 && PREFIX_LETTERS.includes(t[0])) t = t.slice(1);
    else break;
  }
  return t;
}

export function tokenize(text) {
  const clean = String(text || '').replace(NIQQUD, '').replace(/[׳״'"]/g, '');
  const out = [];
  for (const raw of clean.split(SPLIT)) {
    if (!raw || raw.length < 2) continue;
    const low = raw.toLowerCase();
    if (STOP.has(low) || STOP.has(foldFinals(low))) continue;
    const s = stem(low);
    if (s.length < 2 || STOP.has(s)) continue;
    out.push(s);
  }
  return out;
}

// Paragraph-aware chunking. Chunks stay whole sentences where possible so a
// passage handed to the model never starts mid-word.
export function chunkText(text, size = 1200) {
  const src = String(text || '');
  const paras = src.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ''; };

  for (const p of paras) {
    if (p.length > size) {
      flush();
      const sentences = p.split(/(?<=[.!?׃…])\s+/);
      let sbuf = '';
      for (const s of sentences) {
        if (s.length > size) {                      // no sentence breaks at all
          if (sbuf) { chunks.push(sbuf.trim()); sbuf = ''; }
          for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
          continue;
        }
        if ((sbuf + ' ' + s).length > size) { chunks.push(sbuf.trim()); sbuf = s; }
        else sbuf = sbuf ? `${sbuf} ${s}` : s;
      }
      if (sbuf.trim()) chunks.push(sbuf.trim());
      continue;
    }
    if ((buf + '\n' + p).length > size) flush();
    buf = buf ? `${buf}\n${p}` : p;
  }
  flush();
  return chunks;
}

// BM25 over the chunks of a single document.
function bm25(chunks, queryTerms) {
  const k1 = 1.2, b = 0.75;
  const docs = chunks.map(c => tokenize(c));
  const lens = docs.map(d => d.length);
  const avg = lens.reduce((a, n) => a + n, 0) / (lens.length || 1) || 1;
  const N = docs.length || 1;

  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  }

  const q = [...new Set(queryTerms)];
  return docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (lens[i] / avg))));
    }
    return { i, score };
  });
}

/**
 * Pick the parts of `text` that actually answer `question`, up to `budget`
 * characters, in original reading order. Under budget the full text is
 * returned untouched — the old behaviour, which is right for short lessons.
 *
 * Returns { text, truncated, covered } where `covered` is the fraction of the
 * source that made it in (used for honest logging, not shown to learners).
 */
export function selectPassages(text, question, budget = 22000) {
  const src = String(text || '');
  if (src.length <= budget) return { text: src, truncated: false, covered: 1 };

  const chunks = chunkText(src);
  const qTerms = tokenize(question);
  if (!qTerms.length) {
    return { text: src.slice(0, budget), truncated: true, covered: budget / src.length };
  }

  const ranked = bm25(chunks, qTerms).sort((a, b) => b.score - a.score);
  const picked = new Set();
  let used = 0;
  for (const { i, score } of ranked) {
    if (score <= 0) break;
    const cost = chunks[i].length + 8;
    if (used + cost > budget) continue;
    picked.add(i);
    used += cost;
  }
  // Neighbours of a hit are cheap context and keep the argument coherent.
  for (const i of [...picked]) {
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= chunks.length || picked.has(j)) continue;
      const cost = chunks[j].length + 8;
      if (used + cost > budget) continue;
      picked.add(j);
      used += cost;
    }
  }
  if (!picked.size) return { text: src.slice(0, budget), truncated: true, covered: budget / src.length };

  const order = [...picked].sort((a, b) => a - b);
  let out = '';
  let prev = -2;
  for (const i of order) {
    if (i !== prev + 1 && out) out += '\n[…]\n';
    out += (out ? '\n' : '') + chunks[i];
    prev = i;
  }
  return { text: out, truncated: true, covered: used / src.length };
}

/**
 * Rank OTHER lessons against the question using the prebuilt inverted index,
 * so the caller only decrypts the two or three files worth reading.
 * `index` shape: { lessons:[{key,title}], terms:{ stem: [[lessonIdx, weight]] } }
 */
export function rankLessons(index, question, { exclude = '', limit = 3 } = {}) {
  if (!index || !index.terms || !Array.isArray(index.lessons)) return [];
  const qTerms = [...new Set(tokenize(question))];
  if (!qTerms.length) return [];

  const scores = new Map();
  for (const t of qTerms) {
    const postings = index.terms[t];
    if (!postings) continue;
    for (const [li, w] of postings) scores.set(li, (scores.get(li) || 0) + w);
  }
  if (!scores.size) return [];

  const ranked = [...scores.entries()]
    .map(([li, score]) => ({ ...index.lessons[li], score }))
    .filter(l => l && l.key && l.key !== exclude)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return [];
  // Relative floor: only lessons in the same league as the best match. A hard
  // absolute threshold misfires because scores scale with question length.
  const floor = Math.max(ranked[0].score * 0.45, 0.8);
  return ranked.filter(l => l.score >= floor).slice(0, limit);
}
