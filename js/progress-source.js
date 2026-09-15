/* ==========================================================================
   progress-source.js — the single source of truth for "how far along am I".

   Before this file, four screens each answered that question their own way and
   disagreed with each other:

     • index.html counted only lessons that HAVE a video (131) — correct, because
       a lesson with no video cannot be marked complete.
     • progress.html counted every day plus every seminar part (132) — it
       included `m6-2-4`, the AI-tool item that carries no videoId. A learner who
       finished the whole course saw "131 / 132" forever and never reached 100%.
     • practice-league.js divided by a hardcoded 132.
     • The streak was stored TWICE, in two keys, with two different day
       boundaries: index.html used `bwc_streak` with the visitor's machine clock
       (`new Date().toDateString()`), practice.js used `bwc_practice_v1.streak`
       with Asia/Jerusalem. The two counters rolled over at different moments and
       drifted, which is why one screen said "2 ימים" and another said "0 ימים".

   Every number here is derived from MODULES/SEMINARS at call time. Nothing is
   hardcoded, so adding a lesson changes every screen at once.

   Load order: after js/course-data.js, before any feature script that displays
   progress. Exposes window.BwcProgress.
   ========================================================================== */
(function (global) {
  'use strict';

  var PRACTICE_KEY  = 'bwc_practice_v1';   // canonical streak store (synced to Supabase)
  var COMPLETED_KEY = 'bwc_completed';
  var LEGACY_STREAK_KEY = 'bwc_streak';            // index.html, local-only, retired
  var LEGACY_DATE_KEY   = 'bwc_last_learn_date';   // index.html, toDateString() format
  var MIGRATED_KEY  = 'bwc_streak_merged_v1';

  /* ---- Dates. The course's day boundary is Israel time, never the visitor's
     machine clock: a learner in another timezone must not get a different
     "today" than the one their synced practice data was written with. ---- */
  function dayString(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  }
  function today()     { return dayString(new Date()); }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return dayString(d); }

  function modules()  { return (typeof global.MODULES  !== 'undefined' && global.MODULES)  ? global.MODULES  : []; }
  function seminars() { return (typeof global.SEMINARS !== 'undefined' && global.SEMINARS) ? global.SEMINARS : []; }

  /**
   * Walk every COMPLETABLE item once, in course order.
   * "Completable" means it has a videoId. An item without one has no player, so
   * it can never be marked done — counting it in the denominator guarantees the
   * learner never reaches 100%. This is the same rule index.html's buildFlat()
   * and library.js already use; progress.html was the only screen ignoring it.
   */
  function eachLesson(fn) {
    modules().forEach(function (mod, mi) {
      (mod.weeks || []).forEach(function (week, wi) {
        (week.days || []).forEach(function (day, di) {
          if (day && day.videoId) fn('m' + mi + '-' + wi + '-' + di, 'module', mi);
        });
      });
    });
    seminars().forEach(function (sem, si) {
      (sem.parts || []).forEach(function (part, pi) {
        if (part && part.videoId) fn('s' + si + '-' + pi, 'seminar', si);
      });
    });
  }

  function readJSON(key, fallback) {
    try { var v = JSON.parse(global.localStorage.getItem(key)); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / private mode */ }
  }

  /** Completed lesson keys, filtered to keys that still exist in the course. */
  function completedKeySet() {
    var raw = readJSON(COMPLETED_KEY, []);
    var stored = new Set(Array.isArray(raw) ? raw : []);
    var live = new Set();
    eachLesson(function (key) { if (stored.has(key)) live.add(key); });
    return live;
  }

  function getTotalLessons() {
    var n = 0;
    eachLesson(function () { n++; });
    return n;
  }

  function getCompletedLessons() {
    return completedKeySet().size;
  }

  /**
   * Raw completion percentage. `decimals` controls rounding only — the value is
   * identical everywhere, so two screens can format differently without ever
   * showing two different numbers.
   * NOTE: this is the RAW figure. index.html additionally paints an onboarding
   * bonus on top of it (js/onboarding.js), which is a deliberate, labelled
   * product decision and is not applied here.
   */
  function getProgressPercent(decimals) {
    var total = getTotalLessons();
    if (!total) return 0;
    var pct = (getCompletedLessons() / total) * 100;
    var d = typeof decimals === 'number' ? decimals : 0;
    return d > 0 ? +pct.toFixed(d) : Math.round(pct);
  }

  /** Per-module counts, using the same completable-only rule. */
  function getModuleStats(mi) {
    var total = 0, done = 0;
    var completed = completedKeySet();
    var mod = modules()[mi];
    if (!mod) return { total: 0, done: 0, pct: 0 };
    (mod.weeks || []).forEach(function (week, wi) {
      (week.days || []).forEach(function (day, di) {
        if (!day || !day.videoId) return;
        total++;
        if (completed.has('m' + mi + '-' + wi + '-' + di)) done++;
      });
    });
    return { total: total, done: done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  /**
   * How many practice challenges exist. Derived from the data file, never
   * hardcoded: progress.html still said "/ 72" long after the bank grew, so a
   * learner who solved more than 72 would have seen a total below their own
   * count. practice-league.js already reads the array; this is the same number.
   */
  function getTotalChallenges() {
    var list = global.PRACTICE_CHALLENGES;
    return Array.isArray(list) ? list.length : 0;
  }

  /** Challenges solved at or above the mastery threshold the game uses (80%). */
  function getSolvedChallenges() {
    var completed = practiceData().completed || {};
    return Object.keys(completed).filter(function (k) { return completed[k] >= 80; }).length;
  }

  /* ---- Streak ------------------------------------------------------------
     One store, one day boundary. `bwc_practice_v1` wins because it is the one
     that syncs to Supabase (practice_stats.current_streak); the old local-only
     `bwc_streak` is folded in once and then left alone.                       */

  function practiceData() {
    var d = readJSON(PRACTICE_KEY, {});
    return (d && typeof d === 'object') ? d : {};
  }

  /** Convert index.html's old `toDateString()` stamp to a Jerusalem day string. */
  function legacyDateToDayString() {
    try {
      var raw = global.localStorage.getItem(LEGACY_DATE_KEY);
      if (!raw) return null;
      var parsed = new Date(raw);
      return isNaN(parsed.getTime()) ? null : dayString(parsed);
    } catch (e) { return null; }
  }

  /**
   * One-time merge of the retired lesson streak into the canonical store.
   * Takes the higher streak and the more recent activity date, so nobody loses
   * a run they actually earned.
   */
  function migrateLegacyStreak() {
    try { if (global.localStorage.getItem(MIGRATED_KEY)) return; } catch (e) { return; }
    var legacyStreak = 0;
    try { legacyStreak = parseInt(global.localStorage.getItem(LEGACY_STREAK_KEY) || '0', 10) || 0; } catch (e) { legacyStreak = 0; }
    var legacyDay = legacyDateToDayString();

    if (legacyStreak > 0 || legacyDay) {
      var data = practiceData();
      if (legacyStreak > (data.streak || 0)) data.streak = legacyStreak;
      if (legacyDay && (!data.lastDate || legacyDay > data.lastDate)) data.lastDate = legacyDay;
      writeJSON(PRACTICE_KEY, data);
    }
    try { global.localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function getStreakDays() {
    migrateLegacyStreak();
    var data = practiceData();
    var streak = data.streak || 0;
    if (!streak) return 0;
    // A streak that was not touched today or yesterday is already broken; show
    // the truth rather than a stale number the learner did not earn.
    if (data.lastDate && data.lastDate !== today() && data.lastDate !== yesterday()) return 0;
    return streak;
  }

  /**
   * Record that the learner did something today (finished a lesson, played a
   * round). Same rule practice.js has always used: today → unchanged,
   * yesterday → +1, anything older → back to 1.
   * Read-modify-write of only streak/lastDate, so it never clobbers xp or the
   * completed map that practice.js owns.
   */
  function recordActivityToday() {
    migrateLegacyStreak();
    var data = practiceData();
    var t = today();
    if (data.lastDate === t) return data.streak || 0;
    data.streak = (data.lastDate === yesterday()) ? (data.streak || 0) + 1 : 1;
    data.lastDate = t;
    writeJSON(PRACTICE_KEY, data);
    return data.streak;
  }

  global.BwcProgress = {
    getTotalLessons:     getTotalLessons,
    getCompletedLessons: getCompletedLessons,
    getProgressPercent:  getProgressPercent,
    getModuleStats:      getModuleStats,
    getTotalChallenges:  getTotalChallenges,
    getSolvedChallenges: getSolvedChallenges,
    getStreakDays:       getStreakDays,
    recordActivityToday: recordActivityToday,
    getCompletedKeys:    function () { return Array.from(completedKeySet()); },
    todayJerusalem:      today
  };
})(window);
