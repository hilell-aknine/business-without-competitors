// Stage 2: active learning.
// Input: POST { transcript, methodology, mode: 'habit' | 'sim' | 'investigate' }
// Output: { ok, content, providerUsed }

import { callAI } from './_lib/providers.js';
import { STAGE2_PROMPTS } from './_lib/prompts.js';
import { passesGuard } from './_lib/guard.js';

const MAX_TRANSCRIPT_CHARS = 20000;
const MAX_METHODOLOGY_CHARS = 8000;

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

  const body = await readJsonBody(req);
  let { transcript, methodology, mode } = body;

  if (!methodology || !mode) {
    res.status(400).json({ ok: false, reason: 'missing_methodology_or_mode' });
    return;
  }

  const systemPrompt = STAGE2_PROMPTS[mode];
  if (!systemPrompt) {
    res.status(400).json({ ok: false, reason: 'invalid_mode' });
    return;
  }

  if (transcript && transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  if (methodology.length > MAX_METHODOLOGY_CHARS) {
    methodology = methodology.slice(0, MAX_METHODOLOGY_CHARS);
  }

  const userPrompt = [
    '## המתודולוגיה (כבר זוקקה מהשיעור):',
    methodology,
    transcript ? '\n## תמלול השיעור (להקשר נוסף):' : '',
    transcript || '',
    '\n---\nעכשיו צור את הפלט לפי הפורמט שהוגדר במערכת.',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await callAI(systemPrompt, userPrompt);
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }

  res.status(200).json({
    ok: true,
    content: result.text,
    providerUsed: result.providerUsed,
  });
}
