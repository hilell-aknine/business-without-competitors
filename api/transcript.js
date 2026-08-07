// Fetches Hebrew transcript for a YouTube videoId.
// Strategy: scrape the watch page, find captionTracks, request the JSON3 transcript.
// Returns { ok: true, transcript } or { ok: false, reason }.

import { passesGuard, requireAuth } from './_lib/guard.js';

const transcriptCache = new Map(); // videoId -> { ts, transcript }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function pickHebrewTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const manualHe = tracks.find((t) => t.languageCode === 'iw' || t.languageCode === 'he');
  if (manualHe && (manualHe.kind || '') !== 'asr') return manualHe;
  const autoHe = tracks.find(
    (t) => (t.languageCode === 'iw' || t.languageCode === 'he') && t.kind === 'asr',
  );
  if (autoHe) return autoHe;
  return tracks[0];
}

async function getCaptionTracks(videoId) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=he`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`youtube_page_${res.status}`);
  const html = await res.text();
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
}

function decodeJson3(json3) {
  if (!json3?.events) return '';
  const parts = [];
  for (const ev of json3.events) {
    if (!ev.segs) continue;
    for (const seg of ev.segs) {
      if (seg.utf8) parts.push(seg.utf8);
    }
    parts.push(' ');
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export async function fetchTranscript(videoId) {
  const cached = transcriptCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ok: true, transcript: cached.transcript, fromCache: true };
  }

  let tracks;
  try {
    tracks = await getCaptionTracks(videoId);
  } catch (err) {
    return { ok: false, reason: 'fetch_error', detail: err.message };
  }

  if (!tracks || tracks.length === 0) {
    return { ok: false, reason: 'no_captions' };
  }

  const track = pickHebrewTrack(tracks);
  if (!track?.baseUrl) return { ok: false, reason: 'no_caption_url' };

  const captionUrl = track.baseUrl + '&fmt=json3';
  const cRes = await fetch(captionUrl);
  if (!cRes.ok) return { ok: false, reason: `caption_fetch_${cRes.status}` };

  let json3;
  try {
    json3 = await cRes.json();
  } catch {
    return { ok: false, reason: 'caption_parse_error' };
  }

  const transcript = decodeJson3(json3);
  if (!transcript || transcript.length < 50) {
    return { ok: false, reason: 'transcript_too_short' };
  }

  transcriptCache.set(videoId, { ts: Date.now(), transcript });
  return { ok: true, transcript, language: track.languageCode, kind: track.kind || 'manual' };
}

export default async function handler(req, res) {
  // 2026-08-07: this was the last unguarded handler — an open proxy that let
  // anyone on the internet pull YouTube captions through Hillel's Vercel
  // account. Same two-layer guard + JWT as the protocol-* endpoints.
  if (!passesGuard(req, res)) return;
  if (!(await requireAuth(req, res))) return;

  const videoId =
    (req.query && req.query.videoId) ||
    new URL(req.url, `http://${req.headers.host}`).searchParams.get('videoId');

  if (!videoId || !/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ ok: false, reason: 'invalid_videoId' });
    return;
  }

  const result = await fetchTranscript(videoId);
  res.status(result.ok ? 200 : 404).json(result);
}
