/* ==========================================================================
   sync-localstorage.js — One-time push of localStorage data to Supabase.

   Triggered automatically the first time a logged-in user is observed on this
   device. After a successful run, sets `bwc_synced_at_<userId>` so we never
   re-sync the same (device, user) pair. localStorage is left untouched so the
   site continues to work offline / with stale data.

   Sources -> tables:
     bwc_completed       (string[] of lesson keys)        -> course_progress
     bwc_quiz_scores     ({ [moduleIdx]: scoreObj })      -> quiz_scores
     bwc_practice_v1     ({ xp, streak, lastDate, ... }) -> practice_stats

   Strategy: best-effort upserts. Any partial failure leaves the flag unset so
   the next sign-in retries. Each table is independent.

   Loading order: must come AFTER auth.js (uses bwcAuth.onChange).
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.bwcSync) return;
  if (!window.bwcSupabase || !window.bwcAuth) {
    console.error('[sync] requires bwcSupabase + bwcAuth. Check script load order.');
    return;
  }

  var sb = window.bwcSupabase;
  var FLAG_PREFIX = 'bwc_synced_at_';
  var inFlight = false;

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function parseJSON(s, fallback) {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function isAlreadySynced(userId) {
    return !!lsGet(FLAG_PREFIX + userId);
  }

  function markSynced(userId) {
    try { localStorage.setItem(FLAG_PREFIX + userId, new Date().toISOString()); } catch (_) {}
  }

  /* ---- Per-table sync functions. Each returns Promise<{ ok, label, error? }>. ---- */

  async function syncCompleted(userId) {
    var arr = parseJSON(lsGet('bwc_completed'), []);
    if (!Array.isArray(arr) || arr.length === 0) return { ok: true, label: 'completed', skipped: true };
    var rows = arr
      .filter(function (k) { return typeof k === 'string' && k.length > 0 && k.length < 200; })
      .map(function (k) { return { user_id: userId, lesson_key: k }; });
    if (rows.length === 0) return { ok: true, label: 'completed', skipped: true };
    try {
      var res = await sb.from('course_progress').upsert(rows, { onConflict: 'user_id,lesson_key' });
      if (res.error) throw res.error;
      return { ok: true, label: 'completed', count: rows.length };
    } catch (e) {
      return { ok: false, label: 'completed', error: e };
    }
  }

  async function syncQuizScores(userId) {
    var obj = parseJSON(lsGet('bwc_quiz_scores'), {});
    if (!obj || typeof obj !== 'object') return { ok: true, label: 'quiz_scores', skipped: true };
    var rows = Object.keys(obj).reduce(function (acc, k) {
      var idx = parseInt(k, 10);
      var s = obj[k];
      if (!Number.isFinite(idx) || idx < 0 || idx > 7 || !s || typeof s !== 'object') return acc;
      acc.push({
        user_id: userId,
        module_idx: idx,
        best_score: clampSmallInt(s.best),
        attempts: clampSmallInt(s.attempts),
        passed: !!s.passed,
        last_score: clampSmallInt(s.lastScore),
        total: clampSmallInt(s.total, 5)
      });
      return acc;
    }, []);
    if (rows.length === 0) return { ok: true, label: 'quiz_scores', skipped: true };
    try {
      var res = await sb.from('quiz_scores').upsert(rows, { onConflict: 'user_id,module_idx' });
      if (res.error) throw res.error;
      return { ok: true, label: 'quiz_scores', count: rows.length };
    } catch (e) {
      return { ok: false, label: 'quiz_scores', error: e };
    }
  }

  function clampSmallInt(v, fallback) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback || 0;
    if (n < 0) return 0;
    if (n > 32767) return 32767;
    return n;
  }

  async function syncPractice(userId) {
    var p = parseJSON(lsGet('bwc_practice_v1'), null);
    if (!p || typeof p !== 'object') return { ok: true, label: 'practice', skipped: true };
    var hasData = (parseInt(p.xp, 10) > 0) || (parseInt(p.streak, 10) > 0) || (p.completed && Object.keys(p.completed).length > 0);
    if (!hasData) return { ok: true, label: 'practice', skipped: true };
    var row = {
      user_id: userId,
      total_xp: Math.max(0, parseInt(p.xp, 10) || 0),
      current_streak: Math.max(0, parseInt(p.streak, 10) || 0),
      longest_streak: Math.max(0, parseInt(p.streak, 10) || 0),
      last_practice_date: typeof p.lastDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.lastDate) ? p.lastDate : null,
      challenges_completed: (p.completed && typeof p.completed === 'object') ? p.completed : {}
    };
    try {
      var res = await sb.from('practice_stats').upsert(row, { onConflict: 'user_id' });
      if (res.error) throw res.error;
      return { ok: true, label: 'practice', count: 1 };
    } catch (e) {
      return { ok: false, label: 'practice', error: e };
    }
  }

  async function runOnce(userId) {
    if (!userId || inFlight) return null;
    if (isAlreadySynced(userId)) return { skipped: true };
    inFlight = true;
    try {
      var results = await Promise.all([
        syncCompleted(userId),
        syncQuizScores(userId),
        syncPractice(userId)
      ]);
      var allOk = results.every(function (r) { return r && r.ok; });
      if (allOk) {
        markSynced(userId);
        console.info('[sync] localStorage -> Supabase OK', results);
      } else {
        console.warn('[sync] partial failure, will retry next sign-in', results);
      }
      try {
        window.dispatchEvent(new CustomEvent('bwc:sync-done', { detail: { allOk: allOk, results: results } }));
      } catch (_) {}
      return { allOk: allOk, results: results };
    } finally {
      inFlight = false;
    }
  }

  /* ---- Auto-trigger on auth change (when a user becomes present). ---- */
  window.bwcAuth.onChange(function (user) {
    if (!user || !user.id) return;
    runOnce(user.id);
  });

  window.bwcSync = Object.freeze({
    runOnce: runOnce,
    isSynced: isAlreadySynced
  });
})();
