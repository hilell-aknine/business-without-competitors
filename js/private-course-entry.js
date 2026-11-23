/* ==========================================================================
   private-course-entry.js — the sidebar door to private courses (index.html).

   Asks the database which private courses this account may read (migration
   015). The rows come back only for an account with a grant; for everyone
   else the answer is an empty list and nothing is drawn. Nothing here decides
   access: the database does. This file only draws a link to
   pages/private-course.html for what came back.
   ========================================================================== */
(function () {
  'use strict';

  var courses = [];
  var loadedFor = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sidebarHtml(q, offset) {
    if (!courses.length) return '';
    return courses.filter(function (c) {
      return !q || String(c.title).toLowerCase().indexOf(q) !== -1;
    }).map(function (c, i) {
      var href = 'pages/private-course.html?c=' + encodeURIComponent(c.id);
      var listId = 'pc-list-' + i;
      return '<div class="v1-mod" data-private-course="' + esc(c.id) + '">' +
        '<button class="v1-mod__hd" type="button" onclick="toggleMod(this)" aria-expanded="false" aria-controls="' + listId + '">' +
          '<span class="v1-mod__num" aria-hidden="true"><i class="fa-solid fa-lock"></i></span>' +
          '<span class="v1-mod__title">' + esc(c.title) + '</span>' +
          '<i class="fa-solid fa-chevron-down v1-mod__chev" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="v1-mod__list" id="' + listId + '">' +
          '<a class="v1-side__resource" href="' + href + '"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> פתח את הקורס</a>' +
          (c.subtitle ? '<div class="v1-side__resource" style="opacity:.75;cursor:default">' + esc(c.subtitle) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function redraw() {
    if (typeof window.renderSidebar !== 'function' && typeof renderSidebar !== 'function') return;
    var el = document.getElementById('lessonSearch');
    try { (window.renderSidebar || renderSidebar)(el ? el.value : ''); } catch (e) { /* sidebar not ready */ }
  }

  function load(user) {
    if (!user || !user.id) {
      if (courses.length) { courses = []; loadedFor = null; redraw(); }
      return;
    }
    if (loadedFor === user.id) return;
    loadedFor = user.id;
    var sb = window.bwcSupabase;
    if (!sb) return;
    sb.from('private_courses').select('id,title,subtitle').order('created_at').then(function (res) {
      if (loadedFor !== user.id) return;
      courses = (res && !res.error && Array.isArray(res.data)) ? res.data : [];
      if (courses.length) redraw();
    }, function () { /* no access, no door */ });
  }

  window.bwcPrivateCourses = Object.freeze({ sidebarHtml: sidebarHtml });

  function start() {
    if (!window.bwcAuth) return;
    window.bwcAuth.ready().then(function () { load(window.bwcAuth.getUser()); });
    window.bwcAuth.onChange(load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
