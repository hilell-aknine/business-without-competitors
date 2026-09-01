/* ==========================================================================
   resume.js — "המשך מאיפה שעצרת" — the learner's real last position.

   WHY THIS EXISTS
   ---------------
   Until now the portal claimed to resume but did not. Three separate causes,
   all fixed here + in index.html:

   1. The hero CTA said "המשך מהשיעור שעצרת בו" but pointed at
      nextUncompleted() — the FIRST lesson in course order without a
      completion mark. That is not where the learner was. Anyone who jumped
      around, or who opened lesson 40 without it being marked, got sent back
      to lesson 3. The label was literally false.
   2. restoreCurrentLesson() in index.html did read `bwc_current_lesson`, but
      only to populate the breadcrumb and prev/next labels. The player was
      revealed ONLY for deep links (?module= / #lesson=). A plain visit to the
      site landed on the hero as if nothing was ever remembered.
   3. Nothing was ever stored server-side, and no video timestamp existed at
      all. New device, new browser, or a cleared cache = start from zero, and
      even a successful "resume" only meant the lesson, never the minute.

   WHAT IT OWNS
   ------------
   One record — where the learner actually was:
     { key, seconds, variant, at }
   `key`     lesson key, same vocabulary as bwc_completed ("m3-1-2" / "s2-0")
   `seconds` position inside the video, integer
   `variant` instructor variant index for lessons that have one (Tamar/Tzvika),
             so resuming does not silently switch which cut plays
   `at`      ISO timestamp — the conflict resolver between devices

   localStorage is the offline cache and always wins the write. Supabase is
   the cross-device truth and is written fire-and-forget. This mirrors the
   model already used by sync-localstorage.js — deliberately, so there are not
   two competing sync philosophies in one portal.

   FAIL-SOFT BY DESIGN
   -------------------
   Migration 008 may not have been run on the live DB yet (that is Hillel's
   approval to give, not ours). Until it is, every server call fails with
   42P01 and is swallowed: local resume keeps working perfectly, nothing is
   lost, and the console stays clean. Same pattern the onboarding questionnaire
   used while migration 006 was pending.

   API
     bwcResume.save(key, seconds, variant)  -> void   (local now, server debounced)
     bwcResume.get()                        -> record | null
     bwcResume.pull()                       -> Promise<record|null>  (server -> local)
     bwcResume.clear()                      -> void
     bwcResume.flush()                      -> Promise  (push now, e.g. on pagehide)

   Events
     'bwc:resume-ready'  detail { record, fromServer }  — a newer position was
                         adopted from the server after login.

   Load order: AFTER auth.js and supabase-config.js (same chain as sync).
   Works standalone if Supabase is absent — local-only, no errors.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.bwcResume) return;

  var LS_KEY       = 'bwc_resume_v1';
  var TABLE        = 'learner_resume';
  var PUSH_DEBOUNCE = 10000;   // don't hammer the DB while a video plays
  var MIN_SECONDS   = 8;       // below this it's a misclick, not a position

  var pushTimer   = null;
  var pushInFlight = false;
  var lastPushedSig = null;
  var serverDead  = false;     // set once the table is confirmed missing

  /* ---------------------------------------------------------------- utils */

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function parseJSON(s, fallback) {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch (_) { return fallback; }
  }

  function isValidKey(k) {
    // Same shape the rest of the portal uses. Guards against a corrupt record
    // sending selectLessonByKey() on a wild goose chase.
    return typeof k === 'string' && /^(m\d+-\d+-\d+|s\d+-\d+)$/.test(k);
  }

  function normalize(rec) {
    if (!rec || !isValidKey(rec.key)) return null;
    var secs = Number(rec.seconds);
    if (!isFinite(secs) || secs < 0) secs = 0;
    var variant = Number(rec.variant);
    return {
      key: rec.key,
      seconds: Math.floor(secs),
      variant: (isFinite(variant) && variant >= 0) ? Math.floor(variant) : null,
      at: typeof rec.at === 'string' ? rec.at : new Date(0).toISOString()
    };
  }

  function sig(rec) {
    return rec ? (rec.key + '|' + rec.seconds + '|' + rec.variant) : '';
  }

  function nowIso() { return new Date().toISOString(); }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
  }

  function sb() {
    return (window.bwcSupabase && !serverDead) ? window.bwcSupabase : null;
  }

  function currentUser() {
    try {
      var u = window.bwcAuth && window.bwcAuth.getUser();
      return (u && u.id) ? u : null;
    } catch (_) { return null; }
  }

  /* --------------------------------------------------------------- local */

  function readLocal() {
    return normalize(parseJSON(lsGet(LS_KEY), null));
  }

  function writeLocal(rec) {
    var norm = normalize(rec);
    if (!norm) return null;
    lsSet(LS_KEY, JSON.stringify(norm));
    return norm;
  }

  /* -------------------------------------------------------------- server */

  // A missing table (42P01) is an expected state until migration 008 runs.
  // Anything else is a real network/RLS problem and is worth one warning,
  // but never an exception that reaches the learner.
  function isMissingTable(error) {
    return !!error && (error.code === '42P01' ||
      (typeof error.message === 'string' && error.message.indexOf('does not exist') !== -1));
  }

  function pushNow() {
    var client = sb();
    var user = currentUser();
    var rec = readLocal();
    if (!client || !user || !rec) return Promise.resolve(null);
    if (pushInFlight) return Promise.resolve(null);
    if (sig(rec) === lastPushedSig) return Promise.resolve(null);

    pushInFlight = true;
    return client.from(TABLE).upsert({
      user_id: user.id,
      lesson_key: rec.key,
      seconds: rec.seconds,
      variant: rec.variant,
      updated_at: rec.at
    }, { onConflict: 'user_id' }).then(function (res) {
      pushInFlight = false;
      if (res && res.error) {
        if (isMissingTable(res.error)) {
          serverDead = true;   // stop trying until the next page load
        } else {
          console.warn('[resume] server save failed, keeping local only:', res.error.message);
        }
        return null;
      }
      lastPushedSig = sig(rec);
      return rec;
    }).catch(function (err) {
      pushInFlight = false;
      console.warn('[resume] server save threw, keeping local only:', err && err.message);
      return null;
    });
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; pushNow(); }, PUSH_DEBOUNCE);
  }

  function pull() {
    var client = sb();
    var user = currentUser();
    if (!client || !user) return Promise.resolve(readLocal());

    return client.from(TABLE)
      .select('lesson_key, seconds, variant, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(function (res) {
        if (res && res.error) {
          if (isMissingTable(res.error)) serverDead = true;
          return readLocal();
        }
        var row = res && res.data;
        if (!row) return readLocal();

        var remote = normalize({
          key: row.lesson_key,
          seconds: row.seconds,
          variant: row.variant,
          at: row.updated_at
        });
        if (!remote) return readLocal();

        var local = readLocal();
        // Newest wins. A learner who watched on their phone during the day
        // should not be dragged back to last night's laptop position.
        if (!local || new Date(remote.at) > new Date(local.at)) {
          writeLocal(remote);
          lastPushedSig = sig(remote);
          emit('bwc:resume-ready', { record: remote, fromServer: true });
          return remote;
        }
        return local;
      })
      .catch(function () { return readLocal(); });
  }

  /* ----------------------------------------------------------------- API */

  function save(key, seconds, variant) {
    if (!isValidKey(key)) return;
    var secs = Number(seconds);
    if (!isFinite(secs) || secs < 0) secs = 0;

    var prev = readLocal();
    // Opening a lesson counts as being there even at second 0 — that is the
    // lesson-level resume. The MIN_SECONDS floor only protects an EXISTING
    // position from being reset to ~0 by a stray load event on the same lesson.
    if (prev && prev.key === key && prev.seconds > MIN_SECONDS && secs < MIN_SECONDS) return;

    var rec = writeLocal({
      key: key,
      seconds: secs,
      variant: (variant === null || variant === undefined) ? null : variant,
      at: nowIso()
    });
    if (rec) schedulePush();
  }

  function clear() {
    lsDel(LS_KEY);
    lastPushedSig = null;
    var client = sb();
    var user = currentUser();
    if (!client || !user) return;
    client.from(TABLE).delete().eq('user_id', user.id).then(function () {}, function () {});
  }

  function flush() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return pushNow();
  }

  window.bwcResume = {
    save: save,
    get: readLocal,
    pull: pull,
    clear: clear,
    flush: flush
  };

  /* ------------------------------------------------------------ lifecycle */

  // Pull once auth resolves, and again on every login — a learner arriving on
  // a fresh device has nothing local, and that is exactly the case this whole
  // module exists for.
  function onAuth(user) {
    if (!user) return;
    serverDead = false;
    pull();
  }

  if (window.bwcAuth && typeof window.bwcAuth.onChange === 'function') {
    window.bwcAuth.onChange(onAuth);
  }
  window.addEventListener('bwc:auth-change', function (ev) {
    onAuth(ev && ev.detail && ev.detail.user);
  });
  // auth may already have resolved before this file ran.
  if (currentUser()) pull();

  // Closing the tab is the single most common way a position is lost.
  // visibilitychange fires reliably on mobile Safari where pagehide does not.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', function () { flush(); });
})();
