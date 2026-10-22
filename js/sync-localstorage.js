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

   2026-10-22: quiz_scores + practice_stats now use the same model (see the
   QUIZ + PRACTICE section below). The old one-time bulk push guarded by
   `bwc_synced_at_<userId>` is gone: every page load / login does a real
   pull + merge, and every change is pushed with retry.

   Sources -> tables:
     bwc_completed       (string[] of lesson keys)       <-> course_progress
     bwc_quiz_scores     ({ [moduleIdx]: scoreObj })      <-> quiz_scores
     bwc_practice_v1     ({ xp, streak, lastDate, ... })  <-> practice_stats

   localStorage keys owned here:
     bwc_completed            string[]  — canonical local lesson list
     bwc_sync_queue_v1        { [lessonKey]: 'add' | 'del' } — pending server ops
     bwc_sync_dirty_v1        { quiz?, practice? } — tables with unpushed changes

   Public API (window.bwcSync):
     markLesson(key, done)  -> string[]   local write + queue + debounced push
     getCompleted()         -> string[]
     pullMerge()            -> Promise<string[]>  two-way merge with the server
     flush()                -> Promise<{ok}>      drain the pending queue now
     pendingCount()         -> number
     markDirty('quiz'|'practice')  local state changed, push it (debounced)
     pullTables()           -> Promise  pull + merge quiz/practice, then push
     flushTables()          -> Promise  push dirty quiz/practice now
     dirtyCount()           -> number

   Events:
     'bwc:sync-done'   detail { merged, allOk, results }  — after a lesson pull+merge
     'bwc:sync-push'   detail { ok, pending }             — after a queue flush
     'bwc:sync-tables' detail { quiz, practice, ok }      — after a quiz/practice pull

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

  var COMPLETED_KEY = 'bwc_completed';
  var QUEUE_KEY     = 'bwc_sync_queue_v1';

  var FLUSH_DELAY   = 700;      // debounce after a mark/unmark
  var RETRY_MIN     = 8000;     // first retry after a failed push
  var RETRY_MAX     = 300000;   // cap the backoff at 5 minutes

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
     QUIZ + PRACTICE — continuous two-way sync (2026-10-22).

     Before: quiz.html and practice.js each fired one upsert per change,
     with no retry and no ordering, and the only bulk push was a ONE-TIME
     rescue guarded by `bwc_synced_at_<uid>`. Three measured problems:
       1. A failed write (offline, expired token, tab closed mid-request)
          was simply lost. Nothing ever tried again.
       2. quiz.html's merge did `attempts = local + remote` on every page
          load, so attempts doubled each visit, and the merged result was
          never written back to the server.
       3. practice.js fired overlapping upserts; an older one could land
          last and overwrite newer XP.
     Now both tables work like lessons: every change marks the table dirty
     (persisted in localStorage), a debounced, serialized flush pushes the
     CURRENT local state, failures stay dirty and are retried with backoff,
     and on load / login we pull + merge so a new device gets everything
     without overwriting newer progress on either side.

     Merge rules (never lose progress, newest wins only for "last" values):
       quiz:     best=max · attempts=max · passed=OR · lastScore/total from
                 the newer entry (local.updatedAt vs row.updated_at)
       practice: xp=max · completed=union(max accuracy) · lastDate=newer ·
                 streak from the side with the newer lastDate (max on tie) ·
                 longest=max of everything
     ============================================================ */

  var QUIZ_KEY     = 'bwc_quiz_scores';
  var PRACTICE_KEY = 'bwc_practice_v1';
  var DIRTY_KEY    = 'bwc_sync_dirty_v1';   // { quiz?: stamp, practice?: stamp }
  var TABLE_DELAY  = 1200;

  var tableTimer = null;
  var tableRetryTimer = null;
  var tableRetryDelay = RETRY_MIN;
  var tableInFlight = false;
  var tableAgain = false;
  var tablesPullInFlight = null;

  function readDirty() {
    var d = parseJSON(lsGet(DIRTY_KEY), {});
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  }
  function writeDirty(d) { lsSet(DIRTY_KEY, JSON.stringify(d)); }

  var dirtySeq = 0;
  function markDirty(name) {
    if (name !== 'quiz' && name !== 'practice') return;
    var d = readDirty();
    d[name] = Date.now() + '.' + (++dirtySeq);   // unique stamp per change
    writeDirty(d);
    resetTableRetry();
    scheduleTableFlush();
  }
  // Clear only if nothing changed since we read the stamp we just pushed.
  function clearDirty(name, stamp) {
    var d = readDirty();
    if (d[name] === stamp) { delete d[name]; writeDirty(d); }
  }
  function dirtyCount() { return Object.keys(readDirty()).length; }

  function scheduleTableFlush(delay) {
    if (tableTimer) clearTimeout(tableTimer);
    tableTimer = setTimeout(function () {
      tableTimer = null;
      flushTables();
    }, typeof delay === 'number' ? delay : TABLE_DELAY);
  }
  function scheduleTableRetry() {
    if (tableRetryTimer) return;
    var delay = tableRetryDelay;
    tableRetryDelay = Math.min(tableRetryDelay * 2, RETRY_MAX);
    tableRetryTimer = setTimeout(function () {
      tableRetryTimer = null;
      flushTables();
    }, delay);
  }
  function resetTableRetry() {
    tableRetryDelay = RETRY_MIN;
    if (tableRetryTimer) { clearTimeout(tableRetryTimer); tableRetryTimer = null; }
  }

  function clampSmallInt(v, fallback) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback || 0;
    if (n < 0) return 0;
    if (n > 32767) return 32767;
    return n;
  }
  function clampInt(v) {
    var n = parseInt(v, 10);
    return (Number.isFinite(n) && n > 0) ? Math.min(n, 2000000000) : 0;
  }
  function ts(v) {
    var t = v ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? t : 0;
  }
  function validDate(s) {
    return (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : null;
  }

  /* ---- quiz ---- */

  function readQuiz() {
    var obj = parseJSON(lsGet(QUIZ_KEY), {});
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  }

  function quizRows(userId) {
    var obj = readQuiz();
    var rows = [];
    Object.keys(obj).forEach(function (k) {
      var idx = parseInt(k, 10);
      var s = obj[k];
      if (!Number.isFinite(idx) || idx < 0 || idx > 7 || !s || typeof s !== 'object') return;
      rows.push({
        user_id: userId,
        module_idx: idx,
        best_score: clampSmallInt(s.best),
        attempts: clampSmallInt(s.attempts),
        passed: !!s.passed,
        last_score: clampSmallInt(s.lastScore),
        total: clampSmallInt(s.total, 5) || 5,
        updated_at: s.updatedAt || new Date().toISOString()
      });
    });
    return rows;
  }

  // Returns { merged, localChanged, needsPush }.
  function mergeQuiz(local, rows) {
    var merged = {};
    var byIdx = {};
    var needsPush = false;
    (rows || []).forEach(function (r) {
      if (r && Number.isFinite(r.module_idx)) byIdx[r.module_idx] = r;
    });
    var keys = {};
    Object.keys(local).forEach(function (k) { keys[k] = true; });
    Object.keys(byIdx).forEach(function (k) { keys[k] = true; });

    Object.keys(keys).forEach(function (k) {
      var L = local[k];
      var R = byIdx[k];
      if (L && typeof L !== 'object') L = null;
      if (!R) { if (L) { merged[k] = L; needsPush = true; } return; }
      var Rl = {
        best: R.best_score || 0, attempts: R.attempts || 0, passed: !!R.passed,
        lastScore: R.last_score || 0, total: R.total || 5, updatedAt: R.updated_at || null
      };
      if (!L) { merged[k] = Rl; return; }
      var localNewer = ts(L.updatedAt) > ts(Rl.updatedAt);
      var newer = localNewer ? L : Rl;
      var m = {
        best: Math.max(L.best || 0, Rl.best),
        attempts: Math.max(L.attempts || 0, Rl.attempts),
        passed: !!(L.passed || Rl.passed),
        lastScore: (newer.lastScore != null) ? newer.lastScore : 0,
        total: newer.total || L.total || Rl.total || 5,
        updatedAt: newer.updatedAt || null
      };
      merged[k] = m;
      if (m.best > Rl.best || m.attempts > Rl.attempts || (m.passed && !Rl.passed) || localNewer) {
        needsPush = true;
      }
    });

    var localChanged = JSON.stringify(merged) !== JSON.stringify(local);
    return { merged: merged, localChanged: localChanged, needsPush: needsPush };
  }

  /* ---- practice ---- */

  function readPractice() {
    var p = parseJSON(lsGet(PRACTICE_KEY), null);
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null;
  }

  function practiceRow(userId) {
    var p = readPractice();
    if (!p) return null;
    var streak = clampInt(p.streak);
    return {
      user_id: userId,
      total_xp: clampInt(p.xp),
      current_streak: streak,
      longest_streak: Math.max(streak, clampInt(p.longest)),
      last_practice_date: validDate(p.lastDate),
      challenges_completed: (p.completed && typeof p.completed === 'object' && !Array.isArray(p.completed)) ? p.completed : {},
      updated_at: new Date().toISOString()
    };
  }

  function mergePractice(local, row) {
    local = local || {};
    if (!row) {
      var has = clampInt(local.xp) > 0 || clampInt(local.streak) > 0 ||
        !!(local.completed && Object.keys(local.completed).length > 0);
      return { merged: local, localChanged: false, needsPush: has };
    }
    var R = {
      xp: row.total_xp || 0,
      streak: row.current_streak || 0,
      longest: row.longest_streak || 0,
      lastDate: validDate(row.last_practice_date),
      completed: (row.challenges_completed && typeof row.challenges_completed === 'object') ? row.challenges_completed : {}
    };
    var L = {
      xp: clampInt(local.xp),
      streak: clampInt(local.streak),
      longest: clampInt(local.longest),
      lastDate: validDate(local.lastDate),
      completed: (local.completed && typeof local.completed === 'object') ? local.completed : {}
    };

    var lastDate, streak;
    if (L.lastDate && R.lastDate && L.lastDate !== R.lastDate) {
      var localNewer = L.lastDate > R.lastDate;
      lastDate = localNewer ? L.lastDate : R.lastDate;
      streak = localNewer ? L.streak : R.streak;
    } else {
      lastDate = L.lastDate || R.lastDate || null;
      streak = Math.max(L.streak, R.streak);
    }

    var completed = {};
    var changedCompleted = false;
    Object.keys(R.completed).forEach(function (k) { completed[k] = R.completed[k]; });
    Object.keys(L.completed).forEach(function (k) {
      var lv = Number(L.completed[k]) || 0;
      var rv = (k in R.completed) ? (Number(R.completed[k]) || 0) : -1;
      if (lv > rv) { completed[k] = L.completed[k]; changedCompleted = true; }
    });

    var xp = Math.max(L.xp, R.xp);
    var longest = Math.max(L.longest, R.longest, streak);

    // Spread local first so local-only fields (dailyPlay, weekly...) survive.
    var merged = Object.assign({}, local, {
      xp: xp, streak: streak, lastDate: lastDate, completed: completed, longest: longest
    });

    var needsPush = xp > R.xp || streak !== R.streak || lastDate !== R.lastDate ||
      longest > R.longest || changedCompleted;
    var localChanged = JSON.stringify(merged) !== JSON.stringify(local);
    return { merged: merged, localChanged: localChanged, needsPush: needsPush };
  }

  /* ---- push ---- */

  async function flushTables() {
    if (tableInFlight) { tableAgain = true; return { ok: false, reason: 'busy' }; }
    var user = currentUser();
    if (!user) return { ok: false, reason: 'guest', pending: dirtyCount() };
    var d = readDirty();
    if (!d.quiz && !d.practice) return { ok: true, empty: true, pending: 0 };

    tableInFlight = true;
    var failed = false;
    try {
      await ensureProfile();

      if (d.quiz) {
        var stampQ = d.quiz;
        var rows = quizRows(user.id);
        try {
          if (rows.length) {
            var qr = await sb.from('quiz_scores').upsert(rows, { onConflict: 'user_id,module_idx' });
            if (qr && qr.error) throw qr.error;
          }
          clearDirty('quiz', stampQ);
        } catch (e) { failed = true; logError('quiz_scores upsert', e); }
      }

      if (d.practice) {
        var stampP = d.practice;
        var prow = practiceRow(user.id);
        try {
          if (prow) {
            var pr = await sb.from('practice_stats').upsert(prow, { onConflict: 'user_id' });
            if (pr && pr.error) throw pr.error;
          }
          clearDirty('practice', stampP);
        } catch (e2) { failed = true; logError('practice_stats upsert', e2); }
      }
    } finally {
      tableInFlight = false;
    }

    var left = dirtyCount();
    if (tableAgain) { tableAgain = false; scheduleTableFlush(0); }
    else if (failed || left > 0) scheduleTableRetry();
    else resetTableRetry();
    emit('bwc:sync-push', { ok: !failed, pending: left + pendingCount(), tables: true });
    return { ok: !failed, pending: left };
  }

  /* ---- pull + merge ---- */

  async function pullQuiz() {
    var user = currentUser();
    if (!user) return { changed: false };
    var res = await sb.from('quiz_scores')
      .select('module_idx, best_score, attempts, passed, last_score, total, updated_at')
      .eq('user_id', user.id);
    if (res && res.error) throw res.error;
    var r = mergeQuiz(readQuiz(), res.data || []);
    if (r.localChanged) lsSet(QUIZ_KEY, JSON.stringify(r.merged));
    if (r.needsPush) { var dd = readDirty(); dd.quiz = dd.quiz || ('pull.' + Date.now()); writeDirty(dd); }
    return { changed: r.localChanged };
  }

  async function pullPractice() {
    var user = currentUser();
    if (!user) return { changed: false };
    var res = await sb.from('practice_stats').select('*').eq('user_id', user.id).maybeSingle();
    if (res && res.error) throw res.error;
    var local = readPractice();
    var r = mergePractice(local, res.data || null);
    if (r.localChanged) lsSet(PRACTICE_KEY, JSON.stringify(r.merged));
    if (r.needsPush) { var dd = readDirty(); dd.practice = dd.practice || ('pull.' + Date.now()); writeDirty(dd); }
    return { changed: r.localChanged };
  }

  // Pull + merge both tables, then push whatever the server is missing.
  // Concurrent callers share one run.
  function pullTables() {
    if (tablesPullInFlight) return tablesPullInFlight;
    tablesPullInFlight = (async function () {
      var out = { quiz: false, practice: false, ok: true };
      if (!currentUser()) return out;
      await ensureProfile();
      try { out.quiz = (await pullQuiz()).changed; }
      catch (e) { out.ok = false; logError('quiz_scores select', e); }
      try { out.practice = (await pullPractice()).changed; }
      catch (e2) { out.ok = false; logError('practice_stats select', e2); }
      await flushTables();
      emit('bwc:sync-tables', out);
      return out;
    })();
    tablesPullInFlight.then(function () { tablesPullInFlight = null; },
                            function () { tablesPullInFlight = null; });
    return tablesPullInFlight;
  }

  /* ------------------------------------------------------------ triggers */

  // A user became present (page load with a session, or a fresh login).
  window.bwcAuth.onChange(function (user) {
    if (!user || !user.id) return;
    profileEnsured = false;   // new identity — re-verify the profiles row
    resetRetry();
    resetTableRetry();
    pullMerge();              // lessons: real two-way merge, every time
    pullTables();             // quiz + practice: same, every time
  });

  function flushAll() {
    resetRetry();
    resetTableRetry();
    if (pendingCount() > 0) flush();
    if (dirtyCount() > 0) flushTables();
  }

  // Back online after a dropped connection — push whatever is queued.
  try { window.addEventListener('online', flushAll); } catch (_) {}

  // Tab became visible again (mobile users background the browser mid-lesson).
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') flushAll();
    });
  } catch (_) {}

  // Last-chance push when the page is being closed. Best effort.
  try {
    window.addEventListener('pagehide', function () {
      if (pendingCount() > 0) flush();
      if (dirtyCount() > 0) flushTables();
    });
  } catch (_) {}

  window.bwcSync = Object.freeze({
    markLesson: markLesson,
    getCompleted: getCompleted,
    pullMerge: pullMerge,
    flush: flush,
    pendingCount: pendingCount,
    markDirty: markDirty,
    flushTables: flushTables,
    pullTables: pullTables,
    dirtyCount: dirtyCount,
    // Kept for older callers: the one-time rescue is now a full pull+merge.
    runOnce: function () { return pullTables(); },
    isSynced: function () { return dirtyCount() === 0 && pendingCount() === 0; }
  });
})();
