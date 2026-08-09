/* ==============================================================
   practice.js — Duolingo-style practice game engine
   עסק ללא מתחרים · Vanilla JS, no libraries, no build step

   Layers, top to bottom:
     1. Supabase sync (unchanged contract — practice_stats)
     2. Storage + derived progress helpers
     3. PATH MODEL   — units (modules) → nodes (lessons + unit boss)
     4. PATH VIEW    — the winding map with locks
     5. SESSION      — short rounds, hearts, combo, mistake replay
     6. RENDERERS    — match / order / cloze / goodbad (content untouched)
     7. FX           — sound (WebAudio), haptics, XP pops, flashes
     8. SUMMARY / FAIL screens

   Challenge ids (m0-match-1 …) and the localStorage shape are preserved,
   so existing learner progress keeps working and keeps syncing.
   ============================================================== */

'use strict';

/* ================================================================
   CONSTANTS
   ================================================================ */
const STORAGE_KEY  = 'bwc_practice_v1';
const SOUND_KEY    = 'bwc_practice_sound';

const MAX_HEARTS   = 5;      // hearts per round
const LESSON_SIZE  = 6;      // max challenges in a lesson node
const BOSS_SIZE    = 7;      // challenges in the unit-review (boss) node
const MASTERY      = 80;     // accuracy % that counts a challenge as solved
const MAX_ATTEMPTS = 2;      // how many times a missed challenge comes back

/* ================================================================
   1. SUPABASE SYNC LAYER
   Authenticated users: Supabase is source-of-truth.
   Guests: localStorage only (no change to existing behavior).
   All Supabase operations are fire-and-forget — never block the UI.
   ================================================================ */

/**
 * Convert a localStorage data object to a Supabase practice_stats row.
 * Column mapping:
 *   xp        → total_xp
 *   streak    → current_streak   (longest_streak = max of current and existing)
 *   lastDate  → last_practice_date
 *   completed → challenges_completed
 */
function localToSupabase(userId, data) {
  return {
    user_id:              userId,
    total_xp:             data.xp || 0,
    current_streak:       data.streak || 0,
    last_practice_date:   data.lastDate || null,
    challenges_completed: data.completed || {},
    updated_at:           new Date().toISOString()
  };
}

/** Convert a Supabase practice_stats row to the localStorage shape. */
function supabaseToLocal(row) {
  return {
    xp:       row.total_xp || 0,
    streak:   row.current_streak || 0,
    lastDate: row.last_practice_date || null,
    completed: row.challenges_completed || {}
  };
}

/**
 * Merge localStorage data and Supabase row data, taking the best of each:
 * XP max · streak max · most recent lastDate · union of completed (best accuracy).
 */
function mergeData(local, remote) {
  const merged = {
    xp:       Math.max(local.xp || 0, remote.xp || 0),
    streak:   Math.max(local.streak || 0, remote.streak || 0),
    lastDate: null,
    completed: {}
  };

  if (local.lastDate && remote.lastDate) {
    merged.lastDate = local.lastDate >= remote.lastDate ? local.lastDate : remote.lastDate;
  } else {
    merged.lastDate = local.lastDate || remote.lastDate || null;
  }

  const allKeys = new Set([
    ...Object.keys(local.completed || {}),
    ...Object.keys(remote.completed || {})
  ]);
  allKeys.forEach(k => {
    const lv = (local.completed || {})[k];
    const rv = (remote.completed || {})[k];
    if (lv === undefined) merged.completed[k] = rv;
    else if (rv === undefined) merged.completed[k] = lv;
    else merged.completed[k] = Math.max(lv, rv);
  });

  return merged;
}

/**
 * Fetch the user's row from Supabase, merge with localStorage, save merged
 * back to localStorage, and push the merge up. Non-blocking; errors logged.
 */
async function syncFromSupabase() {
  try {
    const user = window.bwcAuth && window.bwcAuth.getUser();
    if (!user) return; // guest — nothing to sync

    const supabase = window.bwcSupabase;
    if (!supabase) return;

    const { data: rows, error } = await supabase
      .from('practice_stats')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('[practice] Supabase fetch error:', error.message);
      return;
    }

    const local = loadData();

    let merged;
    if (rows) {
      const remote = supabaseToLocal(rows);
      merged = mergeData(local, remote);
      // Keep local-only fields that practice_stats does not carry.
      // (dailyPlay = the 15-min cap; weekly = the league bucket, which has
      //  its own table and must not be clobbered by a stats merge.)
      merged.dailyPlay = local.dailyPlay || null;
      merged.weekly    = local.weekly || null;
    } else {
      merged = local;
    }

    saveDataLocal(merged);
    upsertToSupabase(user.id, merged);
  } catch (err) {
    console.warn('[practice] syncFromSupabase error:', err);
  }
}

/**
 * Fire-and-forget upsert of data to Supabase practice_stats.
 * Computes longest_streak as max(current_streak, existing longest_streak).
 */
async function upsertToSupabase(userId, data) {
  try {
    const supabase = window.bwcSupabase;
    if (!supabase) return;

    let longestStreak = data.streak || 0;
    const { data: existing } = await supabase
      .from('practice_stats')
      .select('longest_streak')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing && existing.longest_streak > longestStreak) {
      longestStreak = existing.longest_streak;
    }

    const row = localToSupabase(userId, data);
    row.longest_streak = longestStreak;

    const { error } = await supabase
      .from('practice_stats')
      .upsert(row, { onConflict: 'user_id' });

    if (error) console.warn('[practice] Supabase upsert error:', error.message);
  } catch (err) {
    console.warn('[practice] upsertToSupabase error:', err);
  }
}

/* ================================================================
   UTILITIES
   ================================================================ */

/** Return today's date string (YYYY-MM-DD) in Asia/Jerusalem timezone. */
function todayJerusalem() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

/** Return yesterday's date string (YYYY-MM-DD) in Asia/Jerusalem timezone. */
function yesterdayJerusalem() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

/** Shuffle an array in-place (Fisher-Yates). Returns the array. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deep clone a value via JSON. */
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/** Format seconds as mm:ss. */
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Escape HTML to prevent injection in dynamic content. */
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** True when the visitor asked for reduced motion. */
function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ================================================================
   2. STORAGE
   ================================================================ */

/** Load persistent practice data from localStorage. */
function loadData() {
  const defaults = { xp: 0, streak: 0, lastDate: null, completed: {}, dailyPlay: null, weekly: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return Object.assign({}, defaults, parsed);
  } catch (_) {
    return defaults;
  }
}

/** Save to localStorage only (internal helper). */
function saveDataLocal(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

/**
 * Save practice data. Always writes localStorage synchronously; when the user
 * is authenticated it also fire-and-forgets an upsert to Supabase.
 */
function saveData(data) {
  saveDataLocal(data);
  const user = window.bwcAuth && window.bwcAuth.getUser();
  if (user) upsertToSupabase(user.id, data);
}

/**
 * Update streak on session end.
 * lastDate === today → no change · === yesterday → +1 · otherwise → reset to 1.
 */
function updateStreak(data) {
  const today = todayJerusalem();
  const yesterday = yesterdayJerusalem();
  let changed = false;
  let isNew = false;

  if (data.lastDate === today) {
    // Already practiced today — no change
  } else if (data.lastDate === yesterday) {
    data.streak = (data.streak || 0) + 1;
    data.lastDate = today;
    changed = true;
  } else {
    isNew = !data.lastDate;
    data.streak = 1;
    data.lastDate = today;
    changed = true;
  }
  return { streak: data.streak, changed, isNew };
}

/* ---- Daily practice cap (Project-100 principle) ----
   15 minutes a day, on purpose: consistency beats bingeing. Enforced when
   STARTING a round; a running round is never cut off mid-challenge. */
const DAILY_CAP_SECONDS = 15 * 60;

function dailyPlaySeconds(data) {
  const today = todayJerusalem();
  if (!data.dailyPlay || data.dailyPlay.date !== today) return 0;
  return data.dailyPlay.seconds || 0;
}

function addDailyPlay(data, seconds) {
  const today = todayJerusalem();
  if (!data.dailyPlay || data.dailyPlay.date !== today) {
    data.dailyPlay = { date: today, seconds: 0 };
  }
  data.dailyPlay.seconds += Math.max(0, Math.round(seconds));
}

/* ================================================================
   3. PATH MODEL
   Units = the 8 course modules. Each unit is split into short lesson
   nodes plus one "unit challenge" (boss) node.

   Node completion is DERIVED from data.completed (per-challenge best
   accuracy) — no new persisted state, so it survives Supabase sync and
   existing learner progress unlocks the path automatically.
   ================================================================ */

/** Type rotation used to interleave challenge types inside a node. */
const TYPE_ORDER = ['match', 'cloze', 'order', 'goodbad'];

/**
 * Deterministic, interleaved ordering of a module's challenges.
 * Round-robins across types so every node holds a varied mix.
 */
function moduleChallenges(moduleIdx) {
  const all = (window.PRACTICE_CHALLENGES || []).filter(c => c.moduleIdx === moduleIdx);
  const buckets = {};
  TYPE_ORDER.forEach(t => { buckets[t] = []; });
  all.forEach(c => {
    if (!buckets[c.type]) buckets[c.type] = [];
    buckets[c.type].push(c);
  });
  Object.keys(buckets).forEach(t => buckets[t].sort((a, b) => a.id.localeCompare(b.id)));

  const ordered = [];
  const keys = TYPE_ORDER.concat(Object.keys(buckets).filter(k => TYPE_ORDER.indexOf(k) === -1));
  let added = true;
  let round = 0;
  while (added) {
    added = false;
    keys.forEach(t => {
      const item = (buckets[t] || [])[round];
      if (item) { ordered.push(item); added = true; }
    });
    round++;
  }
  return ordered;
}

/** Split an array into balanced chunks of at most `size`. */
function chunkBalanced(arr, size) {
  if (arr.length === 0) return [];
  const count = Math.max(1, Math.ceil(arr.length / size));
  const per   = Math.ceil(arr.length / count);
  const out = [];
  for (let i = 0; i < arr.length; i += per) out.push(arr.slice(i, i + per));
  return out;
}

/**
 * Build the whole path: [{ moduleIdx, module, nodes: [...] }, …]
 * Node: { id, unitIdx, nodeIdx, flatIdx, kind:'lesson'|'boss', title, challenges }
 */
function buildPath() {
  const units = [];
  let flat = 0;

  (window.MODULES || []).forEach((mod, mi) => {
    const list = moduleChallenges(mi);
    if (list.length === 0) return; // module has no content yet — skip entirely

    const chunks = chunkBalanced(list, LESSON_SIZE);
    const nodes = chunks.map((chunk, ni) => ({
      id:         `m${mi}-n${ni}`,
      unitIdx:    mi,
      nodeIdx:    ni,
      flatIdx:    flat++,
      kind:       'lesson',
      title:      `שיעור ${ni + 1}`,
      challenges: chunk
    }));

    // Unit boss — only worth showing when the unit has enough material
    if (list.length >= 4) {
      nodes.push({
        id:         `m${mi}-boss`,
        unitIdx:    mi,
        nodeIdx:    nodes.length,
        flatIdx:    flat++,
        kind:       'boss',
        title:      'אתגר היחידה',
        challenges: list.slice() // drawn from at session start
      });
    }

    units.push({ moduleIdx: mi, module: mod, nodes });
  });

  return units;
}

/** All nodes, in walking order. */
function flatNodes(units) {
  return units.reduce((acc, u) => acc.concat(u.nodes), []);
}

/** A challenge counts as solved once its best accuracy reaches MASTERY. */
function isSolved(data, id) {
  return (data.completed[id] || 0) >= MASTERY;
}

/** Lesson node is done when every challenge in it is solved. */
function isNodeDone(node, data) {
  if (node.kind === 'boss') {
    // Boss is crowned only when the entire unit is solved
    return node.challenges.every(c => isSolved(data, c.id));
  }
  return node.challenges.every(c => isSolved(data, c.id));
}

/** How many of a node's challenges are already solved. */
function nodeSolvedCount(node, data) {
  return node.challenges.filter(c => isSolved(data, c.id)).length;
}

/**
 * Unlock rule (Duolingo-style, with a grace clause so nobody gets re-locked):
 *   • the first node is always open
 *   • a node opens once the previous node is done
 *   • LEGACY GRACE: a unit the learner already touched stays open, so
 *     progress recorded before the path existed is never taken away.
 */
function isNodeUnlocked(node, all, data) {
  if (node.flatIdx === 0) return true;
  const prev = all[node.flatIdx - 1];
  if (prev && isNodeDone(prev, data)) return true;
  if (unitTouched(node.unitIdx, data)) return true;
  return false;
}

/** True when the learner has any recorded attempt inside this unit. */
function unitTouched(moduleIdx, data) {
  return (window.PRACTICE_CHALLENGES || [])
    .some(c => c.moduleIdx === moduleIdx && data.completed[c.id] !== undefined);
}

/* ================================================================
   3b. LESSON MODE — a round scoped to a single lesson
   ------------------------------------------------------------
   Added 2026-08-09 for the "תרגול" tab inside the lesson player.
   It is a thin entry point on top of the SAME engine: same node
   shape, same startNode(), same challenge ids, same storage.
   Nothing about pages/practice.html standalone changes — lesson
   mode only turns on when the URL carries ?lesson=<lessonKey>.
   ================================================================ */

/** Challenges whose source lesson is exactly this one. */
function lessonChallenges(lessonKey) {
  return (window.PRACTICE_CHALLENGES || []).filter(c => c.sourceLessonKey === lessonKey);
}

/**
 * Wrap a lesson's challenges in a normal node so startNode() can run
 * them unchanged. flatIdx is -1 — this node never joins the path map.
 */
function buildLessonNode(lessonKey) {
  const list = lessonChallenges(lessonKey);
  if (list.length === 0) return null;

  // Same type interleave as the path nodes, so a round feels varied.
  const buckets = {};
  list.forEach(c => { (buckets[c.type] = buckets[c.type] || []).push(c); });
  Object.keys(buckets).forEach(t => buckets[t].sort((a, b) => a.id.localeCompare(b.id)));
  const keys = TYPE_ORDER.concat(Object.keys(buckets).filter(k => TYPE_ORDER.indexOf(k) === -1));
  const ordered = [];
  let round = 0, added = true;
  while (added) {
    added = false;
    keys.forEach(t => {
      const item = (buckets[t] || [])[round];
      if (item) { ordered.push(item); added = true; }
    });
    round++;
  }

  return {
    id:         'lesson-' + lessonKey,
    unitIdx:    ordered[0].moduleIdx,
    nodeIdx:    0,
    flatIdx:    -1,
    kind:       'lesson',
    title:      'תרגול השיעור',
    lessonKey:  lessonKey,
    challenges: ordered
  };
}

/** Intro / empty screen shown in lesson mode instead of the path map. */
function renderLessonMenu() {
  const wrap = document.getElementById('view-menu');
  if (!wrap) return;

  const key  = state.lessonMode;
  const node = state.lessonNode;
  const data = loadData();

  if (!node) {
    // Not every lesson has challenges yet. Say exactly that — no invented
    // reason — and hand the learner somewhere that does have practice.
    const isSeminar = /^s\d/.test(key || '');
    const text = isSeminar
      ? 'האתגרים בנויים סביב שיעורי המודולים, ולסמינרים עדיין לא נבנו אתגרים. התרגול של המודולים פתוח ומחכה.'
      : 'עדיין לא נבנו אתגרים לשיעור הזה. התרגול של שאר השיעורים במודול פתוח ומחכה.';
    wrap.innerHTML = `
      <div class="lp-intro">
        <div class="lp-intro__icon" aria-hidden="true"><i class="fa-solid fa-seedling"></i></div>
        <h2 class="lp-intro__title">לשיעור הזה עוד אין תרגול</h2>
        <p class="lp-intro__text">${text}</p>
        <div class="lp-intro__actions">
          <a class="lp-intro__link" href="practice.html" target="_top">
            <i class="fa-solid fa-map" aria-hidden="true"></i> למפת התרגול המלאה
          </a>
        </div>
      </div>`;
    return;
  }

  const total  = node.challenges.length;
  const solved = node.challenges.filter(c => isSolved(data, c.id)).length;
  const done   = solved === total;

  wrap.innerHTML = `
    <div class="lp-intro">
      <div class="lp-intro__icon" aria-hidden="true">
        <i class="fa-solid ${done ? 'fa-circle-check' : 'fa-gamepad'}"></i>
      </div>
      <h2 class="lp-intro__title">${done ? 'שלטתם בשיעור הזה' : 'תרגול על השיעור הזה'}</h2>
      <p class="lp-intro__text">
        ${done
          ? 'כל האתגרים של השיעור נפתרו. אפשר לרוץ עליהם שוב כדי לרענן — ההתקדמות שכבר נצברה נשמרת.'
          : 'האתגרים כאן נשלפים ישירות מהתמלול של השיעור שאתם צופים בו. חמישה לבבות, פידבק עם ציטוט מהשיעור, וכל טעות חוזרת בסוף הסבב.'}
      </p>
      <div class="lp-intro__meta">
        <span class="lp-intro__chip"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> ${total} אתגרים</span>
        <span class="lp-intro__chip"><i class="fa-solid fa-check" aria-hidden="true"></i> ${solved} נפתרו</span>
        <span class="lp-intro__chip"><i class="fa-solid fa-bolt" aria-hidden="true"></i> ${data.xp || 0} XP</span>
      </div>
      <div class="lp-intro__actions">
        <button type="button" class="btn-check btn-check--ready" id="lp-start">
          ${done ? 'תרגלו שוב' : 'התחילו תרגול'}
        </button>
        <a class="lp-intro__link" href="practice.html" target="_top">
          <i class="fa-solid fa-map" aria-hidden="true"></i> למפת התרגול המלאה
        </a>
      </div>
    </div>`;

  const btn = document.getElementById('lp-start');
  if (btn) btn.addEventListener('click', () => window.BwcPractice.startLessonRound(key));
}

/* ================================================================
   4. SESSION STATE
   ================================================================ */

const state = {
  view: 'menu',          // 'menu' | 'play' | 'done' | 'fail'
  lessonMode: null,      // lessonKey when embedded in the lesson player
  lessonNode: null,      // the ad-hoc node built from that lesson
  units: [],
  allNodes: [],
  node: null,            // node currently being played
  queue: [],             // [{ ch, review, attempts }]
  qi: 0,
  hearts: MAX_HEARTS,
  combo: 0,
  maxCombo: 0,
  sessionXP: 0,
  uniqueTotal: 0,        // challenges required to finish the round
  solved: null,          // Set of ids solved this round
  firstTry: 0,           // solved on the first attempt (that's the real accuracy)
  mistakes: [],          // challenge objects missed at least once
  startTime: null,
  active: null           // per-challenge interaction state
};

/* ================================================================
   INITIALIZATION
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  init();

  document.getElementById('exitBtn')?.addEventListener('click', () => window.requestExit());
  document.getElementById('confirmExitBtn')?.addEventListener('click', () => window.confirmExit());
  document.getElementById('cancelExitBtn')?.addEventListener('click', () => window.cancelExit());
  document.getElementById('sound-toggle')?.addEventListener('click', toggleSound);
  syncSoundButton();

  // Background: wait for auth, then pull Supabase data and silently refresh.
  const authReady = (window.bwcAuth && typeof window.bwcAuth.ready === 'function')
    ? window.bwcAuth.ready()
    : Promise.resolve();

  authReady
    .then(async () => {
      if (window.bwcAuth && window.bwcAuth.getUser()) {
        await syncFromSupabase();
        if (state.view === 'menu') renderMenu();
      }

      if (window.bwcAuth && typeof window.bwcAuth.onChange === 'function') {
        let previousUserId = window.bwcAuth.getUser() ? window.bwcAuth.getUser().id : null;
        window.bwcAuth.onChange(async (user) => {
          if (user && user.id !== previousUserId) {
            previousUserId = user.id;
            await syncFromSupabase();
            if (state.view === 'menu') renderMenu();
          } else if (!user) {
            previousUserId = null;
          }
        });
      }
    })
    .catch(err => {
      console.warn('[practice] Auth ready error, staying in guest mode:', err);
    });
});

function init() {
  const challenges = window.PRACTICE_CHALLENGES;
  if (!challenges || !Array.isArray(challenges) || challenges.length === 0) {
    showView('menu');
    renderMenuEmpty();
    return;
  }
  state.units    = buildPath();
  state.allNodes = flatNodes(state.units);

  // ?lesson=<key> → the round is scoped to one lesson (the "תרגול" tab).
  // Everything below this line is identical to the standalone page.
  const lessonKey = new URLSearchParams(window.location.search).get('lesson');
  if (lessonKey) {
    state.lessonMode = lessonKey;
    state.lessonNode = buildLessonNode(lessonKey);
    document.body.classList.add('prac-lesson-mode');
  }

  renderMenu();
  showView('menu');
}

/* ================================================================
   VIEW SWITCHING
   ================================================================ */

function showView(name) {
  state.view = name;
  ['menu', 'play', 'done', 'fail'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('prac-view--active', v === name);
  });
  document.getElementById('combo-badge')?.classList.remove('prac-combo--show');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ================================================================
   5. PATH VIEW  (menu)
   ================================================================ */

/* Per-unit jewel tones — keeps the Duolingo "each unit has a colour"
   read while staying inside the petrol/gold/aqua brand family. */
const UNIT_COLORS = [
  ['#2f8592', '#0e3b43', 'rgba(0,0,0,.4)'],
  ['#c9922f', '#7c5817', 'rgba(0,0,0,.4)'],
  ['#3d9070', '#12442f', 'rgba(0,0,0,.4)'],
  ['#7f6ac4', '#332a5e', 'rgba(0,0,0,.4)'],
  ['#c07044', '#63301a', 'rgba(0,0,0,.4)'],
  ['#3179a8', '#123a55', 'rgba(0,0,0,.4)'],
  ['#ab5273', '#4f2033', 'rgba(0,0,0,.4)'],
  ['#6d963a', '#324715', 'rgba(0,0,0,.4)']
];

/* Zig-zag offsets, continuing across unit boundaries. */
const PATH_OFFSETS = [0, 44, 66, 44, 0, -44, -66, -44];

function renderMenuEmpty() {
  const wrap = document.getElementById('view-menu');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="prac-empty">
      <div class="prac-empty__icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
      <div class="prac-empty__title">אתגרים בהכנה — נחזור בקרוב</div>
      <div class="prac-empty__sub">קבצי האתגרים טוענים. נסה לרענן את הדף.</div>
    </div>
  `;
  wrap.classList.add('prac-view--active');
}

function renderMenu() {
  // Lesson mode replaces the path map with a compact intro card for the
  // single lesson. Everything else (round, hearts, feedback, summary) is
  // the same engine, untouched.
  if (state.lessonMode) { renderLessonMenu(); return; }

  const data = loadData();

  // Stats bar
  const xpEl     = document.getElementById('stat-xp');
  const streakEl = document.getElementById('stat-streak');
  const lastEl   = document.getElementById('stat-last');
  if (xpEl)     xpEl.textContent     = data.xp || 0;
  if (streakEl) streakEl.textContent = data.streak || 0;
  if (lastEl) {
    const solvedTotal = (window.PRACTICE_CHALLENGES || []).filter(c => isSolved(data, c.id)).length;
    const total = (window.PRACTICE_CHALLENGES || []).length || 1;
    lastEl.textContent = Math.round((solvedTotal / total) * 100) + '%';
  }

  renderPath(data);

  // Motivation layer (three axes + weekly league). Async, never blocks paint,
  // and silently falls back to local goals when Supabase or migration 007
  // is not available.
  if (window.bwcLeague) window.bwcLeague.render();
}

function renderPath(data) {
  const root = document.getElementById('path-root');
  if (!root) return;

  // Which node is "current"? First unlocked-and-unfinished node.
  const current = state.allNodes.find(n => isNodeUnlocked(n, state.allNodes, data) && !isNodeDone(n, data));
  const currentId = current ? current.id : null;

  root.innerHTML = state.units.map(unit => {
    const colors = UNIT_COLORS[unit.moduleIdx % UNIT_COLORS.length];
    const doneCount = unit.nodes.filter(n => isNodeDone(n, data)).length;
    const unitLocked = unit.nodes.every(n => !isNodeUnlocked(n, state.allNodes, data));

    const nodesHtml = unit.nodes.map(node => {
      const done     = isNodeDone(node, data);
      const unlocked = isNodeUnlocked(node, state.allNodes, data);
      const isCurr   = node.id === currentId;
      const off      = PATH_OFFSETS[node.flatIdx % PATH_OFFSETS.length];
      const solved   = nodeSolvedCount(node, data);
      const totalCh  = node.kind === 'boss' ? BOSS_SIZE : node.challenges.length;

      let cls = 'node';
      if (node.kind === 'boss') cls += ' node--boss';
      if (!unlocked)      cls += ' node--locked';
      else if (done)      cls += ' node--done';
      else                cls += ' node--open';
      if (isCurr)         cls += ' node--current';

      let icon;
      if (!unlocked)                 icon = 'fa-lock';
      else if (node.kind === 'boss') icon = done ? 'fa-crown' : 'fa-trophy';
      else                           icon = done ? 'fa-check' : 'fa-star';

      const label = node.kind === 'boss'
        ? (done ? 'היחידה הושלמה' : `${node.title} · ${totalCh} אתגרים`)
        : (done ? `${node.title} · הושלם` : `${node.title} · ${solved}/${node.challenges.length}`);

      const aria = `${unit.module.title} — ${node.title}` +
                   (unlocked ? (done ? ' (הושלם)' : '') : ' (נעול)');

      return `
        <div class="node-row ${done ? 'node-row--done' : ''} ${isCurr ? 'node-row--current' : ''}"
             style="--off:${off}px">
          ${isCurr ? `<span class="node-bubble">${done ? 'תרגל שוב' : 'התחל'}</span>` : ''}
          <button type="button" class="${cls}"
                  data-node="${node.id}"
                  ${unlocked ? '' : 'aria-disabled="true"'}
                  aria-label="${escHtml(aria)}">
            <i class="fa-solid ${icon}" aria-hidden="true"></i>
          </button>
          <div class="node-row__label">${escHtml(label)}</div>
        </div>`;
    }).join('');

    return `
      <section class="unit ${unitLocked ? 'unit--locked' : ''}"
               style="--unit-c1:${colors[0]};--unit-c2:${colors[1]};--unit-shadow:${colors[2]}"
               aria-label="יחידה ${unit.moduleIdx + 1}: ${escHtml(unit.module.title)}">
        <div class="unit__banner">
          <div class="unit__banner-icon"><i class="fa-solid ${unit.module.icon || 'fa-dumbbell'}" aria-hidden="true"></i></div>
          <div class="unit__banner-text">
            <div class="unit__banner-eyebrow">יחידה ${unit.moduleIdx + 1}</div>
            <h2 class="unit__banner-title">${escHtml(unit.module.title)}</h2>
          </div>
          <div class="unit__banner-count">${doneCount}/${unit.nodes.length}</div>
        </div>
        <div class="unit__nodes">${nodesHtml}</div>
      </section>`;
  }).join('');

  // Wire node clicks
  root.querySelectorAll('.node').forEach(btn => {
    btn.addEventListener('click', () => {
      const node = state.allNodes.find(n => n.id === btn.dataset.node);
      if (!node) return;
      const fresh = loadData();
      if (!isNodeUnlocked(node, state.allNodes, fresh)) {
        btn.classList.remove('node--nudge');
        void btn.offsetWidth; // restart the animation
        btn.classList.add('node--nudge');
        playSound('locked');
        haptic([15, 40, 15]);
        showToast('סיימו קודם את השיעור שלפניו');
        return;
      }
      startNode(node);
    });
  });

  // Bring the current node into view if it sits far down the path
  if (current && current.flatIdx > 2 && !reducedMotion()) {
    const el = root.querySelector(`[data-node="${current.id}"]`);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260);
  }
}

/* ================================================================
   6. SESSION — start / queue / advance
   ================================================================ */

function showDailyCapNotice() {
  showView('play');
  hideActionBar();
  setHudProgress(1);
  const cardWrap = document.getElementById('challenge-card');
  if (cardWrap) {
    cardWrap.innerHTML = `
      <div class="prac-card g" style="text-align:center;padding:2rem 1.5rem;">
        <div style="font-size:2.2rem;margin-block-end:.6rem;">🌱</div>
        <h3 style="margin:.2rem 0 .6rem;">15 הדקות היומיות שלך הושלמו</h3>
        <p style="color:var(--text-muted);max-inline-size:34rem;margin-inline:auto;line-height:1.6;">
          זו לא תקלה — זו השיטה. אימון קצר וקבוע כל יום בונה את השריר הרבה יותר
          מסשן ארוך פעם בשבוע. הרצף שלך נשמר, ומחר מחכה לך סט חדש.
        </p>
        <button class="btn-check btn-check--ready" style="margin-block-start:1.2rem;"
                onclick="window.backToMenu && window.backToMenu()">חזרה למסלול</button>
      </div>`;
  }
}

/** Pick the challenges a node will serve this round. */
function drawChallenges(node, data) {
  if (node.kind !== 'boss') return shuffle(clone(node.challenges));

  // Boss: a mixed exam, weighted toward what the learner has NOT mastered.
  const weak   = node.challenges.filter(c => !isSolved(data, c.id));
  const strong = node.challenges.filter(c =>  isSolved(data, c.id));
  const picked = shuffle(weak.slice()).concat(shuffle(strong.slice())).slice(0, BOSS_SIZE);
  return shuffle(clone(picked));
}

function startNode(node) {
  const data = loadData();

  if (dailyPlaySeconds(data) >= DAILY_CAP_SECONDS) {
    state.node = node;
    showDailyCapNotice();
    return;
  }

  const drawn = drawChallenges(node, data);
  if (drawn.length === 0) return;

  state.node        = node;
  state.queue       = drawn.map(ch => ({ ch, review: false, attempts: 0 }));
  state.qi          = 0;
  state.hearts      = MAX_HEARTS;
  state.combo       = 0;
  state.maxCombo    = 0;
  state.sessionXP   = 0;
  state.uniqueTotal = drawn.length;
  state.solved      = new Set();
  state.firstTry    = 0;
  state.mistakes    = [];
  state.startTime   = new Date();
  state.active      = null;

  unlockAudio();
  showView('play');
  renderHearts();
  setHudProgress(0);
  hideCombo();
  renderChallenge();
}

function currentItem() { return state.queue[state.qi]; }

function advanceChallenge() {
  state.qi++;
  if (state.hearts <= 0) { endFail(); return; }
  if (state.qi >= state.queue.length) { endSession(); return; }
  renderChallenge();
}

/* ================================================================
   PLAY VIEW — challenge rendering
   ================================================================ */

function renderChallenge() {
  const item = currentItem();
  if (!item) { endSession(); return; }
  const challenge = item.ch;

  const cardWrap = document.getElementById('challenge-card');
  if (!cardWrap) return;

  state.active = null;

  hideFeedback();
  showActionBar();
  setCheckButton(false, false);
  setHudProgress(state.solved.size / state.uniqueTotal);

  // Review-round ribbon
  const tag = document.getElementById('review-tag');
  if (tag) {
    tag.style.display = item.review ? '' : 'none';
    tag.innerHTML = item.review
      ? '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i> חזרה על טעות'
      : '';
  }

  switch (challenge.type) {
    case 'match':   renderMatch(challenge, cardWrap); break;
    case 'order':   renderOrder(challenge, cardWrap); break;
    case 'cloze':   renderCloze(challenge, cardWrap); break;
    case 'goodbad': renderGoodBad(challenge, cardWrap); break;
    default:
      cardWrap.innerHTML = `<p style="color:var(--text-muted)">סוג אתגר לא מוכר: ${escHtml(challenge.type)}</p>`;
  }
}

/* ---- GOOD/BAD ---- */
function renderGoodBad(challenge, container) {
  const order = shuffle([0, 1]);
  state.active = { type: 'goodbad', answered: false };
  setCheckButton(false, false); // self-checking

  container.innerHTML = `
    <div class="prac-card g">
      <div class="prac-card__eyebrow"><i class="fa-solid fa-scale-balanced"></i> שיפוט</div>
      <div class="prac-card__title">${escHtml(challenge.title || 'טוב או רע?')}</div>
      <p class="prac-card__desc">${escHtml(challenge.prompt || 'איזו מהדוגמאות נאמנה למה שנלמד בשיעור?')}</p>
      <div class="goodbad-options">
        ${order.map((exIdx, displayIdx) => `
          <button class="goodbad-option" data-ex="${exIdx}" type="button">
            <span class="goodbad-option__label">דוגמה ${displayIdx === 0 ? 'א' : 'ב'}</span>
            <span class="goodbad-option__text">${escHtml(challenge.examples[exIdx].text)}</span>
          </button>`).join('')}
      </div>
    </div>`;

  container.querySelectorAll('.goodbad-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.active.answered) return;
      state.active.answered = true;
      const picked = Number(btn.dataset.ex);
      const isCorrect = picked === (challenge.correctIndex || 0);
      container.querySelectorAll('.goodbad-option').forEach(b => {
        const idx = Number(b.dataset.ex);
        b.disabled = true;
        if (idx === (challenge.correctIndex || 0)) b.classList.add('goodbad-option--good');
        else if (idx === picked) b.classList.add('goodbad-option--bad');
      });
      submitAnswer(challenge, isCorrect ? 100 : 0,
        isCorrect ? 'שיפוט מדויק!' : 'לא הפעם — שווה לקרוא למה', btn);
    });
  });
}

/* ---- MATCH ---- */
function renderMatch(challenge, container) {
  const pairs = shuffle(clone(challenge.pairs));
  const rightItems = pairs.map(p => p.left);
  const leftItems  = shuffle(pairs.map(p => p.right));

  const matchState = { rightSel: null, leftSel: null, matched: new Set(), wrongAttempts: 0 };

  container.innerHTML = `
    <div class="prac-card g">
      <div class="prac-card__eyebrow"><i class="fa-solid fa-shuffle"></i> התאמה</div>
      <div class="prac-card__title">${escHtml(challenge.title)}</div>
      <div class="match-grid">
        <div class="match-col" id="match-col-right">
          <div class="match-col__label">מושגים</div>
          <div class="match-items" id="match-right">
            ${rightItems.map((text, i) =>
              `<div class="match-item" data-idx="${i}" data-side="right">${escHtml(text)}</div>`
            ).join('')}
          </div>
        </div>
        <div class="match-col" id="match-col-left">
          <div class="match-col__label">הגדרות</div>
          <div class="match-items" id="match-left">
            ${leftItems.map((text, i) =>
              `<div class="match-item" data-idx="${i}" data-side="left">${escHtml(text)}</div>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  const correctMap = {};
  pairs.forEach((p, rightIdx) => { correctMap[rightIdx] = p.right; });

  container.querySelectorAll('.match-item').forEach(el => {
    el.addEventListener('click', () => handleMatchClick(el, matchState, leftItems, correctMap, challenge, container));
  });

  state.active = { type: 'match', matchState, pairs, leftItems, correctMap };
}

function handleMatchClick(el, matchState, leftItems, correctMap, challenge, container) {
  const side = el.dataset.side;
  const idx  = parseInt(el.dataset.idx, 10);

  if (el.classList.contains('match-item--correct') || el.classList.contains('match-item--locked')) return;

  if (side === 'right') {
    container.querySelectorAll('[data-side="right"]').forEach(e => {
      if (!e.classList.contains('match-item--correct')) e.classList.remove('match-item--selected');
    });
    matchState.rightSel = idx;
    el.classList.add('match-item--selected');
    if (matchState.leftSel !== null) attemptMatch(matchState, leftItems, correctMap, challenge, container);
  } else if (side === 'left') {
    container.querySelectorAll('[data-side="left"]').forEach(e => {
      if (!e.classList.contains('match-item--correct')) e.classList.remove('match-item--selected');
    });
    matchState.leftSel = idx;
    el.classList.add('match-item--selected');
    if (matchState.rightSel !== null) attemptMatch(matchState, leftItems, correctMap, challenge, container);
  }
}

function attemptMatch(matchState, leftItems, correctMap, challenge, container) {
  const ri = matchState.rightSel;
  const li = matchState.leftSel;
  if (ri === null || li === null) return;

  const rightEl = container.querySelector(`[data-side="right"][data-idx="${ri}"]`);
  const leftEl  = container.querySelector(`[data-side="left"][data-idx="${li}"]`);

  const selectedDef = leftItems[li];
  const correctDef  = correctMap[ri];

  if (selectedDef === correctDef) {
    [rightEl, leftEl].forEach(e => {
      e.classList.remove('match-item--selected');
      e.classList.add('match-item--correct', 'match-item--locked');
    });
    matchState.matched.add(ri);
    matchState.rightSel = null;
    matchState.leftSel  = null;
    playSound('tick');
    haptic(8);

    if (matchState.matched.size === challenge.pairs.length) {
      // 100% clean, −10% per wrong tap, floor 50%
      const accuracy = Math.max(50, 100 - matchState.wrongAttempts * 10);
      const msg = matchState.wrongAttempts === 0
        ? 'התאמה מושלמת!'
        : `כל הזוגות הותאמו (${matchState.wrongAttempts} נסיונות שגויים)`;
      setTimeout(() => submitAnswer(challenge, accuracy, msg, rightEl), 320);
    }
  } else {
    matchState.wrongAttempts++;
    [rightEl, leftEl].forEach(e => {
      e.classList.remove('match-item--selected');
      e.classList.add('match-item--error');
    });
    playSound('tap-wrong');
    haptic(20);
    setTimeout(() => {
      [rightEl, leftEl].forEach(e => e.classList.remove('match-item--error'));
    }, 600);
    matchState.rightSel = null;
    matchState.leftSel  = null;
  }
}

/* ---- ORDER ---- */
function renderOrder(challenge, container) {
  const shuffled = shuffle(clone(challenge.items));
  const orderState = { currentOrder: shuffled.slice(), checked: false, dragSrcIdx: null };

  container.innerHTML = `
    <div class="prac-card g">
      <div class="prac-card__eyebrow"><i class="fa-solid fa-arrow-up-1-9"></i> סידור</div>
      <div class="prac-card__title">${escHtml(challenge.title)}</div>
      ${challenge.description ? `<div class="prac-card__desc">${escHtml(challenge.description)}</div>` : ''}
      <div class="order-list" id="order-list"></div>
    </div>
  `;

  function renderOrderList() {
    const list = container.querySelector('#order-list');
    list.innerHTML = orderState.currentOrder.map((text, i) => `
      <div class="order-item" draggable="true" data-idx="${i}"
           aria-label="${escHtml(text)}, מיקום ${i + 1}">
        <div class="order-item__num">${i + 1}</div>
        <div class="order-item__text">${escHtml(text)}</div>
        <div class="order-item__arrows" aria-hidden="true">
          <button type="button" title="הזז למעלה" onclick="orderMoveItem(${i}, -1)" ${i === 0 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-up"></i>
          </button>
          <button type="button" title="הזז למטה" onclick="orderMoveItem(${i}, 1)"
                  ${i === orderState.currentOrder.length - 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      </div>
    `).join('');

    attachOrderDragListeners(list, orderState, renderOrderList);
    if (!orderState.checked) setCheckButton(true, true);
  }

  renderOrderList();
  state.active = { type: 'order', orderState, challenge, renderOrderList };
}

window.orderMoveItem = function(fromIdx, dir) {
  if (!state.active || state.active.type !== 'order') return;
  const { orderState, renderOrderList } = state.active;
  if (orderState.checked) return;
  const toIdx = fromIdx + dir;
  if (toIdx < 0 || toIdx >= orderState.currentOrder.length) return;
  const arr = orderState.currentOrder;
  [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]];
  renderOrderList();
  playSound('tick');
  haptic(6);
};

function attachOrderDragListeners(list, orderState, renderOrderList) {
  const items = list.querySelectorAll('.order-item');
  items.forEach(item => {
    item.addEventListener('dragstart', e => {
      if (orderState.checked) { e.preventDefault(); return; }
      orderState.dragSrcIdx = parseInt(item.dataset.idx, 10);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.order-item').forEach(i => i.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.order-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (orderState.checked) return;
      const toIdx = parseInt(item.dataset.idx, 10);
      const fromIdx = orderState.dragSrcIdx;
      if (fromIdx === null || fromIdx === toIdx) return;
      const arr = orderState.currentOrder;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      orderState.dragSrcIdx = null;
      renderOrderList();
    });

    // Touch fallback (arrow buttons remain the primary mobile affordance)
    let touchStartY = 0;
    let touchStartIdx = null;
    item.addEventListener('touchstart', e => {
      if (orderState.checked) return;
      touchStartY = e.touches[0].clientY;
      touchStartIdx = parseInt(item.dataset.idx, 10);
    }, { passive: true });
    item.addEventListener('touchend', e => {
      if (orderState.checked || touchStartIdx === null) return;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dy) < 30) { touchStartIdx = null; return; }
      const dir = dy > 0 ? 1 : -1;
      const toIdx = touchStartIdx + dir;
      if (toIdx >= 0 && toIdx < orderState.currentOrder.length) {
        const arr = orderState.currentOrder;
        [arr[touchStartIdx], arr[toIdx]] = [arr[toIdx], arr[touchStartIdx]];
        renderOrderList();
      }
      touchStartIdx = null;
    }, { passive: true });
  });
}

function checkOrderAnswer() {
  if (!state.active || state.active.type !== 'order') return;
  const { orderState, challenge } = state.active;
  orderState.checked = true;

  const canonical = challenge.items;
  const current   = orderState.currentOrder;
  let correctCount = 0;
  current.forEach((item, i) => { if (item === canonical[i]) correctCount++; });
  const accuracy = Math.round((correctCount / canonical.length) * 100);

  const list = document.querySelector('#order-list');
  if (list) {
    list.querySelectorAll('.order-item').forEach((el, i) => {
      const ok = current[i] === canonical[i];
      el.classList.add(ok ? 'order-item--correct' : 'order-item--error');
      if (!ok) {
        const correctPos = canonical.indexOf(current[i]) + 1;
        const lbl = document.createElement('div');
        lbl.className = 'order-result-label order-result-label--error';
        lbl.textContent = `צריך להיות במיקום ${correctPos}`;
        el.appendChild(lbl);
      }
    });
  }

  const msg = accuracy >= MASTERY
    ? `${correctCount}/${canonical.length} פריטים במיקום הנכון`
    : `הסדר הנכון: ${canonical.join(' ← ')}`;
  submitAnswer(challenge, accuracy, msg, list);
}

/* ---- CLOZE ---- */
function renderCloze(challenge, container) {
  const options = shuffle(clone(challenge.options));
  const clozeState = { selected: null, checked: false };

  const sentenceHtml = escHtml(challenge.sentence)
    .replace('___', `<span class="cloze-blank" id="cloze-blank">___</span>`);

  container.innerHTML = `
    <div class="prac-card g">
      <div class="prac-card__eyebrow"><i class="fa-solid fa-pen-to-square"></i> השלמת משפט</div>
      <div class="prac-card__title">${escHtml(challenge.title)}</div>
      <div class="cloze-sentence">${sentenceHtml}</div>
      <div class="cloze-options" id="cloze-options">
        ${options.map((opt, i) =>
          `<button type="button" class="cloze-chip" data-idx="${i}" data-value="${escHtml(opt)}">${escHtml(opt)}</button>`
        ).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.cloze-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (clozeState.checked) return;
      container.querySelectorAll('.cloze-chip').forEach(c => c.classList.remove('cloze-chip--selected'));
      chip.classList.add('cloze-chip--selected');
      clozeState.selected = chip.dataset.value;
      const blank = document.getElementById('cloze-blank');
      if (blank) blank.textContent = clozeState.selected;
      setCheckButton(true, true);
      playSound('tick');
      haptic(6);
    });
  });

  state.active = { type: 'cloze', clozeState, challenge };
}

function checkClozeAnswer() {
  if (!state.active || state.active.type !== 'cloze') return;
  const { clozeState, challenge } = state.active;
  if (!clozeState.selected) return;

  clozeState.checked = true;
  const isCorrect = clozeState.selected === challenge.correct;

  const blank = document.getElementById('cloze-blank');
  if (blank) {
    blank.textContent = clozeState.selected;
    blank.classList.add(isCorrect ? 'cloze-blank--correct' : 'cloze-blank--error');
  }

  let anchor = null;
  document.querySelectorAll('.cloze-chip').forEach(chip => {
    chip.disabled = true;
    if (chip.dataset.value === challenge.correct) {
      chip.classList.add('cloze-chip--correct');
      anchor = chip;
    } else if (chip.dataset.value === clozeState.selected && !isCorrect) {
      chip.classList.remove('cloze-chip--selected');
      chip.classList.add('cloze-chip--error');
    }
  });

  submitAnswer(challenge, isCorrect ? 100 : 0,
    isCorrect ? null : `התשובה הנכונה: ${challenge.correct}`, anchor);
}

/* ================================================================
   THE ONE ANSWER PIPELINE
   Every challenge type funnels here: score → hearts → combo → XP →
   persistence → feedback panel.
   ================================================================ */

function submitAnswer(challenge, accuracy, message, anchorEl) {
  const item = currentItem();
  const isCorrect = accuracy >= MASTERY;

  // ---- Persist best-ever accuracy for this challenge (ids preserved) ----
  const data = loadData();
  const prev = data.completed[challenge.id];
  if (prev === undefined || accuracy > prev) data.completed[challenge.id] = accuracy;
  saveData(data);

  if (isCorrect) {
    state.solved.add(challenge.id);
    if (!item.review) state.firstTry++;
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);

    const xp = xpFor(item, accuracy, state.combo);
    state.sessionXP += xp;

    playSound(state.combo >= 3 ? 'great' : 'good');
    haptic(12);
    flashScreen('good');
    popXP(anchorEl, xp);
    if (state.combo >= 3) showCombo(state.combo);
    else hideCombo();
  } else {
    state.combo = 0;
    hideCombo();
    loseHeart();
    if (state.mistakes.indexOf(challenge) === -1) state.mistakes.push(challenge);

    item.attempts++;
    if (item.attempts < MAX_ATTEMPTS && state.hearts > 0) {
      // Duolingo behaviour: a missed challenge comes back at the end of the round
      state.queue.push({ ch: challenge, review: true, attempts: item.attempts });
    }

    playSound('bad');
    haptic([25, 45, 25]);
    flashScreen('bad');
  }

  setHudProgress(state.solved.size / state.uniqueTotal);
  hideActionBar();
  showFeedbackPanel(isCorrect, message, challenge.explanation || null, () => advanceChallenge(), challenge);
}

/**
 * XP model. Base scales with accuracy; a streak of 3+ correct answers in a
 * row starts paying a combo bonus. Replayed mistakes pay a small flat rate.
 */
function xpFor(item, accuracy, combo) {
  if (item && item.review) return 4;
  const base = 6 + Math.round((accuracy / 100) * 6);           // 6 … 12
  const bonus = combo >= 3 ? Math.min(6, (combo - 2) * 2) : 0; // +2 … +6
  return base + bonus;
}

/* ================================================================
   HEARTS · COMBO · PROGRESS HUD
   ================================================================ */

function renderHearts() {
  const wrap = document.getElementById('hearts');
  if (!wrap) return;
  let html = '';
  for (let i = 0; i < MAX_HEARTS; i++) {
    const spent = i >= state.hearts;
    html += `<i class="fa-solid fa-heart prac-heart ${spent ? 'prac-heart--spent' : ''}" aria-hidden="true"></i>`;
  }
  wrap.innerHTML = html;
  wrap.setAttribute('aria-label', `נותרו ${state.hearts} לבבות`);
}

function loseHeart() {
  state.hearts = Math.max(0, state.hearts - 1);
  renderHearts();
  const wrap = document.getElementById('hearts');
  if (wrap) {
    wrap.classList.remove('prac-hearts--hit');
    void wrap.offsetWidth;
    wrap.classList.add('prac-hearts--hit');
  }
}

function setHudProgress(ratio) {
  const fill = document.getElementById('hud-fill');
  const pct  = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  if (fill) fill.style.inlineSize = pct + '%';
  const bar = document.getElementById('hud-bar');
  if (bar) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${state.solved ? state.solved.size : 0} מתוך ${state.uniqueTotal}`);
  }
}

function showCombo(n) {
  const el = document.getElementById('combo-badge');
  if (!el) return;
  el.innerHTML = `<i class="fa-solid fa-fire" aria-hidden="true"></i> ${n} ברצף · XP×`;
  el.classList.add('prac-combo--show');
  el.classList.remove('prac-combo--pop');
  void el.offsetWidth;
  el.classList.add('prac-combo--pop');
}

function hideCombo() {
  document.getElementById('combo-badge')?.classList.remove('prac-combo--show');
}

/* ================================================================
   CHECK BUTTON & ACTION BAR
   ================================================================ */

function setCheckButton(visible, enabled) {
  const bar = document.getElementById('action-bar');
  const btn = document.getElementById('btn-check');
  if (!bar || !btn) return;
  bar.classList.toggle('prac-actions--hidden', !visible);
  btn.disabled = !enabled;
  btn.classList.toggle('btn-check--ready', enabled);
}

function showActionBar() {
  document.getElementById('action-bar')?.classList.remove('prac-actions--hidden');
}

function hideActionBar() {
  document.getElementById('action-bar')?.classList.add('prac-actions--hidden');
}

/** Called when the user clicks "בדוק תשובה" */
window.checkAnswer = function() {
  if (!state.active) return;
  switch (state.active.type) {
    case 'order': checkOrderAnswer(); break;
    case 'cloze': checkClozeAnswer(); break;
    // match + goodbad are self-checking
  }
};

/* ================================================================
   FEEDBACK PANEL
   ================================================================ */

/**
 * Slide-up feedback. Shows the verdict, an explanation when the data has one,
 * and (Project-100) the verbatim source quote with a deep link to the lesson.
 */
function showFeedbackPanel(isCorrect, overrideMsg, explanation, onContinue, challenge) {
  const panel   = document.getElementById('feedback-panel');
  const icon    = document.getElementById('feedback-icon');
  const verdict = document.getElementById('feedback-verdict');
  const expEl   = document.getElementById('feedback-explanation');
  const btnEl   = document.getElementById('feedback-btn');
  if (!panel) return;

  panel.className = 'prac-feedback prac-feedback--show ' +
                    (isCorrect ? 'prac-feedback--correct' : 'prac-feedback--error');

  icon.textContent = isCorrect ? '✓' : '✗';
  verdict.textContent = isCorrect
    ? (overrideMsg || pickPraise())
    : (overrideMsg || 'כמעט — ננסה שוב בהמשך הסבב');

  expEl.textContent = explanation || '';
  if (challenge && challenge.sourceQuote) {
    const lk = /^m(\d+)-(\d+)-(\d+)$/.exec(challenge.sourceLessonKey || '');
    // בתוך טאב התרגול של השיעור הקישור מיותר — הלומד כבר שם. ובלי
    // target="_top" הוא גם היה טוען את כל הפורטל *בתוך* המסגרת.
    const sameLesson = state.lessonMode && state.lessonMode === challenge.sourceLessonKey;
    const href = (lk && !sameLesson) ? `../index.html?module=${lk[1]}&week=${lk[2]}&day=${lk[3]}` : null;
    const target = state.lessonMode ? ' target="_top"' : '';
    expEl.insertAdjacentHTML('beforeend', `
      <div class="prac-source">
        <span class="prac-source__quote">מהשיעור: ״${escHtml(challenge.sourceQuote)}״</span>
        ${href ? `<a class="prac-source__link" href="${href}"${target}>פתח את השיעור ←</a>` : ''}
      </div>`);
  }
  expEl.style.display = (explanation || (challenge && challenge.sourceQuote)) ? '' : 'none';

  const isLast = state.qi >= state.queue.length - 1;
  btnEl.textContent = (state.hearts <= 0) ? 'לסיכום' : (isLast ? 'לסיכום' : 'המשך');

  // Replace the old listener
  const newBtn = btnEl.cloneNode(true);
  btnEl.parentNode.replaceChild(newBtn, btnEl);
  newBtn.addEventListener('click', () => { hideFeedback(); onContinue(); });
}

const PRAISE = ['מצוין!', 'בול בפוני!', 'יפה מאוד!', 'כל הכבוד!', 'מדויק!', 'ממשיכים חזק!'];
function pickPraise() { return PRAISE[Math.floor(Math.random() * PRAISE.length)]; }

function hideFeedback() {
  const panel = document.getElementById('feedback-panel');
  if (panel) panel.className = 'prac-feedback';
  const expEl = document.getElementById('feedback-explanation');
  if (expEl) { expEl.textContent = ''; expEl.style.display = 'none'; }
  const verdictEl = document.getElementById('feedback-verdict');
  if (verdictEl) verdictEl.textContent = '';
  const iconEl = document.getElementById('feedback-icon');
  if (iconEl) iconEl.textContent = '';
}

/* ================================================================
   7. FX — sound, haptics, XP pops, flashes, toast
   ================================================================ */

let audioCtx = null;

function soundOn() {
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

function toggleSound() {
  const next = soundOn() ? 'off' : 'on';
  try { localStorage.setItem(SOUND_KEY, next); } catch (_) {}
  syncSoundButton();
  if (next === 'on') { unlockAudio(); playSound('good'); }
  showToast(next === 'on' ? 'צלילים פועלים' : 'צלילים כבויים');
}

function syncSoundButton() {
  const btn = document.getElementById('sound-toggle');
  if (!btn) return;
  const on = soundOn();
  btn.classList.toggle('prac-sound--off', !on);
  btn.setAttribute('aria-label', on ? 'כבה צלילים' : 'הפעל צלילים');
  btn.setAttribute('aria-pressed', String(on));
  btn.innerHTML = `<i class="fa-solid ${on ? 'fa-volume-high' : 'fa-volume-xmark'}" aria-hidden="true"></i>` +
                  `<span>${on ? 'צלילים פועלים' : 'צלילים כבויים'}</span>`;
}

/** Browsers require a user gesture before audio can start. */
function unlockAudio() {
  if (!soundOn()) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) { audioCtx = null; }
}

/** Tiny synthesised cues — no audio files, no network, no CDN. */
const SOUND_SPECS = {
  good:      [[660, 0, .09], [880, .07, .13]],
  great:     [[660, 0, .07], [880, .06, .07], [1175, .12, .16]],
  bad:       [[196, 0, .16], [147, .09, .2]],
  tick:      [[880, 0, .045]],
  'tap-wrong': [[180, 0, .09]],
  locked:    [[220, 0, .07], [165, .07, .1]],
  complete:  [[523, 0, .1], [659, .09, .1], [784, .18, .1], [1047, .27, .3]],
  fail:      [[392, 0, .14], [311, .12, .14], [233, .24, .3]]
};

function playSound(name) {
  if (!soundOn() || !audioCtx) return;
  const spec = SOUND_SPECS[name];
  if (!spec) return;
  try {
    const now = audioCtx.currentTime;
    spec.forEach(([freq, delay, dur]) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = (name === 'bad' || name === 'fail' || name === 'tap-wrong') ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.16, now + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.02);
    });
  } catch (_) { /* audio is a nice-to-have, never a blocker */ }
}

/** Physical feedback where the device supports it (Android / some browsers). */
function haptic(pattern) {
  if (reducedMotion()) return;
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {}
}

function flashScreen(kind) {
  if (reducedMotion()) return;
  const el = document.getElementById('prac-flash');
  if (!el) return;
  el.className = 'prac-flash';
  void el.offsetWidth;
  el.classList.add(kind === 'good' ? 'prac-flash--good' : 'prac-flash--bad');
}

function popXP(anchorEl, xp) {
  if (reducedMotion() || !xp) return;
  const pop = document.createElement('div');
  pop.className = 'xp-pop';
  pop.textContent = '+' + xp;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (anchorEl && anchorEl.getBoundingClientRect) {
    const r = anchorEl.getBoundingClientRect();
    if (r.width || r.height) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
  }
  pop.style.insetInlineStart = 'auto';
  pop.style.left = Math.round(x) + 'px';
  pop.style.top  = Math.round(y) + 'px';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 1100);
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('prac-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('prac-toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('prac-toast--show'), 2200);
}

/* ================================================================
   8. END OF ROUND — summary / fail
   ================================================================ */

function commitSessionStats(elapsed) {
  const data = loadData();
  data.xp = (data.xp || 0) + state.sessionXP;
  const streakResult = updateStreak(data);
  addDailyPlay(data, elapsed);
  // Weekly bucket for the league (local mirror + fire-and-forget push).
  // Mutates `data.weekly` before we persist, so one save covers both.
  if (window.bwcLeague) window.bwcLeague.recordRound(data, state.sessionXP);
  saveData(data);
  return { data, streakResult };
}

function endSession() {
  const elapsed = Math.round((new Date() - state.startTime) / 1000);
  const total   = state.uniqueTotal;
  const correct = state.firstTry;                // accuracy = first-attempt hits
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;
  const perfect = state.mistakes.length === 0;

  // End-of-round bonuses
  if (perfect) state.sessionXP += 15;
  if (state.node && state.node.kind === 'boss') state.sessionXP += 10;
  state.sessionXP += state.hearts * 2;

  const { data, streakResult } = commitSessionStats(elapsed);

  showView('done');
  hideFeedback();
  hideActionBar();

  // Grade pill
  const grade = document.getElementById('done-grade');
  if (grade) {
    if (perfect) {
      grade.className = 'prac-done__grade prac-done__grade--perfect';
      grade.innerHTML = '<i class="fa-solid fa-star" aria-hidden="true"></i> סבב מושלם';
    } else if (pct >= 70) {
      grade.className = 'prac-done__grade prac-done__grade--great';
      grade.innerHTML = '<i class="fa-solid fa-thumbs-up" aria-hidden="true"></i> סבב חזק';
    } else {
      grade.className = 'prac-done__grade prac-done__grade--ok';
      grade.innerHTML = '<i class="fa-solid fa-seedling" aria-hidden="true"></i> ממשיכים לבנות';
    }
  }

  document.getElementById('done-xp').textContent     = '+' + state.sessionXP;
  document.getElementById('done-xp-sub').textContent = `${state.sessionXP} נקודות XP הרווחתם`;
  document.getElementById('done-correct').textContent = `${correct}/${total}`;
  document.getElementById('done-pct').textContent     = pct + '%';
  document.getElementById('done-time').textContent    = formatTime(elapsed);
  const comboEl = document.getElementById('done-combo');
  if (comboEl) comboEl.textContent = state.maxCombo > 0 ? String(state.maxCombo) : '0';
  const heartsEl = document.getElementById('done-hearts');
  if (heartsEl) heartsEl.textContent = `${state.hearts}/${MAX_HEARTS}`;

  renderStreakBlock(streakResult, data.streak);

  // Unit crowned?
  const crown = document.getElementById('done-crown');
  if (crown) {
    const unit = state.units.find(u => state.node && u.moduleIdx === state.node.unitIdx);
    const crowned = unit && unit.nodes.every(n => isNodeDone(n, data));
    crown.style.display = crowned ? '' : 'none';
    if (crowned) {
      crown.innerHTML = `
        <i class="fa-solid fa-crown" aria-hidden="true"></i>
        <div>
          <strong>היחידה הושלמה</strong>
          <span>${escHtml(unit.module.title)} — כל האתגרים ביחידה נפתרו.</span>
        </div>`;
    }
  }

  // Next-node button label
  const nextBtn = document.getElementById('done-next');
  if (nextBtn) {
    if (state.lessonMode) {
      nextBtn.innerHTML = '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i> תרגלו שוב';
    } else {
      const fresh = loadData();
      const next = state.allNodes.find(n => isNodeUnlocked(n, state.allNodes, fresh) && !isNodeDone(n, fresh));
      nextBtn.innerHTML = next
        ? '<i class="fa-solid fa-forward" aria-hidden="true"></i> לשיעור הבא'
        : '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i> תרגל שוב';
    }
  }
  relabelBackButtons();

  playSound('complete');
  haptic([12, 60, 12, 60, 22]);
  triggerParticleBurst();
}

function endFail() {
  const elapsed = Math.round((new Date() - state.startTime) / 1000);
  commitSessionStats(elapsed);

  showView('fail');
  hideFeedback();
  hideActionBar();

  const xpEl = document.getElementById('fail-xp');
  if (xpEl) xpEl.textContent = `+${state.sessionXP} XP נשמרו — שום דבר לא הלך לאיבוד.`;

  const list = document.getElementById('fail-mistakes');
  if (list) {
    list.innerHTML = state.mistakes.slice(0, 4).map(c =>
      `<div class="prac-fail__mistake"><strong>${escHtml(c.title || '')}</strong></div>`
    ).join('');
  }

  relabelBackButtons();
  playSound('fail');
  haptic([40, 60, 40]);
}

/**
 * In lesson mode there is no path map to go back to — the "back" target is
 * this lesson's own practice card. Relabels the two static buttons in
 * pages/practice.html so the wording matches where the button actually goes.
 */
function relabelBackButtons() {
  if (!state.lessonMode) return;
  document.querySelectorAll('.prac-done__actions .btn-ghost-dark').forEach(btn => {
    btn.innerHTML = '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> חזרה לתרגול השיעור';
  });
}

function renderStreakBlock(streakResult, currentStreak) {
  const el = document.getElementById('done-streak');
  if (!el) return;
  let icon, title, sub;
  if (streakResult.isNew) {
    icon = '<i class="fa-solid fa-fire" style="color:#f97316"></i>';
    title = 'התחלתם רצף!';
    sub   = 'חזרו מחר כדי להמשיך.';
  } else if (streakResult.changed) {
    icon = '<i class="fa-solid fa-fire" style="color:#f97316"></i>';
    title = `רצף של ${currentStreak} ימים!`;
    sub   = 'מרשים — ממשיכים ככה.';
  } else {
    icon = '<i class="fa-solid fa-calendar-check" style="color:var(--accent-teal)"></i>';
    title = `רצף פעיל: ${currentStreak} ימים`;
    sub   = 'כבר תרגלתם היום — הרצף שמור.';
  }
  el.innerHTML = `
    <div class="prac-done__streak-icon">${icon}</div>
    <div class="prac-done__streak-text">
      <strong>${title}</strong>
      <span>${sub}</span>
    </div>
  `;
}

function triggerParticleBurst() {
  const container = document.getElementById('done-particles');
  if (!container) return;
  if (reducedMotion()) return;

  container.innerHTML = '';
  const colors = ['#D4AF37', '#E6C65A', '#4ade80', '#2F8592', '#fff'];

  for (let i = 0; i < 26; i++) {
    const dot = document.createElement('span');
    dot.className = 'prac-done__particle';
    const angle = (i / 26) * 360;
    const dist  = 60 + Math.random() * 90;
    const dx    = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
    const dy    = Math.round(Math.sin((angle * Math.PI) / 180) * dist);
    dot.style.cssText = `
      left: 50%; top: 40%;
      background: ${colors[i % colors.length]};
      --tx: translate(${dx}px, ${dy - 40}px);
      animation-delay: ${(i * 0.03).toFixed(2)}s;
      animation-duration: ${(0.9 + Math.random() * 0.4).toFixed(2)}s;
    `;
    container.appendChild(dot);
  }
}

/* ================================================================
   NAVIGATION HOOKS (global — used by inline handlers in the HTML)
   ================================================================ */

/** Replay the node just played. */
window.replaySession = function() {
  if (state.node) startNode(state.node);
  else window.backToMenu();
};

/** Jump straight into the next unfinished node on the path. */
window.goNextNode = function() {
  // Lesson mode has no "next node" — the round is this lesson's challenges.
  if (state.lessonMode) { window.replaySession(); return; }
  const data = loadData();
  const next = state.allNodes.find(n => isNodeUnlocked(n, state.allNodes, data) && !isNodeDone(n, data));
  if (next) startNode(next);
  else window.replaySession();
};

/* ================================================================
   PUBLIC ENTRY POINT — run a round over a given lesson's challenges
   Used by the "תרגול" tab in the lesson player (index.html), which
   loads this very file inside pages/practice.html?embed=1&lesson=…
   ================================================================ */
window.BwcPractice = {
  /** How many challenges this lesson has (0 = no practice yet). */
  countForLesson: function(lessonKey) {
    return lessonChallenges(lessonKey).length;
  },

  /** Start a round over exactly this lesson's challenges. */
  startLessonRound: function(lessonKey) {
    const key = lessonKey || state.lessonMode;
    if (!key) return false;
    if (!state.lessonMode || state.lessonMode !== key) {
      state.lessonMode = key;
      state.lessonNode = buildLessonNode(key);
    }
    if (!state.lessonNode) { renderLessonMenu(); showView('menu'); return false; }
    startNode(state.lessonNode);
    return true;
  }
};

window.backToMenu = function() {
  renderMenu();
  showView('menu');
};

/* ---- mid-session exit confirm ---- */
window.requestExit = function() {
  document.getElementById('confirm-overlay')?.classList.add('prac-confirm-overlay--show');
};

window.confirmExit = function() {
  document.getElementById('confirm-overlay')?.classList.remove('prac-confirm-overlay--show');
  // Bank the time actually spent so the daily cap stays honest
  if (state.startTime) {
    const elapsed = Math.round((new Date() - state.startTime) / 1000);
    const data = loadData();
    addDailyPlay(data, elapsed);
    saveData(data);
    state.startTime = null;
  }
  hideFeedback();
  hideActionBar();
  hideCombo();
  renderMenu();
  showView('menu');
};

window.cancelExit = function() {
  document.getElementById('confirm-overlay')?.classList.remove('prac-confirm-overlay--show');
};

/* ================================================================
   KEYBOARD SHORTCUTS
   ================================================================ */

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (state.view !== 'play') return;

  if (e.key === 'Enter') {
    const btn = document.getElementById('feedback-btn');
    if (btn && btn.closest('.prac-feedback--show')) { e.preventDefault(); btn.click(); return; }
    const checkBtn = document.getElementById('btn-check');
    if (checkBtn && !checkBtn.disabled) { e.preventDefault(); checkBtn.click(); }
  }

  if (e.key === 'Escape') {
    const overlay = document.getElementById('confirm-overlay');
    if (overlay && overlay.classList.contains('prac-confirm-overlay--show')) window.cancelExit();
    else window.requestExit();
  }
});

/* First interaction anywhere unlocks the audio context. */
document.addEventListener('pointerdown', function once() {
  unlockAudio();
  document.removeEventListener('pointerdown', once);
}, { once: true });
