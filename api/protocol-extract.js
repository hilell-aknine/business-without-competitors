// Stage 1: methodology extraction.
// Input: POST { videoId, transcript? }
// Output: { ok, methodology, providerUsed, transcript }

import { callAI } from './_lib/providers.js';
import { STAGE1_SYSTEM } from './_lib/prompts.js';
import { fetchTranscript } from './transcript.js';

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

  const body = await readJsonBody(req);
  const { videoId } = body;
  let transcript = body.transcript;

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
