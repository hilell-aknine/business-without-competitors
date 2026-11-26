// The AI side of the practice game (levels 2-3 of pages/game.html).
// Added 2026-11-26.
//
// POST { mode, lessonKey, ... }   Authorization: Bearer <supabase access token>
//
//   mode 'judge'     { task: 0|1|2, history: [{role, content}] }
//       task 0 (explain) / 2 (apply): one learner answer in history.
//         -> { ok, passed, score, max: 6, good, fix, criteria: [{text, score}], remaining }
//       task 1 (roleplay): history starts with the learner's first message
//         (the persona's opening line is the server's, the client only shows it).
//         -> { ok, reply, done: false, turn, limit, remaining }
//         -> { ok, reply, done: true, passed, score, max, good, fix, criteria, remaining }
//   mode 'hint'      { level: 1|2, index: 0-5 }
//         -> { ok, hint, remaining }
//   mode 'surprise'  {}
//         -> { ok, exercises: [4-6], cached, remaining }
//
// Every success is HTTP 200 with ok: true. Every refusal has ok: false and a
// machine `reason`: answer_too_short, answer_too_long, daily_cap,
// game_ai_disabled, judge_parse_failed, surprise_failed, bad_lesson, bad_task,
// bad_mode, bad_exercise, bad_history, history_too_long, empty_history,
// last_message_must_be_user, exercise_over, all_providers_failed.
//
// Auth:  guard (origin + rate limit) + Supabase JWT + per-user daily caps
//        ('game_judge' for judge and surprise, 'game_hint' for hints).
// Off by default: GAME_AI_ENABLED must be "1" (or "true") in the env.
//
// What the server owns: the lesson data (api/_game/index.json), the rubrics
// (api/_game/l3-m<N>.json, never sent whole to the browser), the pass rule,
// the turn count of a role-play and every check on what the model returns.
// The pure parts live in _lib/game-coach-core.js.

import fs from 'node:fs';
import { callAI } from './_lib/providers.js';
import { passesGuard, requireAuth } from './_lib/guard.js';
import { loadKb } from './_lib/kb.js';
import { selectPassages } from './_lib/retrieval.js';
import { consume } from './_lib/quota.js';
import * as core from './_lib/game-coach-core.js';

const MODEL = process.env.GAME_AI_MODEL || 'claude-haiku-5-5';
const PASSAGE_BUDGET = 6000;   // chars of transcript per call
// Hebrew is token-hungry. A verdict is ~120 tokens, a persona line ~150, a
// hint ~80, six exercises ~3,500. Each cap leaves a wide margin; a cut reply
// is still handled (parse failure / salvage).
const MAX_TOKENS = { judge: 700, persona: 400, hint: 300, surprise: 7000 };
// vercel.json gives the function 90s. Leave room to answer.
const DEADLINE_MS = 82000;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hiosnmkszdktirpfzjqi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb3NubWtzemRrdGlycGZ6anFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjkyNzksImV4cCI6MjA5NDAwNTI3OX0.05RyNeLVWLXDMUVBV-C7kq2e0hamg5oQttMiKp8UaMQ';

function enabled() {
  return /^(1|true|yes)$/i.test(String(process.env.GAME_AI_ENABLED || ''));
}

// ------------------------------------------------------------------ data
// Static `new URL(<literal>, import.meta.url)` references: Vercel's file
// tracer follows them, so the files ship with the function even if the
// includeFiles glob in vercel.json were ever dropped.
const INDEX_URL = new URL('./_game/index.json', import.meta.url);
const RUBRIC_URLS = {
  1: new URL('./_game/l3-m1.json', import.meta.url),
  2: new URL('./_game/l3-m2.json', import.meta.url),
  3: new URL('./_game/l3-m3.json', import.meta.url),
  4: new URL('./_game/l3-m4.json', import.meta.url),
  5: new URL('./_game/l3-m5.json', import.meta.url),
  6: new URL('./_game/l3-m6.json', import.meta.url),
  7: new URL('./_game/l3-m7.json', import.meta.url),
  8: new URL('./_game/l3-m8.json', import.meta.url),
};

let indexCache = null;
const rubricCache = new Map();

function readJson(fileUrl) {
  try {
    return JSON.parse(fs.readFileSync(fileUrl, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[game-coach] cannot read ${fileUrl.pathname.split('/').pop()}: ${err.message}`);
    return null;
  }
}

const defaultDeps = {
  callAI,
  consume,
  loadKb,
  loadLesson(lessonKey) {
    if (!indexCache) indexCache = readJson(INDEX_URL) || {};
    return Object.prototype.hasOwnProperty.call(indexCache, lessonKey) ? indexCache[lessonKey] : null;
  },
  // The 3 rubrics of a lesson, or null.
  loadRubrics(lessonKey, moduleId) {
    if (!RUBRIC_URLS[moduleId]) return null;
    if (!rubricCache.has(moduleId)) rubricCache.set(moduleId, readJson(RUBRIC_URLS[moduleId]));
    const file = rubricCache.get(moduleId);
    return file && Array.isArray(file[lessonKey]) ? file[lessonKey] : null;
  },
  random: Math.random,
};

// ------------------------------------------------------------- utilities

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200000) return {};
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
}

// Calls a Supabase RPC with the learner's own JWT. Returns the parsed body,
// or undefined on any failure (the cache is best effort, never fatal).
async function rpc(req, name, args) {
  const token = bearer(req);
  if (!token) return undefined;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.error(`[game-coach] rpc ${name} ${res.status}`);
      return undefined;
    }
    return await res.json();
  } catch (err) {
    console.error(`[game-coach] rpc ${name} failed (${err.message})`);
    return undefined;
  }
}

// Rounds in the shared cache are signed (see core.signRound). Without a
// server secret the cache is off: an unsigned shared cache could be filled
// by any signed-in learner calling the RPC directly.
function cacheSecret() {
  if (/^(0|off|false)$/i.test(String(process.env.GAME_SURPRISE_CACHE || ''))) return null;
  return process.env.GAME_CACHE_SECRET || process.env.KB_SECRET || null;
}

// The transcript passages of the lesson. The query is built from the lesson
// alone, so the same lesson always yields the same text and the cached
// prefix is shared by every learner and every mode.
function lessonPassages(deps, lesson, lessonKey) {
  const doc = deps.loadKb(lessonKey);
  if (doc && doc.text) {
    const query = [
      lesson.title,
      ...lesson.terms.map(t => `${t.term} ${t.definition}`),
      ...lesson.tasks.map(t => t.prompt),
    ].join(' ');
    const picked = selectPassages(String(doc.text), query, PASSAGE_BUDGET);
    return { text: picked.text, fromTranscript: true };
  }
  // No transcript (KB_SECRET missing, file missing): the reading paragraphs
  // of the game are a shorter, already published summary of the same lesson.
  return { text: (lesson.paragraphs || []).join('\n'), fromTranscript: false };
}

function tracker() {
  const calls = [];
  return {
    calls,
    add(purpose, result) {
      calls.push({ purpose, providerUsed: result.providerUsed, model: result.model || null, usage: result.usage || null, stopReason: result.stopReason || null });
    },
    total() {
      const sum = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      for (const c of calls) for (const k of Object.keys(sum)) sum[k] += (c.usage && c.usage[k]) || 0;
      return sum;
    },
  };
}

// One verdict call, with one retry on unparseable output. Returns the parsed
// verdict or null. Nothing here decides pass / fail.
async function askVerdict(ctx, system, userOf, purpose) {
  for (const retry of [false, true]) {
    const result = await ctx.deps.callAI(system, userOf(retry), {
      model: MODEL, maxTokens: MAX_TOKENS.judge, budgetMs: retry ? 25000 : 35000, cachePrefix: ctx.grounding,
    });
    if (!result.text) return { error: 'all_providers_failed' };
    ctx.track.add(retry ? `${purpose}-retry` : purpose, result);
    const verdict = core.parseVerdict(result.text);
    if (verdict) return { verdict };
  }
  return { error: 'judge_parse_failed' };
}

function verdictPayload(verdict, rubric, lesson) {
  const rule = core.passRule(verdict.scores);
  const tidy = (s) => core.stripLecturerNames(core.sanitizeText(core.verifyGuillemets(s, lesson.quotes).text));
  return {
    passed: rule.passed,
    score: rule.score,
    max: rule.max,
    good: tidy(verdict.good),
    fix: tidy(verdict.fix),
    criteria: rubric.criteria.map((text, i) => ({ text, score: verdict.scores[i] })),
  };
}

// ------------------------------------------------------------------ modes

async function judgeOpen(ctx, task, rubric, messages) {
  const answer = messages[messages.length - 1].content;
  if (core.wordCount(answer) < core.LIMITS.MIN_ANSWER_WORDS) {
    return ctx.refuse(400, 'answer_too_short', { min: core.LIMITS.MIN_ANSWER_WORDS });
  }
  if (!(await ctx.spend('game_judge'))) return;
  ctx.ground();
  const r = await askVerdict(ctx, core.judgeSystem(task, rubric), (retry) => core.judgeUser(answer, retry), 'judge');
  if (r.error) return ctx.refuse(r.error === 'judge_parse_failed' ? 502 : 503, r.error);
  ctx.done({ ...verdictPayload(r.verdict, rubric, ctx.lesson) });
}

async function judgeRoleplay(ctx, task, rubric, messages) {
  const limit = core.LIMITS.ROLEPLAY_LIMIT;
  const turn = core.learnerTurns(messages);
  if (turn > limit) return ctx.refuse(409, 'exercise_over', { limit });
  if (!(await ctx.spend('game_judge'))) return;
  ctx.ground();
  const last = turn >= limit;

  // The opening is the server's own text (index.json), never the client's.
  const convo = [{ role: 'user', content: 'מתחילים.' }, { role: 'assistant', content: task.opening }, ...messages.map(m => ({ ...m }))];
  convo[convo.length - 1].content += core.personaNudge(last, core.detectGender(messages));

  // The persona may propose that the talk is over. The server decides: never
  // before the floor, always at the limit.
  // A reply can come back with nothing sayable in it (measured on Haiku 5.5:
  // the end marker alone on the closing turn). One more try, then a neutral
  // line of the server's own, so the learner is never stuck on the last turn.
  let reply = '';
  let proposedEnd = false;
  for (const attempt of [1, 2]) {
    const result = await ctx.deps.callAI(core.personaSystem(task, rubric), convo, {
      model: MODEL, maxTokens: MAX_TOKENS.persona, budgetMs: attempt === 1 ? 35000 : 20000, cachePrefix: ctx.grounding,
    });
    if (!result.text) {
      if (attempt === 1) return ctx.refuse(503, 'all_providers_failed');
      break;
    }
    ctx.track.add(attempt === 1 ? 'persona' : 'persona-retry', result);
    proposedEnd = proposedEnd || core.MARK_END.test(result.text);
    reply = core.cleanPersonaReply(result.text);
    if (reply) break;
  }
  if (!reply) {
    reply = core.PERSONA_FALLBACK;
    ctx.note = 'persona_empty';
  }
  const done = last || (proposedEnd && turn >= core.LIMITS.ROLEPLAY_FLOOR);
  if (!done) return ctx.done({ reply, done: false, turn, limit });

  const full = [...messages, { role: 'assistant', content: reply }];
  const r = await askVerdict(ctx, core.roleplayJudgeSystem(task, rubric),
    (retry) => core.roleplayJudgeUser(task.opening, full, retry), 'roleplay-judge');
  if (r.error) return ctx.refuse(r.error === 'judge_parse_failed' ? 502 : 503, r.error, { reply, turn, limit });
  ctx.done({ reply, done: true, turn, limit, ...verdictPayload(r.verdict, rubric, ctx.lesson) });
}

async function hint(ctx, body) {
  const level = Number(body.level);
  const index = Number(body.index);
  if ((level !== 1 && level !== 2) || !Number.isInteger(index) || index < 0 || index > 5) {
    return ctx.refuse(400, 'bad_exercise');
  }
  // Question and answer come from the server's own copy, never from the client.
  const entry = ctx.lesson.l1.filter(e => e.level === level)[index];
  if (!entry || !entry.question || !entry.answer || !entry.answer.length) return ctx.refuse(400, 'bad_exercise');
  if (!(await ctx.spend('game_hint'))) return;
  ctx.ground();

  const result = await ctx.deps.callAI(core.hintSystem(entry), core.HINT_USER, {
    model: MODEL, maxTokens: MAX_TOKENS.hint, budgetMs: 30000, cachePrefix: ctx.grounding,
  });
  let text = '';
  let source = 'fallback';
  if (result.text) {
    ctx.track.add('hint', result);
    const candidate = core.stripLecturerNames(core.verifyGuillemets(core.cleanHint(result.text), []).text);
    if (candidate && !core.hintLeaks(candidate, entry)) { text = candidate; source = 'model'; }
    else ctx.note = candidate ? 'hint_leaked' : 'hint_empty';
  } else {
    ctx.note = 'no_provider';
  }
  if (!text) text = core.safeHint(ctx.lesson, entry);
  ctx.done({ hint: text }, { hintSource: source });
}

async function surprise(ctx) {
  const { lesson, lessonKey, deps, req } = ctx;
  if (!lesson.quotes || lesson.quotes.length < 3) return ctx.refuse(400, 'bad_lesson');
  const secret = cacheSecret();

  // 1. A cached round, when the lesson already has at least three. It is
  //    served only if its signature holds AND it still passes validation
  //    against today's verified quotes.
  let cachedCount = null;
  if (secret) {
    const got = await rpc(req, 'game_surprise_get', { p_lesson: lessonKey });
    if (got && typeof got === 'object') {
      cachedCount = Number(got.count) || 0;
      if (cachedCount >= 3) {
        const stored = core.verifyRound(got.exercises, lessonKey, secret);
        const checked = stored ? core.validateSurpriseRound(stored, lesson.quotes, lessonKey).valid : [];
        if (checked.length >= core.LIMITS.SURPRISE_MIN) {
          return ctx.done({ exercises: checked, cached: true, remaining: null }, { cachedCount });
        }
        ctx.note = 'cached_round_rejected';
      }
    }
  }

  // 2. Generate. Counts against the judge cap.
  if (!(await ctx.spend('game_judge'))) return;
  ctx.ground();
  const system = core.surpriseSystem(lesson);
  let valid = [];
  let generated = 0;
  const dropped = [];
  for (const attempt of [1, 2]) {
    const left = DEADLINE_MS - (Date.now() - ctx.t0);
    if (attempt === 2 && left < 20000) break;
    const result = await deps.callAI(system, attempt === 1 ? core.SURPRISE_USER : core.SURPRISE_RETRY_USER, {
      model: MODEL, maxTokens: MAX_TOKENS.surprise, budgetMs: Math.min(attempt === 1 ? 50000 : 40000, left - 3000), cachePrefix: ctx.grounding,
    });
    if (!result.text) { if (attempt === 1 && !valid.length) continue; break; }
    ctx.track.add(attempt === 1 ? 'surprise' : 'surprise-retry', result);
    const parsed = core.extractJson(result.text);
    let list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.exercises) ? parsed.exercises : null;
    if (!list) list = core.salvageObjects(result.text);
    generated += list.length;
    const round = core.validateSurpriseRound(list, lesson.quotes, lessonKey, valid);
    valid = round.valid;
    dropped.push(...round.dropped);
    if (valid.length >= core.LIMITS.SURPRISE_MIN) break;
  }
  const extra = { generated, survived: valid.length, dropped };
  if (valid.length < core.LIMITS.SURPRISE_MIN) {
    if (!ctx.track.calls.length) return ctx.refuse(503, 'all_providers_failed');
    return ctx.refuse(502, 'surprise_failed', {}, extra);
  }
  const exercises = valid.map(e => core.shuffleOptions(e, deps.random));

  // 3. Store for the next learner (best effort).
  let stored = false;
  if (secret && cachedCount !== null && cachedCount < 12) {
    stored = (await rpc(req, 'game_surprise_put', { p_lesson: lessonKey, p_exercises: core.signRound(exercises, lessonKey, secret) })) === true;
  }
  ctx.done({ exercises, cached: false }, { ...extra, stored, cachedCount });
}

// ---------------------------------------------------------------- handler

export function createHandler(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, reason: 'method_not_allowed' });
      return;
    }
    if (!passesGuard(req, res)) return;
    const userId = await requireAuth(req, res);
    if (!userId) return;
    if (!enabled()) {
      res.status(503).json({ ok: false, reason: 'game_ai_disabled' });
      return;
    }

    const body = await readJsonBody(req);
    const mode = body.mode;
    const lessonKey = typeof body.lessonKey === 'string' ? body.lessonKey : '';
    const debug = process.env.GAME_AI_DEBUG === '1';
    const t0 = Date.now();
    const track = tracker();
    let remaining = null;
    let quotaSource = '-';

    const ctx = {
      req, deps, lessonKey, t0, track, lesson: null, grounding: null, note: '',
      // Builds the cached prefix. Called only after validation and the cap,
      // so a refused request never decrypts a transcript.
      ground() {
        const passages = lessonPassages(deps, ctx.lesson, lessonKey);
        ctx.transcript = passages.fromTranscript;
        ctx.grounding = core.buildGrounding(ctx.lesson, lessonKey, passages);
      },
      async spend(kind) {
        const quota = await deps.consume(req, userId, kind);
        quotaSource = quota.source;
        if (!quota.ok) {
          ctx.refuse(429, 'daily_cap', { remaining: 0 });
          return false;
        }
        remaining = quota.remaining;
        return true;
      },
      log(outcome) {
        const u = track.total();
        const first = track.calls[0] || {};
        const cut = track.calls.some(c => c.stopReason === 'max_tokens');
        console.log(`[game-coach] ${mode}${mode === 'judge' ? `:task${body.task}` : ''} ${lessonKey || '-'} ${outcome} calls=${track.calls.length} ${first.providerUsed || '-'} ${first.model || ''} in=${u.input} cw=${u.cacheWrite} cr=${u.cacheRead} out=${u.output} ${Date.now() - t0}ms${cut ? ' TRUNCATED' : ''} kb=${ctx.grounding ? (ctx.transcript ? 'transcript' : 'reading') : '-'} quota=${quotaSource}:${remaining ?? '-'}${ctx.note ? ` note=${ctx.note}` : ''}`);
      },
      debugFields(extra) {
        if (!debug) return {};
        const first = track.calls[0] || {};
        return { usage: track.total(), model: first.model || null, providerUsed: first.providerUsed || null, calls: track.calls, ...extra };
      },
      refuse(status, reason, fields = {}, extra = {}) {
        ctx.log(reason);
        res.status(status).json({ ok: false, reason, ...fields, ...ctx.debugFields(extra) });
      },
      done(fields, extra = {}) {
        ctx.log('ok');
        res.status(200).json({ ok: true, remaining, ...fields, ...ctx.debugFields(extra) });
      },
    };

    if (mode !== 'judge' && mode !== 'hint' && mode !== 'surprise') return ctx.refuse(400, 'bad_mode');
    if (!/^m\d-\d-\d$/.test(lessonKey)) return ctx.refuse(400, 'bad_lesson');
    ctx.lesson = deps.loadLesson(lessonKey);
    if (!ctx.lesson) return ctx.refuse(400, 'bad_lesson');

    try {
      if (mode === 'hint') return await hint(ctx, body);
      if (mode === 'surprise') return await surprise(ctx);

      const taskIdx = body.task;
      if (taskIdx !== 0 && taskIdx !== 1 && taskIdx !== 2) return ctx.refuse(400, 'bad_task');
      const task = ctx.lesson.tasks[taskIdx];
      const rubrics = deps.loadRubrics(lessonKey, ctx.lesson.moduleId);
      const rubric = rubrics && rubrics[taskIdx];
      const kind = ['explain', 'roleplay', 'apply'][taskIdx];
      const ready = task && task.kind === kind && task.prompt && rubric && Array.isArray(rubric.criteria) &&
        rubric.criteria.length === 3 && rubric.criteria.every(c => typeof c === 'string' && c.trim()) &&
        (taskIdx !== 1 || (task.persona && task.opening && typeof rubric.stance === 'string' && rubric.stance.trim()));
      if (!ready) return ctx.refuse(400, 'bad_task');

      const h = core.cleanHistory(body.history);
      if (!h.ok) return ctx.refuse(400, h.reason, h.max ? { max: h.max } : {});
      if (taskIdx === 1) return await judgeRoleplay(ctx, task, rubric, h.messages);
      return await judgeOpen(ctx, task, rubric, h.messages);
    } catch (err) {
      console.error(`[game-coach] ${mode} ${lessonKey} crashed: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ ok: false, reason: 'server_error' });
    }
  };
}

export default createHandler();
