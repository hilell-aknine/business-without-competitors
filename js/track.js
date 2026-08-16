/* ==========================================================================
   track.js — renders one curated track (pages/track.html).

   A track is a VIEW over lessons that already live in MODULES. It never owns
   its own progress: completion is read from the same `bwc_completed` array the
   player and the modules use, so a lesson marked done here is done everywhere.

   Which track to show:  ?id=<track id>   (defaults to the first track)
   Clicking a lesson deep-links into the player with ?module=&week=&day=
   (+ &v= when the lesson has a specific instructor variant).
   ========================================================================== */
(function () {
  'use strict';

  var COMPLETED_KEY = 'bwc_completed';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readCompleted() {
    try {
      var raw = JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function pickTrack() {
    var all = (typeof TRACKS !== 'undefined' && TRACKS) || window.TRACKS || [];
    if (!all.length) return null;
    var wanted = new URLSearchParams(window.location.search).get('id');
    if (!wanted) return all[0];
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === wanted) return all[i];
    }
    return all[0];
  }

  /** Deep link into the player. Same params the seminars page already uses. */
  function lessonHref(lesson) {
    var href = '../index.html?module=' + lesson.mi + '&week=' + lesson.wi + '&day=' + lesson.di;
    if (lesson.variantIndex != null) href += '&v=' + lesson.variantIndex;
    return href;
  }

  function renderHeader(track) {
    document.title = track.title + ' - עסק ללא מתחרים';

    var iconEl = document.getElementById('trackIcon');
    if (iconEl && track.icon) iconEl.className = 'fa-solid ' + track.icon;

    var titleEl = document.getElementById('trackTitle');
    if (titleEl) {
      // Keep the two-tone hero treatment: last word in gold.
      var parts = track.title.trim().split(' ');
      var tail = parts.length > 1 ? parts.pop() : '';
      titleEl.innerHTML = escapeHtml(parts.join(' ')) +
        (tail ? ' <span class="gold">' + escapeHtml(tail) + '</span>' : '');
    }

    var tagEl = document.getElementById('trackTagline');
    if (tagEl && track.shortDescription) tagEl.textContent = track.shortDescription;

    var descEl = document.getElementById('trackDescription');
    if (descEl && track.description) descEl.textContent = track.description;

    var lessonsEl = document.getElementById('statLessons');
    if (lessonsEl) lessonsEl.innerHTML = '<strong>' + track.lessons.length + '</strong> שיעורים';

    var hostEl = document.getElementById('statHost');
    if (hostEl && track.host) hostEl.innerHTML = '<strong>' + escapeHtml(track.host) + '</strong>';
  }

  function renderProgress(track, completed) {
    var total = track.lessons.length;
    var done = track.lessons.filter(function (l) { return completed.indexOf(l.key) !== -1; }).length;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;

    var countEl = document.getElementById('progCount');
    if (countEl) countEl.textContent = done + '/' + total + ' שיעורים';

    var pctEl = document.getElementById('progPct');
    if (pctEl) pctEl.textContent = pct + '%';

    var fillEl = document.getElementById('progFill');
    if (fillEl) fillEl.style.width = pct + '%';

    var barEl = document.getElementById('progBar');
    if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
  }

  function renderList(track, completed) {
    var host = document.getElementById('trackList');
    if (!host) return;

    host.innerHTML = track.lessons.map(function (lesson, i) {
      var done = completed.indexOf(lesson.key) !== -1;
      var thumb = lesson.videoId
        ? '<img src="https://img.youtube.com/vi/' + encodeURIComponent(lesson.videoId) + '/mqdefault.jpg"' +
          ' loading="lazy" alt="" onerror="this.style.display=\'none\'">'
        : '';
      var badge = done
        ? '<span class="trk-item__badge" aria-hidden="true"><i class="fa-solid fa-check"></i></span>'
        : '<span class="trk-item__badge" aria-hidden="true"><i class="fa-solid fa-play"></i></span>';
      var note = lesson.note
        ? '<span class="trk-item__note">' + escapeHtml(lesson.note) + '</span>'
        : '';
      var aria = (i + 1) + '. ' + lesson.title + ' — ' + lesson.context + (done ? ' — הושלם' : ' — לא נצפה');

      return '<a class="trk-item reveal ' + (done ? 'is-done' : '') + '"' +
        ' href="' + escapeHtml(lessonHref(lesson)) + '"' +
        ' aria-label="' + escapeHtml(aria) + '">' +
          '<span class="trk-item__num" aria-hidden="true">' + (i + 1) + '</span>' +
          '<span class="trk-item__thumb" aria-hidden="true">' + thumb + badge + '</span>' +
          '<span class="trk-item__body">' +
            '<span class="trk-item__title">' + escapeHtml(lesson.title) + '</span>' +
            '<span class="trk-item__meta">' +
              '<i class="fa-regular fa-folder-open" aria-hidden="true"></i>' +
              '<span>' + escapeHtml(lesson.context) + '</span>' +
              (done ? '<span aria-hidden="true">·</span><span>הושלם</span>' : '') +
            '</span>' +
            note +
          '</span>' +
          '<span class="trk-item__go" aria-hidden="true"><i class="fa-solid fa-chevron-left"></i></span>' +
        '</a>';
    }).join('');
  }

  function observeReveals() {
    var els = document.querySelectorAll('.reveal:not(.visible)');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });
    els.forEach(function (el) { io.observe(el); });
  }

  function renderAll() {
    var track = pickTrack();
    if (!track) return;
    var completed = readCompleted();
    renderHeader(track);
    renderProgress(track, completed);
    renderList(track, completed);
    observeReveals();
  }

  document.addEventListener('DOMContentLoaded', renderAll);

  // sync-localstorage.js merges the server copy of bwc_completed after login.
  // Without this the page would keep showing the pre-login (device-only) count.
  window.addEventListener('bwc:sync-done', renderAll);
  window.addEventListener('bwc:auth-change', renderAll);
})();
