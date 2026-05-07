/* ============================================================
   Sidebar Module Accordion State Manager
   ------------------------------------------------------------
   Keeps user's open/closed choices for each module + seminar in
   sessionStorage under "bwc_sidebar_open" as JSON of the shape:
     { "m0": true, "m3": false, "s2": true, ... }

   Default behavior on first load: ALL modules/seminars closed
   except the one matching the user's current lesson (currentMi /
   currentSi). Once the user clicks, their choice is persisted.

   Exposes window.SidebarAccordion = { isOpen, setOpen,
                                       shouldStartOpen,
                                       applyOpenStates,
                                       openForCurrent,
                                       init }
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'bwc_sidebar_open';

  function readState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* sessionStorage may be unavailable */ }
  }

  function keyFor(type, idx) {
    var prefix = (type === 'seminar') ? 's' : 'm';
    return prefix + idx;
  }

  /**
   * Has the user explicitly recorded a choice for this accordion?
   */
  function hasExplicitChoice(type, idx) {
    var state = readState();
    return Object.prototype.hasOwnProperty.call(state, keyFor(type, idx));
  }

  /**
   * Returns true if accordion is currently considered open.
   * If user has an explicit sessionStorage choice → use that.
   * Else fall back to caller-provided default (e.g. matches current lesson).
   */
  function isOpen(type, idx, fallbackDefault) {
    var state = readState();
    var k = keyFor(type, idx);
    if (Object.prototype.hasOwnProperty.call(state, k)) {
      return !!state[k];
    }
    return !!fallbackDefault;
  }

  /**
   * Persist a user choice.
   */
  function setOpen(type, idx, open) {
    var state = readState();
    state[keyFor(type, idx)] = !!open;
    writeState(state);
  }

  /**
   * Clear a stored choice — useful when we want the default rule
   * (currentMi auto-open) to take precedence again.
   */
  function clear(type, idx) {
    var state = readState();
    delete state[keyFor(type, idx)];
    writeState(state);
  }

  /**
   * Decide whether an accordion should start open at render time.
   *
   * Rules:
   *   1. If matchesCurrent === true (this is the active module/seminar),
   *      ALWAYS start open — even if a stale sessionStorage entry says false.
   *   2. Else if user has an explicit choice → honor it.
   *   3. Else → closed.
   */
  function shouldStartOpen(type, idx, matchesCurrent) {
    if (matchesCurrent) return true;
    if (hasExplicitChoice(type, idx)) {
      return isOpen(type, idx, false);
    }
    return false;
  }

  /**
   * After renderSidebar() innerHTML's the list, walk every .v1-mod
   * and ensure its `.open` class matches stored state. (renderSidebar
   * already sets the right class server-side via shouldStartOpen, so
   * this is a defensive sync — it also keeps aria-expanded correct.)
   */
  function applyOpenStates() {
    var nodes = document.querySelectorAll('.v1-side .v1-mod');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var hd = el.querySelector('.v1-mod__hd');
      var open = el.classList.contains('open');
      if (hd) hd.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  /**
   * Force the accordion containing the currently selected lesson open
   * AND clear any stale "false" choice for it. Called when the user
   * navigates to a lesson in another module.
   */
  function openForCurrent(type, idx) {
    if (idx == null || idx < 0) return;
    // Clear any stale "false" so default-open rule wins
    var state = readState();
    var k = keyFor(type, idx);
    if (state[k] === false) {
      delete state[k];
      writeState(state);
    }
    // If the DOM is already rendered, also flip the class immediately
    var selector = (type === 'seminar')
      ? '.v1-side .v1-mod[data-sem="' + idx + '"]'
      : '.v1-side .v1-mod[data-mod="' + idx + '"]';
    var el = document.querySelector(selector);
    if (el && !el.classList.contains('open')) {
      el.classList.add('open');
      var hd = el.querySelector('.v1-mod__hd');
      if (hd) hd.setAttribute('aria-expanded', 'true');
    }
  }

  /**
   * Compute completion percentage for a given module index.
   * Reads localStorage["bwc_completed"] (the canonical store used
   * by the rest of the page) and counts keys of shape m{mi}-{wi}-{di}.
   */
  function modulePercent(mi, modulesData) {
    if (!modulesData || !modulesData[mi]) return { pct: 0, done: 0, total: 0 };
    var mod = modulesData[mi];
    var done = 0, total = 0;
    var completed = [];
    try {
      completed = JSON.parse(localStorage.getItem('bwc_completed') || '[]');
    } catch (e) { completed = []; }
    for (var wi = 0; wi < mod.weeks.length; wi++) {
      var days = mod.weeks[wi].days;
      for (var di = 0; di < days.length; di++) {
        if (!days[di].videoId) continue;
        total++;
        if (completed.indexOf('m' + mi + '-' + wi + '-' + di) !== -1) done++;
      }
    }
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { pct: pct, done: done, total: total };
  }

  /**
   * Build the inner HTML for a module-header progress bar.
   * The caller (renderSidebar) injects this string into the .v1-mod__hd.
   */
  function progressBarHtml(pct) {
    var safePct = Math.max(0, Math.min(100, pct | 0));
    var classes = 'v1-mod__progress';
    if (safePct >= 100) classes += ' is-complete';
    else if (safePct === 0) classes += ' is-empty';
    return '<span class="' + classes + '" role="progressbar"' +
      ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + safePct + '"' +
      ' aria-label="התקדמות במודול ' + safePct + '%">' +
      '<span class="v1-mod__progress-fill" style="width:' + safePct + '%"></span>' +
      '</span>';
  }

  /**
   * One-time setup — reserved for any future hooks. Currently a no-op
   * because all logic is invoked by renderSidebar()/toggleMod().
   */
  function init() {
    // no-op — sidebar render is driven by inline JS
  }

  window.SidebarAccordion = {
    isOpen: isOpen,
    setOpen: setOpen,
    clear: clear,
    hasExplicitChoice: hasExplicitChoice,
    shouldStartOpen: shouldStartOpen,
    applyOpenStates: applyOpenStates,
    openForCurrent: openForCurrent,
    modulePercent: modulePercent,
    progressBarHtml: progressBarHtml,
    init: init
  };
})();
