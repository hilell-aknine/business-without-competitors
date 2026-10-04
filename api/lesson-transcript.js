// התמלול המלא של שיעור — לטאב "תמלול" בדף השיעור.
//
// Input:  GET ?lesson=<lessonKey>   (m0-1-0, s2-1 …)
// Output: { ok, key, title, text }  — text is the lesson's full transcript,
//         with the caption line breaks folded into running prose.
// Auth:   Supabase JWT required (Authorization: Bearer <access_token>).
//
// Added 2026-10-04 at Hillel's request ("a tab with the full transcript of
// every lesson, easy to copy").
//
// Why a server endpoint and not a static file: the repo is public and the
// transcripts are committed only as ciphertext (see _lib/kb.js). Serving the
// decrypted text behind a login keeps iron rule 4 intact — nothing readable
// ever lands in git or in a client bundle. The same text is already shared
// with members through the "תמלולים מלאים" Drive folder in the menu, so a
// logged-in reader sees nothing they couldn't already get.
//
// api/transcript.js (the old one) scrapes YouTube captions and has been dead
// since the videos moved to Workspace; this one reads the local KB.

import { passesGuard, requireAuth } from './_lib/guard.js';
import { loadKb } from './_lib/kb.js';

const LESSON_KEY_RE = /^(m[0-7]-\d{1,2}-\d{1,2}|s[0-6]-\d{1,2})$/;

// The KB text is raw YouTube captions: ~40-char lines, no punctuation, no
// paragraphs (checked 2026-10-04). Read as-is it looks like a poem; pasted
// elsewhere it breaks mid-sentence. Fold the caption lines into prose and cut
// a paragraph every LINES_PER_PARAGRAPH lines (~450 chars) so a 40K-char
// seminar is still scannable. Display and copy use the same text.
const LINES_PER_PARAGRAPH = 12;

function toProse(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PARAGRAPH) {
    paragraphs.push(lines.slice(i, i + LINES_PER_PARAGRAPH).join(' ').replace(/\s{2,}/g, ' '));
  }
  return paragraphs.join('\n\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }
  if (!passesGuard(req, res)) return;
  if (!(await requireAuth(req, res))) return;

  const lessonKey =
    (req.query && req.query.lesson) ||
    new URL(req.url, `http://${req.headers.host}`).searchParams.get('lesson');

  if (!lessonKey || !LESSON_KEY_RE.test(lessonKey)) {
    res.status(400).json({ ok: false, reason: 'invalid_lesson' });
    return;
  }

  const kb = loadKb(lessonKey);
  if (!kb || !kb.text) {
    // 3 lessons have no transcript (m6-0-1, m6-1-2 + the two Workspace-locked
    // module 7 videos). Say so plainly; the client shows an honest empty state.
    res.status(404).json({ ok: false, reason: 'no_transcript' });
    return;
  }

  // Per-user content: never let a shared cache hold it.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).json({ ok: true, key: lessonKey, title: kb.title || '', text: toProse(kb.text) });
}
