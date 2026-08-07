/* ==========================================================================
   sync-localstorage.js — Two-way progress sync: localStorage <-> Supabase.

   HISTORY / WHY THIS WAS REWRITTEN (2026-08-07)
   ---------------------------------------------
   The original version was a ONE-TIME push: it ran on the first auth change
   for a (device, user) pair, wrote `bwc_synced_at_<userId>`, and then never
   ran again. Combined with the fact that `markCurrentComplete()` in
   index.html only ever wrote localStorage, the practical result was:
   a learner's lessons stopped reaching the server right after their first
   login. Progress looked fine on the device and was empty everywhere else.

   This file is now the single sync engine for LESSON progress:
     * every mark / unmark is queued and pushed to `course_progress` in
       near-real-time (debounced ~700ms),
     * a failed push stays in the queue and is retried (never loses local data),
     * on load / login we do a proper two-way merge (union) so neither side
       loses progress,
     * un-marking propagates as a DELETE (was a known gap), and a pending
       delete acts as a tombstone so the pull can't resurrect it.

   quiz_scores + practice_stats already have their own live upserts
   (pages/quiz.html, js/practice.js). Their one-time bulk push for legacy
   localStorage-only users is kept here, still guarded by the old flag.

   Sources -> tables:
     bwc_completed       (string[] of lesson keys)       <-> course_progress
     bwc_quiz_scores     ({ [moduleIdx]: scoreObj })      -> quiz_scores   (bulk, once)
     bwc_practice_v1     ({ xp, streak, lastDate, ... })  -> practice_stats (bulk, once)

   localStorage keys owned here:
     bwc_completed            string[]  — canonical local lesson list
     bwc_sync_queue_v1        { [lessonKey]: 'add' | 'del' } — pending server ops
     bwc_synced_at_<userId>   ISO string — legacy one-time bulk-push flag

   Public API (window.bwcSync):
     markLesson(key, done)  -> string[]   local write + queue + debounced push
     getCompleted()         -> string[]
     pullMerge()            -> Promise<string[]>  two-way merge with the server
     flush()                -> Promise<{ok}>      drain the pending queue now
     pendingCount()         -> number
     runOnce(userId)        -> Promise            legacy quiz/practice bulk push
     isSynced(userId)       -> boolean

   Events:
     'bwc:sync-done'  detail { merged, allOk, results }  — after a pull+merge
     'bwc:sync-push'  detail { ok, pending }             — after a queue flush

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

  var FLAG_PREFIX   = 'bwc_synced_at_';
  var COMPLETED_KEY = 'bwc_completed';
  var QUEUE_KEY     = 'bwc_sync_queue_v1';

  var FLUSH_DELAY   = 700;      // debounce after a mark/unmark
  var RETRY_MIN     = 8000;     // first retry after a failed push
  var RETRY_MAX     = 300000;   // cap the backoff at 5 minutes

  var bulkInFlight  = false;
  var flushInFlight = false;
  var pullInFlight  = false;
  var flushTimer    = null;
  var retryTimer    = null;
  var retryDelay    = RETRY_MIN;
  var profileEnsured = false;

  /* ---------------------------------------------------------------- utils */

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function parseJSON(s, fallback) {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function isValidKey(k) {
    return typeof k === 'string' && k.length > 0 && k.length < 200;
  }

  function currentUser() {
    try {
      var u = window.bwcAuth.getUser();
      return (u && u.id) ? u : null;
    } catch (_) { return null; }
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
  }

  /* ------------------------------------------------- local completed list */

  function getCompleted() {
    var arr = parseJSON(lsGet(COMPLETED_KEY), []);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidKey);
  }

  function setCompleted(list) {
    lsSet(COMPLETED_KEY, JSON.stringify(list));
  }

  /* --------------------------------------------------------- pending queue
     Shape: { "m0-0-1": "add", "m2-1-3": "del" }
     The queue is the ONLY thing that can be lost on a network failure —
     localStorage itself is written first and never rolled back. */

  function readQueue() {
    var q = parseJSON(lsGet(QUEUE_KEY), {});
    return (q && typeof q === 'object' && !Array.isArray(q)) ? q : {};
  }

  function writeQueue(q) {
    lsSet(QUEUE_KEY, JSON.stringify(q));
  }

  function queueOp(key, op) {
    if (!isValidKey(key)) return;
    var q = readQueue();
    q[key] = op;                 // last write wins: add then del => del
    writeQueue(q);
  }

  // Remove only the entries we actually sent AND that still carry the same op.
  // If the learner re-toggled the same lesson mid-request, the newer op stays.
  function clearQueueEntries(keys, op) {
    if (!keys || !keys.length) return;
    var q = readQueue();
    var changed = false;
    for (var i = 0; i < keys.length; i++) {
      if (q[keys[i]] === op) { delete q[keys[i]]; changed = true; }
    }
    if (changed) writeQueue(q);
  }

  function pendingCount() {
    return Object.keys(readQueue()).length;
  }

  /* -------------------------------------------------------- profile guard
     course_progress / quiz_scores / practice_stats all FK-reference
     public.profiles(id). The auto-profile trigger only fires on auth.users
     INSERT, so OAuth users (or accounts predating the trigger) have no
     profiles row and every write fails with FK violation 23503.
     ensure_profile() (migration 003) is a SECURITY DEFINER RPC that
     self-heals the row. Called once per page session. */
  async function ensureProfile() {
    if (profileEnsured) return;
    try {
      var res = await sb.rpc('ensure_profile');
      if (res && res.error) {
        console.warn('[sync] ensure_profile RPC failed (run migration 003?)',
          { code: res.error.code, message: res.error.message });
        return; // don't memoize a failure — retry on the next write
      }
      profileEnsured = true;
    } catch (e) {
      console.warn('[sync] ensure_profile threw', e);
    }
  }

  /* ------------------------------------------------------------- flushing */

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, FLUSH_DELAY);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    var delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
    retryTimer = setTimeout(function () {
      retryTimer = null;
      flush();
    }, delay);
  }

  function resetRetry() {
    retryDelay = RETRY_MIN;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  /* Drain the pending queue to course_progress.
     Adds are batched into one upsert, deletes into one delete .in(...).
     ignoreDuplicates keeps the original completed_at on a re-push. */
  async function flush() {
    if (flushInFlight) return { ok: false, reason: 'busy' };

    var user = currentUser();
    if (!user) return { ok: false, reason: 'guest', pending: pendingCount() };

    var q = readQueue();
    var adds = [];
    var dels = [];
    Object.keys(q).forEach(function (k) {
      if (!isValidKey(k)) return;
      if (q[k] === 'add') adds.push(k);
      else if (q[k] === 'del') dels.push(k);
    });
    if (!adds.length && !dels.length) return { ok: true, empty: true, pending: 0 };

    flushInFlight = true;
    var failed = false;

    try {
      await ensureProfile();

      if (adds.length) {
        var rows = adds.map(function (k) { return { user_id: user.id, lesson_key: k }; });
        try {
          var addRes = await sb
            .from('course_progress')
            .upsert(rows, { onConflict: 'user_id,lesson_key', ignoreDuplicates: true });
          if (addRes && addRes.error) throw addRes.error;
          clearQueueEntries(adds, 'add');
        } catch (e) {
          failed = true;
          logError('course_progress upsert', e);
        }
      }

      if (dels.length) {
        try {
          var delRes = await sb
            .from('course_progress')
            .delete()
            .eq('user_id', user.id)
            .in('lesson_key', dels);
          if (delRes && delRes.error) throw delRes.error;
          clearQueueEntries(dels, 'del');
        } catch (e2) {
          failed = true;
          logError('course_progress delete', e2);
        }
      }
    } finally {
      flushInFlight = false;
    }

    var left = pendingCount();
    if (failed || left > 0) scheduleRetry(); else resetRetry();
    emit('bwc:sync-push', { ok: !failed, pending: left });
    return { ok: !failed, pending: left };
  }

  function logError(label, e) {
    e = e || {};
    console.warn('[sync] ' + label + ' failed — kept in local queue, will retry', {
      code: e.code, message: e.message, details: e.details, hint: e.hint
    });
  }

  /* ------------------------------------------------------ mark / un-mark */

  /* Mark (or un-mark) a lesson. localStorage is written synchronously and is
     never rolled back, so a network failure can only delay the server, never
     lose the learner's click. Returns the new completed array. */
  function markLesson(key, done) {
    if (!isValidKey(key)) return getCompleted();
    var list = getCompleted();
    var idx = list.indexOf(key);

    if (done !== false) {
      if (idx === -1) list.push(key);
    } else {
      if (idx !== -1) list.splice(idx, 1);
    }
    setCompleted(list);

    queueOp(key, (done !== false) ? 'add' : 'del');
    resetRetry();
    scheduleFlush();
    return list;
  }

  /* -------------------------------------------------------- pull + merge */

  /* Two-way merge with the server:
       merged = (local UNION remote) MINUS pending deletes
     Local order is preserved (index.html uses the tail of the array for
     "continue where you left off"); remote-only keys are appended.
     Anything that exists locally but not remotely is queued for push. */
  async function pullMerge() {
    var user = currentUser();
    if (!user) return getCompleted();
    if (pullInFlight) return getCompleted();

    pullInFlight = true;
    try {
      await ensureProfile();

      var res;
      try {
        res = await sb.from('course_progress').select('lesson_key').eq('user_id', user.id);
        if (res && res.error) throw res.error;
      } catch (e) {
        logError('course_progress select', e);
        await flush();               // still try to push whatever is pending
        return getCompleted();
      }

      var remote = (res.data || [])
        .map(function (r) { return r && r.lesson_key; })
        .filter(isValidKey);

      var q = readQueue();
      var local = getCompleted();

      var seen = {};
      var merged = [];
      function add(k) {
        if (q[k] === 'del') return;  // tombstone — do not resurrect
        if (seen[k]) return;
        seen[k] = true;
        merged.push(k);
      }
      local.forEach(add);
      remote.forEach(add);

      // Drop anything the learner un-marked while the delete is still pending.
      var localChanged = (merged.length !== local.length);
      if (!localChanged) {
        for (var i = 0; i < merged.length; i++) {
          if (merged[i] !== local[i]) { localChanged = true; break; }
        }
      }
      if (localChanged) setCompleted(merged);

      // Queue every key the server doesn't have yet.
      var remoteSet = {};
      remote.forEach(function (k) { remoteSet[k] = true; });
      merged.forEach(function (k) { if (!remoteSet[k]) queueOp(k, 'add'); });

      var pushRes = await flush();

      emit('bwc:sync-done', {
        merged: merged,
        allOk: !!(pushRes && pushRes.ok !== false),
        results: [{ ok: true, label: 'completed', count: merged.length }]
      });

      return merged;
    } finally {
      pullInFlight = false;
    }
  }

  /* ============================================================
     LEGACY ONE-TIME BULK PUSH — quiz_scores + practice_stats only.
     Both tables now have their own live upserts (pages/quiz.html,
     js/practice.js); this only rescues data that was collected
     before the learner ever signed in on this device.
     ============================================================ */

  function clampSmallInt(v, fallback) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback || 0;
    if (n < 0) return 0;
    if (n > 32767) return 32767;
    return n;
  }

  function isAlreadySynced(userId) {
    return !!lsGet(FLAG_PREFIX + userId);
  }

  function markSynced(userId) {
    lsSet(FLAG_PREFIX + userId, new Date().toISOString());
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

  async function syncPractice(userId) {
    var p = parseJSON(lsGet('bwc_practice_v1'), null);
    if (!p || typeof p !== 'object') return { ok: true, label: 'practice', skipped: true };
    var hasData = (parseInt(p.xp, 10) > 0) || (parseInt(p.streak, 10) > 0) ||
      (p.completed && Object.keys(p.completed).length > 0);
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

  function logFailures(results) {
    results.forEach(function (r) {
      if (r && !r.ok && r.error) {
        var e = r.error;
        console.error('[sync] FAILED table "' + r.label + '" ->', {
          code: e.code, message: e.message, details: e.details, hint: e.hint
        });
      }
    });
  }

  async function runOnce(userId) {
    if (!userId || bulkInFlight) return null;
    if (isAlreadySynced(userId)) return { skipped: true };
    bulkInFlight = true;
    try {
      await ensureProfile();
      var results = await Promise.all([
        syncQuizScores(userId),
        syncPractice(userId)
      ]);
      var allOk = results.every(function (r) { return r && r.ok; });
      if (allOk) {
        markSynced(userId);
        console.info('[sync] one-time quiz/practice push OK', results);
      } else {
        console.warn('[sync] one-time push partial failure, will retry next sign-in', results);
        logFailures(results);
      }
      return { allOk: allOk, results: results };
    } finally {
      bulkInFlight = false;
    }
  }

  /* ------------------------------------------------------------ triggers */

  // A user became present (page load with a session, or a fresh login).
  window.bwcAuth.onChange(function (user) {
    if (!user || !user.id) return;
    profileEnsured = false;   // new identity — re-verify the profiles row
    resetRetry();
    runOnce(user.id);         // legacy quiz/practice rescue (one time)
    pullMerge();              // lessons: real two-way merge, every time
  });

  // Back online after a dropped connection — push whatever is queued.
  try {
    window.addEventListener('online', function () {
      resetRetry();
      flush();
    });
  } catch (_) {}

  // Tab became visible again (mobile users background the browser mid-lesson).
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && pendingCount() > 0) {
        resetRetry();
        flush();
      }
    });
  } catch (_) {}

  // Last-chance push when the page is being closed. keepalive-style best effort.
  try {
    window.addEventListener('pagehide', function () {
      if (pendingCount() > 0) flush();
    });
  } catch (_) {}

  window.bwcSync = Object.freeze({
    markLesson: markLesson,
    getCompleted: getCompleted,
    pullMerge: pullMerge,
    flush: flush,
    pendingCount: pendingCount,
    runOnce: runOnce,
    isSynced: isAlreadySynced
  });
})();
