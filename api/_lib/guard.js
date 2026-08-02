// Lightweight abuse guard for the public /api/protocol-* endpoints.
// Two layers, both free and in-process (no DB, no external service):
//   1. Origin allowlist  — only our own site may call these endpoints.
//   2. Per-IP rate limit  — fixed window, caps how often a single client calls.
// Tuned for a single-author content site, not a high-traffic API.

const ALLOWED_ORIGINS = [
  'https://business-without-competitors.vercel.app',
  'https://hilell-aknine.github.io',
];

// Fixed-window rate limit. Resets every WINDOW_MS.
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 12; // generous for a real user, painful for a script
const hits = new Map(); // ip -> { count, windowStart }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Localhost (any port) is allowed so `vercel dev` / local testing of the AI
// feature still works. Localhost can only be the developer's own machine, not
// a remote attacker, so this does not weaken the guard against abuse.
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function originAllowed(req) {
  // Prefer Origin; fall back to Referer host. Same-origin browser requests
  // always send one of these. Server-to-server abuse scripts usually don't.
  const origin = req.headers.origin;
  if (origin) return isAllowedOrigin(origin);

  const referer = req.headers.referer;
  if (referer) {
    try {
      return isAllowedOrigin(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false; // no Origin and no Referer -> reject (defensive)
}

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_REQUESTS_PER_WINDOW;
}

// Returns true if the request is allowed through. If false, it has already
// written the rejection response — the handler should just return.
export function passesGuard(req, res) {
  if (!originAllowed(req)) {
    res.status(403).json({ ok: false, reason: 'forbidden_origin' });
    return false;
  }
  if (rateLimited(clientIp(req))) {
    res.status(429).json({ ok: false, reason: 'rate_limited' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Layer 3 (2026-08-02): real authentication.
// The Origin allowlist is spoofable server-to-server; the rate limit resets
// per Vercel instance. requireAuth() closes that hole: the caller must present
// a valid Supabase user JWT (Authorization: Bearer <access_token>), which we
// verify against Supabase's auth server. Verification results are cached
// in-process for a few minutes so repeated calls don't add latency.
//
// Env (set in Vercel project settings; safe fallbacks are the public values
// already shipped in js/supabase-config.js — the anon key is public by design):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hiosnmkszdktirpfzjqi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb3NubWtzemRrdGlycGZ6anFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjkyNzksImV4cCI6MjA5NDAwNTI3OX0.05RyNeLVWLXDMUVBV-C7kq2e0hamg5oQttMiKp8UaMQ';

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const authCache = new Map(); // token -> { userId, expires }

function bearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function verifySupabaseToken(token) {
  const cached = authCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.userId;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !user.id) return null;
    // Bound the cache so a scripted flood of unique junk tokens can't grow it.
    if (authCache.size > 500) authCache.clear();
    authCache.set(token, { userId: user.id, expires: Date.now() + AUTH_CACHE_TTL_MS });
    return user.id;
  } catch {
    return null;
  }
}

// Returns the authenticated Supabase user id (string) or null. On null it has
// already written the 401 response — the handler should just return.
export async function requireAuth(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, reason: 'auth_required' });
    return null;
  }
  const userId = await verifySupabaseToken(token);
  if (!userId) {
    res.status(401).json({ ok: false, reason: 'invalid_token' });
    return null;
  }
  return userId;
}
