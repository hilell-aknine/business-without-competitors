/* ==========================================================================
   lesson-notes.js — טאב "הערות" בדף השיעור

   כתיבה חופשית תוך כדי הצפייה. ברגע שמתחילים להקליד נקלטת הדקה בסרטון,
   וכל הערה שנשמרת נושאת אותה: לחיצה על הזמן מחזירה את הנגן לאותו רגע.
   אחרי השמירה ה-AI מציע לאיזה מסמך חי ההערה שייכת, והלומד מאשר או משנה.

   תלוי ב: notes-store.js (bwcNotes), notes-ui.js (bwcNotesUI),
           window.bwcPlayer מ-index.html (currentSeconds / variant / seek).
   ממשק: window.LessonNotes.render(lessonKey) — נקרא מ-renderAfterSelect().
   ========================================================================== */
(function () {
  'use strict';

  var DRAFT_PREFIX = 'bwc_ln_draft_';   // unsent composer text, per lesson
  var root = null, lessonKey = null, stamp = null, list = null;

  function $(sel) { return root ? root.querySelector(sel) : null; }
  function esc(s) { return window.bwcNotesUI ? window.bwcNotesUI.esc(s) : String(s); }
  function player() { return window.bwcPlayer || null; }

  function readSeconds() {
    var p = player();
    if (!p || typeof p.currentSeconds !== 'function') return null;
    var s = p.currentSeconds();
    return (s == null || !isFinite(s)) ? null : Math.floor(s);
  }

  function setStamp(sec) {
    stamp = sec;
    var el = $('#lnStamp');
    if (!el) return;
    if (sec == null) {
      var input = $('#lnInput');
      var typing = input && input.value.trim();
      el.innerHTML = typing
        ? '<i class="fa-regular fa-clock" aria-hidden="true"></i> בלי זמן: הסרטון לא מנגן כרגע.' +
          ' <button type="button" class="ln-btn ln-btn--ghost" data-act="restamp">קלוט שוב</button>'
        : '<i class="fa-regular fa-clock" aria-hidden="true"></i> הדקה בסרטון תיקלט אוטומטית כשתתחיל לכתוב.';
      return;
    }
    el.innerHTML = '<span class="ln__stamp-time"><i class="fa-regular fa-clock" aria-hidden="true"></i>' +
      esc(window.bwcNotes.formatTime(sec)) + '</span>' +
      '<span>ההערה תישמר עם הרגע הזה בסרטון.</span>' +
      '<button type="button" class="ln-btn ln-btn--ghost" data-act="restamp" aria-label="עדכן לזמן הנוכחי בסרטון">' +
      '<i class="fa-solid fa-rotate" aria-hidden="true"></i> לרגע הנוכחי</button>';
  }

  function cloudHtml() {
    var store = window.bwcNotes;
    if (!store.isLoggedIn()) {
      return '<span class="ln__cloud ln__cloud--warn"><i class="fa-solid fa-laptop" aria-hidden="true"></i> נשמר רק במכשיר הזה. ' +
        '<a href="#" data-act="login">התחבר</a> כדי לשמור בענן ולקבל הצעות שיוך.</span>';
    }
    var s = store.cloudState();
    if (s === 'synced') return '<span class="ln__cloud ln__cloud--ok"><i class="fa-solid fa-cloud" aria-hidden="true"></i> שמור בענן</span>';
    if (s === 'syncing') return '<span class="ln__cloud"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> שומר בענן…</span>';
    if (s === 'missing') return '<span class="ln__cloud ln__cloud--warn"><i class="fa-solid fa-laptop" aria-hidden="true"></i> נשמר במכשיר. השמירה בענן עוד לא הופעלה.</span>';
    if (s === 'error') return '<span class="ln__cloud ln__cloud--warn"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> נשמר במכשיר, ננסה לשמור בענן שוב.</span>';
    return '<span class="ln__cloud"><i class="fa-solid fa-laptop" aria-hidden="true"></i> נשמר במכשיר</span>';
  }

  function renderMeta() {
    var el = $('#lnMeta');
    if (!el || !window.bwcNotes) return;
    var count = window.bwcNotes.notesForLesson(lessonKey).length;
    el.innerHTML = cloudHtml() +
      '<span>' + (count === 1 ? 'הערה אחת בשיעור הזה' : count ? count + ' הערות בשיעור הזה' : '') + '</span>' +
      '<a href="pages/notes.html"><i class="fa-regular fa-folder-open" aria-hidden="true"></i> המסמכים שלי</a>';
  }

  function build() {
    root.innerHTML =
      '<div class="ln">' +
        '<div class="ln__composer">' +
          '<div class="ln__stamp" id="lnStamp" aria-live="polite"></div>' +
          '<label for="lnInput" class="visually-hidden">הערה חדשה לשיעור הנוכחי</label>' +
          '<textarea id="lnInput" class="ln__input" maxlength="5000" ' +
            'placeholder="כתוב בחופשיות תוך כדי השיעור. כל הערה נשמרת עם הדקה בסרטון, ואפשר לשייך אותה למסמך שאתה בונה (למשל: לקוח LTV)."></textarea>' +
          '<div class="ln__bar">' +
            '<span class="ln__hint">Ctrl+Enter לשמירה מהירה</span>' +
            '<button type="button" class="ln-btn ln-btn--gold" id="lnSave"><i class="fa-solid fa-check" aria-hidden="true"></i> שמור הערה</button>' +
          '</div>' +
        '</div>' +
        '<div class="ln__meta" id="lnMeta" role="status" aria-live="polite"></div>' +
        '<div id="lnList"></div>' +
      '</div>';

    var input = $('#lnInput');
    input.addEventListener('input', function () {
      // The moment the learner starts writing is the moment the lecturer said it.
      if (stamp == null && input.value.trim()) setStamp(readSeconds());
      if (!input.value.trim()) setStamp(null);
      try {
        if (input.value) localStorage.setItem(DRAFT_PREFIX + lessonKey, JSON.stringify({ text: input.value, sec: stamp }));
        else localStorage.removeItem(DRAFT_PREFIX + lessonKey);
      } catch (e) { /* quota / private mode */ }
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); save(); }
    });
    $('#lnSave').addEventListener('click', save);
    root.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-act]');
      if (!a || !root.contains(a)) return;
      var act = a.getAttribute('data-act');
      if (act === 'restamp') { setStamp(readSeconds()); persistDraft(); }
      if (act === 'login') {
        ev.preventDefault();
        if (window.bwcAuthModal) window.bwcAuthModal.open();
        else if (window.openLoginModal) window.openLoginModal();
      }
    });

    list = window.bwcNotesUI.mountList($('#lnList'), {
      mode: 'lesson',
      base: '',
      getNotes: function () { return lessonKey ? window.bwcNotes.notesForLesson(lessonKey) : []; },
      onSeek: function (n) {
        var p = player();
        if (p && typeof p.seek === 'function') p.seek(n.video_seconds, n.variant);
      },
      emptyHtml: '<p class="ln__empty">עוד אין הערות בשיעור הזה.</p>',
    });

    window.addEventListener('bwc:notes-change', renderMeta);
  }

  function persistDraft() {
    var input = $('#lnInput');
    if (!input || !lessonKey) return;
    try {
      if (input.value) localStorage.setItem(DRAFT_PREFIX + lessonKey, JSON.stringify({ text: input.value, sec: stamp }));
    } catch (e) {}
  }

  function save() {
    var input = $('#lnInput');
    var body = input && input.value.trim();
    if (!body || !lessonKey) { if (input) input.focus(); return; }
    var p = player();
    var note = window.bwcNotes.addNote({
      lessonKey: lessonKey,
      seconds: stamp,
      variant: p && typeof p.variant === 'function' ? p.variant() : null,
      body: body,
    });
    if (!note) return;
    input.value = '';
    try { localStorage.removeItem(DRAFT_PREFIX + lessonKey); } catch (e) {}
    setStamp(null);
    window.bwcNotesUI.markFresh(note.id);
    // Only ask the AI when it can actually answer; otherwise the note simply
    // waits for a manual "שייך למסמך".
    if (window.bwcNotes.isLoggedIn() && !(window.bwcApi && !window.bwcApi.available)) {
      window.bwcNotesUI.requestSuggestion(note.id);
    }
    if (list) list.render();
    renderMeta();
    input.focus();
  }

  function restoreDraft() {
    var input = $('#lnInput');
    input.value = '';
    stamp = null;
    try {
      var raw = localStorage.getItem(DRAFT_PREFIX + lessonKey);
      if (raw) {
        var d = JSON.parse(raw);
        input.value = d.text || '';
        stamp = d.sec == null ? null : d.sec;
      }
    } catch (e) {}
    setStamp(stamp);
  }

  function render(key) {
    root = document.getElementById('lessonNotes');
    if (!root || !window.bwcNotes || !window.bwcNotesUI) return;
    if (!root.firstChild) build();
    lessonKey = key || null;
    restoreDraft();
    if (list) list.render();
    renderMeta();
  }

  window.LessonNotes = {
    render: function (key) {
      if (!window.bwcNotes) return;
      window.bwcNotes.ready().then(function () { render(key); });
    },
  };
})();
