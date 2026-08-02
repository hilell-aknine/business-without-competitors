// Stage 1: methodology extraction.
// Input: POST { lessonKey?, videoId?, transcript? }
// Output: { ok, methodology, providerUsed, transcript }
//
// 2026-08-02: transcripts now come from the local server-side KB
// (api/_kb/<lessonKey>.json) instead of scraping YouTube — YouTube blocked
// server-side caption scraping months ago, which left this feature dead.
// The YouTube path remains as a last-resort fallback. Auth is now required.

import { callAI } from './_lib/providers.js';
import { STAGE1_SYSTEM } from './_lib/prompts.js';
import { fetchTranscript } from './transcript.js';
import { passesGuard, requireAuth } from './_lib/guard.js';
import { loadKb } from './_lib/kb.js';

function localTranscript(lessonKey) {
  if (!lessonKey || !/^(m[0-7]-\d{1,2}-\d{1,2}|s[0-6]-\d{1,2})$/.test(lessonKey)) return null;
  const lesson = loadKb(lessonKey);
  return lesson ? lesson.text || null : null;
}

const MAX_TRANSCRIPT_CHARS = 30000;

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!passesGuard(req, res)) return;
  if (!(await requireAuth(req, res))) return;

  const body = await readJsonBody(req);
  const { videoId, lessonKey } = body;
  let transcript = body.transcript;

  // Preferred source: the local per-lesson KB file.
  if (!transcript) transcript = localTranscript(lessonKey);

  // Last resort: the old YouTube scrape (usually blocked by YouTube today).
  if (!transcript) {
    if (!videoId || !/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) {
      res.status(400).json({ ok: false, reason: 'missing_videoId_or_transcript' });
      return;
    }
    const tr = await fetchTranscript(videoId);
    if (!tr.ok) {
      res.status(424).json({ ok: false, reason: 'transcript_unavailable', detail: tr.reason });
      return;
    }
    transcript = tr.transcript;
  }

  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  const userPrompt = `הנה התמלול של השיעור. זקק ממנו את המתודולוגיה לפי הפורמט שהוגדר:\n\n---\n${transcript}\n---`;

  const result = await callAI(STAGE1_SYSTEM, userPrompt);
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }

  res.status(200).json({
    ok: true,
    methodology: result.text,
    providerUsed: result.providerUsed,
    transcript,
  });
}
