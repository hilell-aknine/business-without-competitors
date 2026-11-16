// Voice to text for every chat in the portal (sandbox, lesson coach, apply
// coach). Added 2026-11-16. The browser records with MediaRecorder and POSTs
// the raw audio here; we pass it to Groq whisper-large-v3 (Hebrew) and return
// the text. The client puts it in the writing box for editing; nothing is sent
// to a coach automatically.
//
// Input:  POST, body = raw audio bytes, Content-Type = the recorder's mime type
//         (Chrome/Android: audio/webm;codecs=opus, Safari/iPhone: audio/mp4).
// Output: { ok, text, remaining }   |   { ok:false, reason }
// Auth:   guard + Supabase JWT + per-user daily cap (TRANSCRIBE_DAILY_CAP, 20).
// Off:    TRANSCRIBE_ENABLED=0, or no GROQ_API_KEY in the env.
//
// Body cap 4MB: Vercel rejects request bodies over 4.5MB before the function
// runs. 120 s of opus at the browser default is ~1-2MB, so this is generous.

import { passesGuard, requireAuth } from './_lib/guard.js';
import { consume } from './_lib/quota.js';

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const MODEL = 'whisper-large-v3';
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 2000; // under this there is no speech worth sending

// Groq accepts: flac mp3 mp4 mpeg mpga m4a ogg wav webm. The file NAME's
// extension is what tells it the container, so it must match the bytes.
const TYPES = [
  [/^audio\/webm|^video\/webm/, 'webm'],
  [/^audio\/mp4|^video\/mp4|^audio\/x-m4a|^audio\/m4a|^audio\/aac/, 'mp4'],
  [/^audio\/ogg/, 'ogg'],
  [/^audio\/mpeg|^audio\/mp3/, 'mp3'],
  [/^audio\/wav|^audio\/x-wav|^audio\/wave/, 'wav'],
  [/^audio\/flac/, 'flac'],
];

// Whisper fills silence with stock phrases from video subtitles.
const HALLUCINATION = /^(תודה( רבה)?( שצפיתם| על הצפייה)?|כתוביות[^.]*|תרגום[^.]*|שלום)[.!\s]*$/;

function enabled() {
  return GROQ_KEY && !/^(0|false|no)$/i.test(String(process.env.TRANSCRIBE_ENABLED || ''));
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) return { tooBig: true };
    chunks.push(chunk);
  }
  let buf = Buffer.concat(chunks);
  // Some runtimes hand the body over already read.
  if (!buf.length && Buffer.isBuffer(req.body)) buf = req.body;
  return { buf };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }
  if (!passesGuard(req, res)) return;
  const userId = await requireAuth(req, res);
  if (!userId) return;
  if (!enabled()) {
    res.status(503).json({ ok: false, reason: 'transcribe_unavailable' });
    return;
  }

  const mime = String(req.headers['content-type'] || '').toLowerCase().trim();
  const hit = TYPES.find(([re]) => re.test(mime));
  if (!hit) {
    res.status(415).json({ ok: false, reason: 'unsupported_audio' });
    return;
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BYTES) {
    res.status(413).json({ ok: false, reason: 'audio_too_big' });
    return;
  }

  const { buf, tooBig } = await readRaw(req);
  if (tooBig) {
    res.status(413).json({ ok: false, reason: 'audio_too_big' });
    return;
  }
  if (!buf || buf.length < MIN_BYTES) {
    res.status(400).json({ ok: false, reason: 'audio_too_short' });
    return;
  }

  const quota = await consume(req, userId, 'transcribe');
  if (!quota.ok) {
    res.status(429).json({ ok: false, reason: 'daily_cap', remaining: 0 });
    return;
  }

  const ext = hit[1];
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime.split(';')[0] }), `recording.${ext}`);
  form.append('model', MODEL);
  form.append('language', 'he');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const t0 = Date.now();
  let data;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      console.error(`[transcribe] groq ${r.status}: ${(await r.text()).slice(0, 300)}`);
      res.status(502).json({ ok: false, reason: 'transcribe_failed' });
      return;
    }
    data = await r.json();
  } catch (err) {
    console.error(`[transcribe] ${err.message}`);
    res.status(502).json({ ok: false, reason: 'transcribe_failed' });
    return;
  }

  // Drop segments Whisper itself thinks are silence, then stock filler.
  const segs = Array.isArray(data.segments) ? data.segments : null;
  let text = segs
    ? segs.filter(s => !(Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -0.7)).map(s => String(s.text || '').trim()).join(' ')
    : String(data.text || '');
  text = text.replace(/\s+/g, ' ').trim();
  if (HALLUCINATION.test(text)) text = '';

  console.log(`[transcribe] ${ext} ${buf.length}B ${Number(data.duration || 0).toFixed(1)}s -> ${text.length} chars in ${Date.now() - t0}ms quota=${quota.source}:${quota.remaining}`);

  if (!text) {
    res.status(200).json({ ok: false, reason: 'no_speech', remaining: quota.remaining });
    return;
  }
  res.status(200).json({ ok: true, text, remaining: quota.remaining });
}
