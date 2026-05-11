/* ==============================================================
   practice.js — Active-recall practice game engine
   עסק ללא מתחרים · Vanilla JS, no libraries
   ============================================================== */

'use strict';

/* ================================================================
   CONSTANTS
   ================================================================ */
const STORAGE_KEY = 'bwc_practice_v1';

/* ================================================================
   SUPABASE SYNC LAYER
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

/**
 * Convert a Supabase practice_stats row to the localStorage shape.
 */
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
 * - XP: max
 * - streak: max
 * - lastDate: the more recent date (or whichever is non-null)
 * - completed: union (keep highest accuracy per challenge)
 */
function mergeData(local, remote) {
  const merged = {
    xp:       Math.max(local.xp || 0, remote.xp || 0),
    streak:   Math.max(local.streak || 0, remote.streak || 0),
    lastDate: null,
    completed: {}
  };

  // Pick more recent lastDate
  if (local.lastDate && remote.lastDate) {
    merged.lastDate = local.lastDate >= remote.lastDate ? local.lastDate : remote.lastDate;
  } else {
    merged.lastDate = local.lastDate || remote.lastDate || null;
  }

  // Union of completed challenges — keep best accuracy for each
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
 * Fetch the user's row from Supabase, merge with localStorage, and save merged
 * result back to localStorage. Also upserts merged data back to Supabase so
 * any local-only progress is pushed up.
 * Non-blocking: errors are logged silently.
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
    } else {
      // No remote row yet — local data is the source of truth
      merged = local;
    }

    // Save merged to localStorage so the UI updates immediately
    saveDataLocal(merged);

    // Push merged data back to Supabase (upsert)
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

    // Fetch current longest_streak before overwriting so we never regress it
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

    if (error) {
      console.warn('[practice] Supabase upsert error:', error.message);
    }
  } catch (err) {
    console.warn('[practice] upsertToSupabase error:', err);
  }
}

/* ================================================================
   STORAGE (localStorage — original + Supabase-aware wrapper)
   ================================================================ */

/**
 * A module is "unlocked" iff at least one challenge exists for it
 * in window.PRACTICE_CHALLENGES. No more hardcoded MVP gate — modules
 * appear/disappear from the practice menu purely as data is added.
 */
function isModuleUnlocked(idx) {
  return (window.PRACTICE_CHALLENGES || []).some(c => c.moduleIdx === idx);
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

/* ================================================================
   STORAGE
   ================================================================ */

/** Load persistent practice data from localStorage. */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const defaults = { xp: 0, streak: 0, lastDate: null, completed: {} };
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    // Merge with defaults in case schema evolved
    return Object.assign({}, defaults, parsed);
  } catch (_) {
    return { xp: 0, streak: 0, lastDate: null, completed: {} };
  }
}

/** Save persistent practice data to localStorage only (internal helper). */
function saveDataLocal(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

/**
 * Save persistent practice data.
 * Always writes to localStorage immediately (non-blocking, synchronous).
 * If the user is authenticated, also fire-and-forgets an upsert to Supabase.
 */
function saveData(data) {
  saveDataLocal(data);
  // Fire-and-forget Supabase sync for authenticated users
  const user = window.bwcAuth && window.bwcAuth.getUser();
  if (user) {
    upsertToSupabase(user.id, data);
  }
}

/**
 * Update streak on session end.
 * - lastDate === today  → no change
 * - lastDate === yesterday → streak + 1
 * - anything else (null, or older) → reset to 1
 * Returns { streak, changed, isNew } so the Done screen can display appropriate messaging.
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
    // Streak broken, or first ever
    isNew = !data.lastDate;
    data.streak = 1;
    data.lastDate = today;
    changed = true;
  }
  return { streak: data.streak, changed, isNew };
}

/* ================================================================
   SESSION STATE
   ================================================================ */

const state = {
  view: 'menu',           // 'menu' | 'play' | 'done'
  challenges: [],         // shuffled challenge objects for current session
  currentIdx: 0,          // index into challenges[]
  sessionXP: 0,
  sessionCorrect: 0,
  sessionStartTime: null, // Date object
  // Per-challenge tracking (index → { accuracy, wrongAttempts })
  challengeResults: {},
  // Active challenge interaction state (type-specific)
  active: null
};

/* ================================================================
   INITIALIZATION
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Wait for auth to resolve before initialising the UI so that
  // authenticated users get their Supabase data merged before first render.
  const authReady = (window.bwcAuth && typeof window.bwcAuth.ready === 'function')
    ? window.bwcAuth.ready()
    : Promise.resolve();

  authReady
    .then(async () => {
      // If the user is logged in, merge Supabase data into localStorage first
      if (window.bwcAuth && window.bwcAuth.getUser()) {
        await syncFromSupabase();
      }
      init();

      // Subscribe to future auth state changes
      if (window.bwcAuth && typeof window.bwcAuth.onChange === 'function') {
        let previousUserId = window.bwcAuth.getUser()
          ? window.bwcAuth.getUser().id
          : null;

        window.bwcAuth.onChange(async (user) => {
          if (user && user.id !== previousUserId) {
            // User just logged IN — merge remote data and re-render menu
            previousUserId = user.id;
            await syncFromSupabase();
            // Re-render menu stats if currently on menu view
            if (state.view === 'menu') {
              renderMenu();
            }
          } else if (!user) {
            // User logged OUT — keep using localStorage as-is
            previousUserId = null;
          }
        });
      }
    })
    .catch(err => {
      // Auth check failed — fall back to guest mode
      console.warn('[practice] Auth ready error, falling back to guest mode:', err);
      init();
    });
});

function init() {
  // Guard: if practice-data.js didn't load or has no content
  if (!window.PRACTICE_CHALLENGES || !Array.isArray(window.PRACTICE_CHALLENGES) || window.PRACTICE_CHALLENGES.length === 0) {
    showView('menu');
    renderMenuEmpty();
    return;
  }
  renderMenu();
  showView('menu');
}

/* ================================================================
   VIEW SWITCHING
   ================================================================ */

function showView(name) {
  state.view = name;
  ['menu', 'play', 'done'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.toggle('prac-view--active', v === name);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ================================================================
   MENU VIEW
   ================================================================ */

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
  const data = loadData();

  // Stats bar
  document.getElementById('stat-xp').textContent = data.xp;
  document.getElementById('stat-streak').textContent = data.streak || 0;
  const lastScore = getLastSessionScore(data);
  document.getElementById('stat-last').textContent = lastScore !== null ? lastScore + '%' : '—';

  // Module grid
  const grid = document.getElementById('module-grid');
  if (!grid) return;

  grid.innerHTML = MODULES.map((mod, idx) => {
    const isUnlocked = isModuleUnlocked(idx);
    const challenges = (window.PRACTICE_CHALLENGES || []).filter(c => c.moduleIdx === idx);
    const count = challenges.length;

    // Badge for unlocked module
    let badge = '';
    if (!isUnlocked) {
      badge = `<span class="prac-badge prac-badge--lock"><i class="fa-solid fa-lock"></i> בקרוב</span>`;
    } else {
      // Check if any challenge for this module was completed
      const bestScores = challenges.map(c => data.completed[c.id]);
      const attempted = bestScores.filter(s => s !== undefined);
      if (attempted.length === 0) {
        badge = `<span class="prac-badge prac-badge--new"><i class="fa-solid fa-circle"></i> חדש</span>`;
      } else if (attempted.length === challenges.length && attempted.every(s => s >= 80)) {
        badge = `<span class="prac-badge prac-badge--done"><i class="fa-solid fa-check"></i> הושלם</span>`;
      } else {
        const avg = Math.round(attempted.reduce((a, b) => a + b, 0) / attempted.length);
        badge = `<span class="prac-badge prac-badge--tried"><i class="fa-solid fa-rotate-right"></i> ${attempted.length}/${challenges.length} · ${avg}%</span>`;
      }
    }

    const clickAttr = isUnlocked
      ? `onclick="startSession(${idx})" tabindex="0" role="button"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();startSession(${idx})}"`
      : `tabindex="0" title="אתגרים לבקרוב"
         onkeydown="void 0"`;

    return `
      <article class="prac-module-card g ${isUnlocked ? '' : 'prac-module-card--locked'}"
               ${clickAttr}
               aria-label="מודול ${idx + 1}: ${mod.title}${isUnlocked ? '' : ' (נעול)'}">
        <div class="prac-module-card__head">
          <div class="prac-module-card__icon">
            ${isUnlocked
              ? `<i class="fa-solid ${mod.icon || 'fa-dumbbell'}"></i>`
              : `<i class="fa-solid fa-lock"></i>`}
          </div>
          <div>
            <div class="prac-module-card__num">מודול ${idx + 1}</div>
            <h3 class="prac-module-card__title">${mod.title}</h3>
          </div>
        </div>
        <p class="prac-module-card__desc">${mod.shortDescription || ''}</p>
        <div class="prac-module-card__footer">
          <span class="prac-module-card__meta">
            <i class="fa-solid fa-bolt"></i>
            ${count > 0 ? count + ' אתגרים' : 'בקרוב'}
          </span>
          ${badge}
        </div>
      </article>
    `;
  }).join('');
}

function getLastSessionScore(data) {
  const completed = data.completed;
  const keys = Object.keys(completed);
  if (keys.length === 0) return null;
  const sum = keys.reduce((a, k) => a + completed[k], 0);
  return Math.round(sum / keys.length);
}

/* ================================================================
   START SESSION
   ================================================================ */

function startSession(moduleIdx) {
  const all = (window.PRACTICE_CHALLENGES || []).filter(c => c.moduleIdx === moduleIdx);
  if (all.length === 0) return;

  state.challenges = shuffle(clone(all));
  state.currentIdx = 0;
  state.sessionXP = 0;
  state.sessionCorrect = 0;
  state.sessionStartTime = new Date();
  state.challengeResults = {};

  showView('play');
  renderChallenge();
}

/* ================================================================
   PLAY VIEW — CHALLENGE RENDERING
   ================================================================ */

function renderChallenge() {
  const challenge = state.challenges[state.currentIdx];
  const total = state.challenges.length;
  const done = state.currentIdx;

  // Progress bar
  const fill = document.getElementById('play-progress-fill');
  const label = document.getElementById('play-progress-label');
  if (fill)  fill.style.width = `${Math.round((done / total) * 100)}%`;
  if (label) label.textContent = `אתגר ${done + 1} מתוך ${total}`;

  // Render appropriate challenge type
  const cardWrap = document.getElementById('challenge-card');
  if (!cardWrap) return;

  state.active = null;

  // Reset chrome BEFORE rendering — so per-type renderers can override
  // the check button (e.g. Order enables it from start since shuffled
  // input is itself a valid candidate answer).
  hideFeedback();
  showActionBar();
  setCheckButton(false, false);

  switch (challenge.type) {
    case 'match': renderMatch(challenge, cardWrap); break;
    case 'order': renderOrder(challenge, cardWrap); break;
    case 'cloze': renderCloze(challenge, cardWrap); break;
    default:
      cardWrap.innerHTML = `<p style="color:var(--text-muted)">סוג אתגר לא מוכר: ${challenge.type}</p>`;
  }
}

/* ----------------------------------------------------------------
   MATCH challenge renderer
   ---------------------------------------------------------------- */
function renderMatch(challenge, container) {
  const pairs = shuffle(clone(challenge.pairs)); // shuffle pair order
  const rightItems = pairs.map(p => p.left);     // concepts (right column in RTL)
  const leftItems  = shuffle(pairs.map(p => p.right)); // definitions (left column, shuffled)

  // Track state
  const matchState = {
    // Map from right-item index → left-item index (matched pairs)
    rightSel: null,   // currently selected right item index
    leftSel: null,    // currently selected left item index
    matched: new Set(), // set of right-item indexes that are locked
    wrongAttempts: 0
  };

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

  // Store canonical mapping: rightIdx → the correct definition text
  const correctMap = {};
  pairs.forEach((p, rightIdx) => { correctMap[rightIdx] = p.right; });

  // Attach click handlers
  container.querySelectorAll('.match-item').forEach(el => {
    el.addEventListener('click', () => handleMatchClick(el, matchState, leftItems, correctMap, challenge, container));
  });

  state.active = { type: 'match', matchState, pairs, leftItems, correctMap };
}

function handleMatchClick(el, matchState, leftItems, correctMap, challenge, container) {
  const side = el.dataset.side;
  const idx  = parseInt(el.dataset.idx, 10);

  // Ignore locked items
  if (el.classList.contains('match-item--correct') || el.classList.contains('match-item--locked')) return;

  if (side === 'right') {
    // Deselect previous right selection
    container.querySelectorAll('[data-side="right"]').forEach(e => {
      if (!e.classList.contains('match-item--correct')) e.classList.remove('match-item--selected');
    });
    matchState.rightSel = idx;
    el.classList.add('match-item--selected');
    // If a left was already selected, attempt match immediately
    if (matchState.leftSel !== null) {
      attemptMatch(matchState, leftItems, correctMap, challenge, container);
    }

  } else if (side === 'left') {
    // Deselect previous left selection
    container.querySelectorAll('[data-side="left"]').forEach(e => {
      if (!e.classList.contains('match-item--correct')) e.classList.remove('match-item--selected');
    });
    matchState.leftSel = idx;
    el.classList.add('match-item--selected');
    // If a right was already selected, attempt match
    if (matchState.rightSel !== null) {
      attemptMatch(matchState, leftItems, correctMap, challenge, container);
    }
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
    // Correct!
    [rightEl, leftEl].forEach(e => {
      e.classList.remove('match-item--selected');
      e.classList.add('match-item--correct', 'match-item--locked');
    });
    matchState.matched.add(ri);
    matchState.rightSel = null;
    matchState.leftSel  = null;

    // Check if all matched
    if (matchState.matched.size === challenge.pairs.length) {
      // Session: compute accuracy (100% minus 10% per wrong attempt, floor 50%)
      const accuracy = Math.max(50, 100 - matchState.wrongAttempts * 10);
      recordChallengeResult(challenge, accuracy);
      // Small delay then show feedback / advance
      setTimeout(() => {
        showFeedbackPanel(true, null, challenge.explanation || null, () => advanceChallenge());
        setCheckButton(false, false); // hide check btn while feedback is up
        hideActionBar();
      }, 350);
    }
  } else {
    // Wrong — flash red briefly
    matchState.wrongAttempts++;
    [rightEl, leftEl].forEach(e => {
      e.classList.remove('match-item--selected');
      e.classList.add('match-item--error');
    });
    setTimeout(() => {
      [rightEl, leftEl].forEach(e => e.classList.remove('match-item--error'));
    }, 600);
    matchState.rightSel = null;
    matchState.leftSel  = null;
  }
}

/* ----------------------------------------------------------------
   ORDER challenge renderer
   ---------------------------------------------------------------- */
function renderOrder(challenge, container) {
  const shuffled = shuffle(clone(challenge.items));
  const orderState = {
    currentOrder: shuffled.slice(), // mutable working order
    checked: false,
    dragSrcIdx: null
  };

  container.innerHTML = `
    <div class="prac-card g">
      <div class="prac-card__eyebrow"><i class="fa-solid fa-arrow-up-1-9"></i> סידור</div>
      <div class="prac-card__title">${escHtml(challenge.title)}</div>
      ${challenge.description
        ? `<div class="prac-card__desc">${escHtml(challenge.description)}</div>`
        : ''}
      <div class="order-list" id="order-list"></div>
    </div>
  `;

  function renderOrderList() {
    const list = container.querySelector('#order-list');
    list.innerHTML = orderState.currentOrder.map((text, i) => `
      <div class="order-item"
           draggable="true"
           data-idx="${i}"
           aria-label="${escHtml(text)}, מיקום ${i + 1}">
        <div class="order-item__num">${i + 1}</div>
        <div class="order-item__text">${escHtml(text)}</div>
        <div class="order-item__arrows" aria-hidden="true">
          <button type="button" title="הזז למעלה"
                  onclick="orderMoveItem(${i}, -1)"
                  ${i === 0 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-up"></i>
          </button>
          <button type="button" title="הזז למטה"
                  onclick="orderMoveItem(${i}, 1)"
                  ${i === orderState.currentOrder.length - 1 ? 'disabled' : ''}>
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      </div>
    `).join('');

    attachOrderDragListeners(list, orderState, renderOrderList, challenge, container);
    if (!orderState.checked) setCheckButton(true, true);
  }

  renderOrderList();
  window._orderState = orderState; // expose for arrow button handlers
  state.active = { type: 'order', orderState, challenge, renderOrderList };
}

// Exposed globally for onclick handlers in template
window.orderMoveItem = function(fromIdx, dir) {
  if (!state.active || state.active.type !== 'order') return;
  const { orderState, renderOrderList } = state.active;
  if (orderState.checked) return;
  const toIdx = fromIdx + dir;
  if (toIdx < 0 || toIdx >= orderState.currentOrder.length) return;
  const arr = orderState.currentOrder;
  [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]];
  renderOrderList();
};

function attachOrderDragListeners(list, orderState, renderOrderList, challenge, container) {
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

    // Touch drag (mobile fallback — arrow buttons take precedence on mobile)
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
      if (Math.abs(dy) < 30) { touchStartIdx = null; return; } // tap, not drag
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
  const { orderState, challenge, renderOrderList } = state.active;
  orderState.checked = true;

  const canonical = challenge.items;
  const current   = orderState.currentOrder;
  let correctCount = 0;
  current.forEach((item, i) => {
    if (item === canonical[i]) correctCount++;
  });
  const accuracy = Math.round((correctCount / canonical.length) * 100);
  recordChallengeResult(challenge, accuracy);

  // Re-render with correct/error classes
  const list = document.querySelector('#order-list');
  if (list) {
    const items = list.querySelectorAll('.order-item');
    items.forEach((el, i) => {
      const isCorrect = current[i] === canonical[i];
      el.classList.add(isCorrect ? 'order-item--correct' : 'order-item--error');
      // Show correct position label for wrong items
      if (!isCorrect) {
        const correctPos = canonical.indexOf(current[i]) + 1;
        const lbl = document.createElement('div');
        lbl.className = 'order-result-label order-result-label--error';
        lbl.textContent = `צריך להיות במיקום ${correctPos}`;
        el.appendChild(lbl);
      }
    });
  }

  hideActionBar();
  const isCorrect = accuracy >= 80;
  const correct_text = `${correctCount}/${canonical.length} פריטים במיקום הנכון`;
  const wrong_text   = `הסדר הנכון: ${canonical.join(' ← ')}`;
  showFeedbackPanel(isCorrect, isCorrect ? correct_text : wrong_text, challenge.explanation || null, () => advanceChallenge());
}

/* ----------------------------------------------------------------
   CLOZE challenge renderer
   ---------------------------------------------------------------- */
function renderCloze(challenge, container) {
  const options = shuffle(clone(challenge.options));
  const clozeState = {
    selected: null,
    checked: false
  };

  const sentenceHtml = escHtml(challenge.sentence).replace(
    '___',
    `<span class="cloze-blank" id="cloze-blank">___</span>`
  );

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
      // Deselect all
      container.querySelectorAll('.cloze-chip').forEach(c => c.classList.remove('cloze-chip--selected'));
      // Select clicked
      chip.classList.add('cloze-chip--selected');
      clozeState.selected = chip.dataset.value;
      // Update blank
      const blank = document.getElementById('cloze-blank');
      if (blank) blank.textContent = clozeState.selected;
      // Enable check button
      setCheckButton(true, true);
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
  const accuracy  = isCorrect ? 100 : 0;
  recordChallengeResult(challenge, accuracy);

  // Update blank style
  const blank = document.getElementById('cloze-blank');
  if (blank) {
    blank.textContent = clozeState.selected;
    blank.classList.add(isCorrect ? 'cloze-blank--correct' : 'cloze-blank--error');
  }

  // Style chips
  document.querySelectorAll('.cloze-chip').forEach(chip => {
    chip.disabled = true;
    if (chip.dataset.value === challenge.correct) {
      chip.classList.add('cloze-chip--correct');
    } else if (chip.dataset.value === clozeState.selected && !isCorrect) {
      chip.classList.remove('cloze-chip--selected');
      chip.classList.add('cloze-chip--error');
    }
  });

  hideActionBar();
  const wrongMsg = `התשובה הנכונה: ${challenge.correct}`;
  showFeedbackPanel(isCorrect, isCorrect ? null : wrongMsg, challenge.explanation || null, () => advanceChallenge());
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
  const bar = document.getElementById('action-bar');
  if (bar) bar.classList.remove('prac-actions--hidden');
}

function hideActionBar() {
  const bar = document.getElementById('action-bar');
  if (bar) bar.classList.add('prac-actions--hidden');
}

/** Called when the user clicks "בדוק תשובה" */
window.checkAnswer = function() {
  if (!state.active) return;
  switch (state.active.type) {
    case 'order': checkOrderAnswer(); break;
    case 'cloze': checkClozeAnswer(); break;
    // Match is self-checking on each click — no explicit check needed
  }
};

/* ================================================================
   FEEDBACK PANEL
   ================================================================ */

/**
 * Show the slide-up feedback panel.
 * @param {boolean} isCorrect
 * @param {string|null} overrideMsg  — if null, show "מצוין!" or default wrong
 * @param {string|null} explanation  — additional explanation text
 * @param {function} onContinue      — callback when user presses "המשך"
 */
function showFeedbackPanel(isCorrect, overrideMsg, explanation, onContinue) {
  const panel  = document.getElementById('feedback-panel');
  const icon   = document.getElementById('feedback-icon');
  const verdict= document.getElementById('feedback-verdict');
  const expEl  = document.getElementById('feedback-explanation');
  const btnEl  = document.getElementById('feedback-btn');

  if (!panel) return;

  panel.className = 'prac-feedback prac-feedback--show ' + (isCorrect ? 'prac-feedback--correct' : 'prac-feedback--error');

  icon.textContent    = isCorrect ? '✓' : '✗';
  verdict.textContent = isCorrect
    ? (overrideMsg || 'מצוין!')
    : (overrideMsg || 'כמעט — ממשיכים');

  const isLastChallenge = state.currentIdx >= state.challenges.length - 1;
  expEl.textContent  = explanation || '';
  expEl.style.display = explanation ? '' : 'none';
  btnEl.textContent  = isLastChallenge ? 'לסיכום' : 'המשך';

  // Replace old listener
  const newBtn = btnEl.cloneNode(true);
  btnEl.parentNode.replaceChild(newBtn, btnEl);
  newBtn.addEventListener('click', () => {
    hideFeedback();
    onContinue();
  });
}

function hideFeedback() {
  const panel = document.getElementById('feedback-panel');
  if (panel) panel.className = 'prac-feedback';
  // Clear inner content so previous challenge's explanation doesn't leak
  // into the next challenge's panel before submit.
  const expEl = document.getElementById('feedback-explanation');
  if (expEl) { expEl.textContent = ''; expEl.style.display = 'none'; }
  const verdictEl = document.getElementById('feedback-verdict');
  if (verdictEl) verdictEl.textContent = '';
  const iconEl = document.getElementById('feedback-icon');
  if (iconEl) iconEl.textContent = '';
}

/* ================================================================
   XP & RECORDING
   ================================================================ */

function recordChallengeResult(challenge, accuracy) {
  // XP: 5 flat + up to 10 for accuracy
  const xpEarned = 5 + Math.round((accuracy / 100) * 10);
  state.sessionXP += xpEarned;
  if (accuracy >= 80) state.sessionCorrect++;

  // Persist best score per challenge
  const data = loadData();
  const prev = data.completed[challenge.id];
  if (prev === undefined || accuracy > prev) {
    data.completed[challenge.id] = accuracy;
  }
  saveData(data);

  state.challengeResults[state.currentIdx] = { accuracy, xp: xpEarned };
}

/* ================================================================
   ADVANCE / SESSION END
   ================================================================ */

function advanceChallenge() {
  const isLast = state.currentIdx >= state.challenges.length - 1;
  if (isLast) {
    endSession();
  } else {
    state.currentIdx++;
    renderChallenge();
  }
}

function endSession() {
  showView('done');
  renderDoneScreen();
  hideFeedback();
  hideActionBar();
}

/* ================================================================
   DONE VIEW
   ================================================================ */

function renderDoneScreen() {
  const elapsed = Math.round((new Date() - state.sessionStartTime) / 1000);
  const total   = state.challenges.length;
  const correct = state.sessionCorrect;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Update XP & streak in storage
  const data = loadData();
  data.xp    = (data.xp || 0) + state.sessionXP;
  const streakResult = updateStreak(data);
  saveData(data);

  // XP number
  document.getElementById('done-xp').textContent = '+' + state.sessionXP;
  document.getElementById('done-xp-sub').textContent = `${state.sessionXP} נקודות XP הרווחתם`;

  // Stats
  document.getElementById('done-correct').textContent = `${correct}/${total}`;
  document.getElementById('done-pct').textContent     = pct + '%';
  document.getElementById('done-time').textContent    = formatTime(elapsed);

  // Streak
  renderStreakBlock(streakResult, data.streak);

  // Gold particle burst
  triggerParticleBurst();
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
  // Respect reduced motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  container.innerHTML = '';
  const colors = ['#D4AF37', '#E6C65A', '#4ade80', '#2F8592', '#fff'];
  const cx = '50%';
  const cy = '40%';

  for (let i = 0; i < 22; i++) {
    const dot = document.createElement('span');
    dot.className = 'prac-done__particle';
    const angle  = (i / 22) * 360;
    const dist   = 60 + Math.random() * 80;
    const dx     = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
    const dy     = Math.round(Math.sin((angle * Math.PI) / 180) * dist);
    dot.style.cssText = `
      left: ${cx}; top: ${cy};
      background: ${colors[i % colors.length]};
      --tx: translate(${dx}px, ${dy - 40}px);
      animation-delay: ${(i * 0.03).toFixed(2)}s;
      animation-duration: ${(0.9 + Math.random() * 0.4).toFixed(2)}s;
    `;
    container.appendChild(dot);
  }
}

/* ================================================================
   SESSION REPLAY & BACK TO MENU
   ================================================================ */

window.replaySession = function() {
  // Replay with the same module index
  const moduleIdx = state.challenges[0] ? state.challenges[0].moduleIdx : 0;
  startSession(moduleIdx);
};

window.backToMenu = function() {
  renderMenu();
  showView('menu');
};

/* ================================================================
   MID-SESSION EXIT CONFIRM
   ================================================================ */

window.requestExit = function() {
  const overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.classList.add('prac-confirm-overlay--show');
};

window.confirmExit = function() {
  const overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.classList.remove('prac-confirm-overlay--show');
  hideFeedback();
  hideActionBar();
  renderMenu();
  showView('menu');
};

window.cancelExit = function() {
  const overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.classList.remove('prac-confirm-overlay--show');
};

/* ================================================================
   KEYBOARD SHORTCUTS
   ================================================================ */

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (state.view !== 'play') return;

  // Enter to continue when feedback is visible
  if (e.key === 'Enter') {
    const btn = document.getElementById('feedback-btn');
    if (btn && btn.closest('.prac-feedback--show')) { e.preventDefault(); btn.click(); return; }
    const checkBtn = document.getElementById('btn-check');
    if (checkBtn && !checkBtn.disabled) { e.preventDefault(); checkBtn.click(); }
  }

  // Escape to trigger exit confirm
  if (e.key === 'Escape') {
    const overlay = document.getElementById('confirm-overlay');
    if (overlay && overlay.classList.contains('prac-confirm-overlay--show')) {
      cancelExit();
    } else {
      requestExit();
    }
  }
});

/* ================================================================
   UTILITY: escape HTML to prevent XSS in dynamic content
   ================================================================ */

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
