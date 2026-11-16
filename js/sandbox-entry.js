/* sandbox-entry.js — entry card to חדר האימון (pages/sandbox.html).
   Shown at the end of a module page (pages/module.html) and in the about tab
   of every lesson of that module (index.html). Added 2026-11-16.
   Only the pilot modules get a card. If the learner has an if-then plan from
   the last round that was not followed up yet, the card says so.

   window.bwcSandboxEntry.html(moduleIdx, pagesPrefix) -> string ('' if none)
     pagesPrefix: '' from pages/*.html, 'pages/' from the site root. */
(function () {
  'use strict';
  var PILOT = [1];

  function plan(mi) {
    try {
      var p = JSON.parse(localStorage.getItem('bwc_sandbox_plan_v1_m' + mi));
      return p && p.status === 'pending' ? p : null;
    } catch (_) { return null; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function html(mi, prefix) {
    if (PILOT.indexOf(mi) < 0) return '';
    var p = plan(mi);
    var title = p ? 'עשית את מה שהתחייבת אליו?' : 'חדר האימון של המודול';
    var sub = p
      ? 'בסבב הקודם כתבת: "' + esc(String(p.plan).slice(0, 90)) + (String(p.plan).length > 90 ? '...' : '') + '". ספרו לנו איך הלך.'
      : 'חמישה תרגילים קצרים סביב העסק שלך: להסביר, ליישם, לשכנע לקוח ספקן, לבדוק מה יכול להיכשל, ולהתחייב לצעד אחד.';
    return '<a class="sbx-entry" href="' + (prefix || '') + 'sandbox.html?module=' + mi + '">' +
      '<span class="sbx-entry__icon" aria-hidden="true"><i class="fa-solid fa-dumbbell"></i></span>' +
      '<span class="sbx-entry__text"><span class="sbx-entry__title">' + title + '</span><span class="sbx-entry__sub">' + sub + '</span></span>' +
      '<span class="sbx-entry__go">' + (p ? 'לעדכן' : 'להיכנס') + ' <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></span>' +
      '</a>';
  }

  window.bwcSandboxEntry = { html: html, pilot: PILOT.slice() };
})();
