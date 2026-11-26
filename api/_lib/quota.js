// Daily per-user caps for paid AI features (sandbox + transcription).
// Added 2026-11-16. The portal runs on Hillel's own keys and the learner pays
// nothing, so every call that costs money is counted per user per day.
//
// Source of truth: the sandbox_consume() RPC (migration 014). It is SECURITY
// DEFINER and counts against auth.uid(), so it is called with the learner's
// own JWT: a learner can only ever add to their own counter, and has no policy
// that lets them reset it.
//
// Fallback: if the RPC is not there yet (migration not run) or Supabase is
// unreachable, an in-process counter caps the instance instead. It resets
// whenever Vercel starts a new instance, so it is a soft cap, logged loudly.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hiosnmkszdktirpfzjqi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb3NubWtzemRrdGlycGZ6anFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjkyNzksImV4cCI6MjA5NDAwNTI3OX0.05RyNeLVWLXDMUVBV-C7kq2e0hamg5oQttMiKp8UaMQ';

export const CAPS = {
  sandbox: Number(process.env.SANDBOX_DAILY_CAP) || 40,
  transcribe: Number(process.env.TRANSCRIBE_DAILY_CAP) || 20,
  // Practice game, levels 2-3 (api/game-coach.js, migration 016).
  game_judge: Number(process.env.GAME_JUDGE_DAILY_CAP) || 30,
  game_hint: Number(process.env.GAME_HINT_DAILY_CAP) || 3,
};

// The game kinds are counted by their own RPC (016), so the game does not
// depend on which of 014 / 016 was run last. Same table, same rules.
const RPC = { game_judge: 'game_consume', game_hint: 'game_consume' };

const memory = new Map(); // `${day}|${userId}|${kind}` -> count

function todayIsrael() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
}

function memoryConsume(userId, kind, cap) {
  const day = todayIsrael();
  if (memory.size > 5000) memory.clear();
  const k = `${day}|${userId}|${kind}`;
  const n = (memory.get(k) || 0) + 1;
  if (n > cap) return -1;
  memory.set(k, n);
  return cap - n;
}

// Returns { ok, remaining, source }. ok=false means the cap is reached.
export async function consume(req, userId, kind) {
  const cap = CAPS[kind];
  const token = bearer(req);
  if (process.env.QUOTA_MODE !== 'memory' && token) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${RPC[kind] || 'sandbox_consume'}`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_kind: kind, p_cap: cap }),
      }).finally(() => clearTimeout(t));
      if (res.ok) {
        const remaining = Number(await res.json());
        if (Number.isFinite(remaining)) {
          return { ok: remaining >= 0, remaining: Math.max(remaining, 0), source: 'db' };
        }
      }
      console.error(`[quota] rpc ${res.status}, falling back to the in-memory cap`);
    } catch (err) {
      console.error(`[quota] rpc failed (${err.message}), falling back to the in-memory cap`);
    }
  }
  const remaining = memoryConsume(userId, kind, cap);
  return { ok: remaining >= 0, remaining: Math.max(remaining, 0), source: 'memory' };
}
