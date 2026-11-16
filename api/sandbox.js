// הסנדבוקס האטומי — five research-based exercises at the end of a module,
// rebuilt for each learner around their own business. Pilot: module 2
// (moduleIdx 1, מנהיגות אטומית). Added 2026-11-16.
//
// Input:  POST {
//   moduleIdx, exercise: 1..5, level: 'light'|'hard',
//   conceptTerm,                 the concept chosen for exercises 1-2
//   profile: { sells, audience, edge, doc?, gender? },   from application_docs or 3 questions
//   weak: [string],              game exercises the learner missed in this module
//   carry: string,               the learner's own words from earlier exercises (4-5)
//   history: [{role, content}]   empty = opening turn
// }
// Output: { ok, reply, done, plan?, sources, turn, limit, remaining }
// Auth:   guard (origin + rate limit) + Supabase JWT + per-user daily cap.
// Off by default: SANDBOX_ENABLED must be "1" (or "true") in the env.
//
// The conversation lives on the client and is sent whole each turn, like
// apply-coach. What the server owns: the prompts, the transcript passages,
// the turn limits and the cap.

import { callAI } from './_lib/providers.js';
import { passesGuard, requireAuth } from './_lib/guard.js';
import { loadKb } from './_lib/kb.js';
import { selectPassages } from './_lib/retrieval.js';
import { lecturerOf } from './_lib/lecturers.js';
import { consume } from './_lib/quota.js';
import { sandboxModule } from './_lib/sandbox-modules.js';
import {
  buildSystem, closingNudge, TURN_LIMITS, QUOTE_RE, MARK_SOURCE, MARK_DONE, MARK_PLAN, MARK_DANGLING,
} from './_lib/sandbox-prompts.js';

const MODEL = process.env.SANDBOX_MODEL || 'claude-haiku-4-5';
// Hebrew is token-hungry (roughly 2.5 chars per token on Haiku). A closing
// feedback turn is ~150 words; 1,000 tokens leaves a wide margin, and a cut
// reply is still handled (dangling marker stripped, close forced by turn count).
const MAX_TOKENS = 1000;
const PASSAGE_BUDGET = 9000;     // chars of transcript per call, all anchors together
const MAX_MSG_CHARS = 4000;      // one learner message
const MAX_HISTORY_MSGS = 30;
const MAX_HISTORY_CHARS = 30000;

function enabled() {
  return /^(1|true|yes)$/i.test(String(process.env.SANDBOX_ENABLED || ''));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    sells: str(p.sells, 400),
    audience: str(p.audience, 400),
    edge: str(p.edge, 400),
    doc: str(p.doc, 2500),
    gender: p.gender === 'f' ? 'f' : 'm',
  };
  return out.sells || out.audience || out.edge || out.doc ? out : null;
}

function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  const msgs = h
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_MSGS)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
  // Newest kept within the total budget.
  const out = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    used += msgs[i].content.length;
    if (used > MAX_HISTORY_CHARS) break;
    out.unshift(msgs[i]);
  }
  // Anthropic needs the first message to be the user's.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function gatherPassages(mod, keys, query) {
  const uniq = [...new Set(keys)].filter(Boolean);
  const per = Math.max(2500, Math.floor(PASSAGE_BUDGET / Math.max(uniq.length, 1)));
  const out = [];
  for (const key of uniq) {
    const doc = loadKb(key);
    if (!doc || !doc.text) continue;
    const picked = selectPassages(String(doc.text), query, per);
    const title = (mod.lessons.find(l => l.key === key) || {}).title || doc.title || key;
    const who = lecturerOf(key);
    out.push({
      key, title, text: picked.text,
      lecturer: who.lecturer && !who.with ? who.lecturer : null,
      quotes: (mod.quotes && mod.quotes[key]) || [],
    });
  }
  return out;
}

// Every «...» in the reply must be (part of) a verified quote of a lesson we
// supplied. Verified: kept, and that lesson is credited as a source. Not
// verified: the guillemets are removed, so the UI never shows a made-up line
// as the lecturer's words. Attribution comes from proof, not from the
// model's own claim (a self-reported source tag over-attributes, see
// hindsight 2026-08-10).
const norm = s => String(s).replace(/[֑-ׇ]/g, '').replace(/[^א-תa-z0-9 ]+/gi, ' ').replace(/\s+/g, ' ').trim();

function verifyQuotes(text, passages) {
  const bank = [];
  for (const p of passages) for (const q of p.quotes || []) bank.push({ key: p.key, title: p.title, n: norm(q) });
  const sources = [];
  let verified = 0, dropped = 0;
  const out = String(text).replace(QUOTE_RE, (all, inner) => {
    const n = norm(inner);
    const hit = n.split(' ').length >= 4 &&
      bank.find(b => b.n.includes(n) || (n.includes(b.n) && n.length - b.n.length < 25));
    if (!hit) { dropped++; return inner; }
    verified++;
    if (!sources.some(s => s.key === hit.key)) sources.push({ key: hit.key, title: hit.title });
    return '«' + inner.trim() + '»';
  });
  return { text: out, sources, verified, dropped };
}

function cleanReply(text) {
  return String(text || '')
    .replace(MARK_SOURCE, '')
    .replace(new RegExp(MARK_DONE.source, 'g'), '')
    .replace(new RegExp(MARK_PLAN.source, 'g'), '')
    .replace(MARK_DANGLING, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
    res.status(503).json({ ok: false, reason: 'sandbox_disabled' });
    return;
  }

  const body = await readJsonBody(req);
  const moduleIdx = Number(body.moduleIdx);
  const ex = Number(body.exercise);
  const level = body.level === 'hard' ? 'hard' : 'light';
  const mod = sandboxModule(moduleIdx);
  if (!mod) {
    res.status(400).json({ ok: false, reason: 'module_not_ready' });
    return;
  }
  if (!Number.isInteger(ex) || ex < 1 || ex > 5) {
    res.status(400).json({ ok: false, reason: 'bad_exercise' });
    return;
  }

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const newest = rawHistory[rawHistory.length - 1];
  if (newest && newest.role === 'user' && typeof newest.content === 'string' && newest.content.length > MAX_MSG_CHARS) {
    res.status(400).json({ ok: false, reason: 'answer_too_long', max: MAX_MSG_CHARS });
    return;
  }
  const history = cleanHistory(rawHistory);
  const opening = history.length === 0;
  if (!opening && history[history.length - 1].role !== 'user') {
    res.status(400).json({ ok: false, reason: 'last_message_must_be_user' });
    return;
  }

  const profile = cleanProfile(body.profile);
  const weak = Array.isArray(body.weak) ? body.weak.map(w => str(w, 300)).filter(Boolean).slice(0, 6) : [];
  const carry = str(body.carry, 3000);
  const conceptTerm = str(body.conceptTerm, 80);
  const concept = mod.concepts.find(c => c.term === conceptTerm) ||
    mod.concepts.find(c => c.term === mod.coreTerms[0]);

  const userTurns = history.filter(m => m.role === 'user').length;
  const limit = TURN_LIMITS[ex][level];
  if (userTurns > limit + 1) {
    res.status(409).json({ ok: false, reason: 'exercise_over' });
    return;
  }
  const closing = userTurns >= limit;

  const quota = await consume(req, userId, 'sandbox');
  if (!quota.ok) {
    res.status(429).json({ ok: false, reason: 'daily_cap', remaining: 0 });
    return;
  }

  const exCfg = mod.exercises[ex];
  const anchors = ex === 1 ? [concept.lessonKey]
    : ex === 2 ? [concept.lessonKey, ...exCfg.anchors]
    : exCfg.anchors;
  const query = [concept.term, concept.def, profile && profile.sells, profile && profile.audience, carry]
    .filter(Boolean).join(' ');
  const passages = gatherPassages(mod, anchors, query);
  if (!passages.length) {
    res.status(500).json({ ok: false, reason: 'kb_read_failed' });
    return;
  }

  const { stable, volatile } = buildSystem({
    ex, level, profile, weak, concept, carry, passages, closing, opening,
    lecturers: passages.map(p => p.lecturer),
    moduleTitle: mod.title,
    exercise: exCfg,
  });
  const messages = opening ? [{ role: 'user', content: 'מתחילים.' }] : history.map(m => ({ ...m }));
  if (closing && !opening) messages[messages.length - 1].content += closingNudge(ex);

  const t0 = Date.now();
  const result = await callAI(volatile, messages, { model: MODEL, maxTokens: MAX_TOKENS, budgetMs: 60000, cachePrefix: stable });
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }

  const raw = result.text;
  const truncated = result.stopReason === 'max_tokens';
  let plan = null;
  // Approval: the marker, or (measured on Haiku 4.5) the same words as plain
  // text at the start of a line. The plan saved is always the learner's own
  // most recent full if-then sentence, never the model's rewording of it.
  if (ex === 5 && (MARK_PLAN.test(raw) || /(^|\n)\s*\**\s*תוכנית מאושרת/.test(raw))) {
    const own = [...history].reverse().find(m =>
      m.role === 'user' && /(^|\s)אם\s/.test(m.content) && /(^|[\s,])אז(\s|$)/.test(m.content));
    if (own) plan = own.content.trim().slice(0, 500);
  }
  // When is an exercise over?
  //  - when the model says so, except: the skeptic may not break character
  //    before 5 (light) / 6 (hard) learner messages, and if-then is over only
  //    with a plan
  //  - at the turn limit, even if the model forgot the marker, so a learner
  //    is never stuck. If-then gets one extra turn to write the sentence,
  //    then closes regardless.
  let done = MARK_DONE.test(raw);
  // Floors, measured: Haiku 5.5 closed "teach me" after a single answer.
  const minTurns = { 1: 3, 2: 2, 3: level === 'hard' ? 6 : 5, 4: 3, 5: 1 }[ex];
  if (userTurns < minTurns) done = false;
  if (ex === 5) done = !!plan || userTurns > limit;
  else if (closing && !opening) done = true;
  const q = verifyQuotes(cleanReply(raw), passages);

  console.log(`[sandbox] ex${ex} ${level} turn${userTurns}/${limit} ${result.providerUsed} ${result.model || ''} in=${result.usage?.input ?? '?'} cw=${result.usage?.cacheWrite ?? 0} cr=${result.usage?.cacheRead ?? 0} out=${result.usage?.output ?? '?'} ${Date.now() - t0}ms${truncated ? ' TRUNCATED' : ''} quotes=${q.verified}ok/${q.dropped}dropped quota=${quota.source}:${quota.remaining}`);

  res.status(200).json({
    ok: true,
    reply: q.text,
    done,
    ...(plan ? { plan } : {}),
    sources: q.sources,
    turn: userTurns,
    limit,
    remaining: quota.remaining,
    truncated,
    ...(process.env.SANDBOX_DEBUG === '1' ? { usage: result.usage, model: result.model, providerUsed: result.providerUsed } : {}),
  });
}
