/* ==========================================================================
   notes-ui.js — כרטיס הערה משותף: זמן, מסמך, הצעת AI, עריכה, מחיקה

   משמש גם את טאב "הערות" בשיעור (js/lesson-notes.js) וגם את דף
   "המסמכים שלי" (js/notes-page.js), כדי שהערה תתנהג אותו דבר בשני המקומות.

   החוק של הפיצ'ר: ה-AI רק מציע. שום הערה לא משויכת למסמך בלי לחיצה
   של הלומד ("כן" על ההצעה, או בחירה בבורר).

   API: window.bwcNotesUI.mountList(listEl, opts) -> { render() }
          opts.getNotes()   -> note[]          (מה להציג, בסדר הרצוי)
          opts.mode         'lesson' | 'doc'
          opts.base         '' | '../'         (לקישורים לשיעור)
          opts.onSeek(note) -> void            (במצב lesson: קפיצה בנגן)
          opts.groupByLesson bool              (במצב doc: כותרת לכל שיעור)
          opts.emptyHtml    string
        window.bwcNotesUI.requestSuggestion(noteId)
        window.bwcNotesUI.esc(s)
   ========================================================================== */
(function () {
  'use strict';
  if (window.bwcNotesUI) return;

  var S = function () { return window.bwcNotes; };
  var sugg = {};      // noteId -> { state: 'pending'|'ready'|'none'|'error', suggestion, reason, error }
  var ui = {};        // noteId -> { editing, picker, fresh }
  var lists = [];     // mounted lists, re-rendered together

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function st(id) { return ui[id] || (ui[id] = {}); }
  function renderAll() {
    // A page that re-renders mounts a fresh list; forget the detached ones.
    lists = lists.filter(function (l) { return l.el.isConnected; });
    lists.forEach(function (l) { l.render(); });
  }

  var ERR_TEXT = {
    auth_required: 'התחבר כדי לקבל הצעת שיוך אוטומטית.',
    api_unavailable: 'הצעות אוטומטיות זמינות רק בפורטל המלא.',
    rate_limited: 'יותר מדי בקשות בדקה האחרונה. נסה שוב עוד רגע.',
  };

  function requestSuggestion(noteId) {
    var store = S();
    if (!store || !store.note(noteId)) return;
    sugg[noteId] = { state: 'pending' };
    renderAll();
    store.suggest(noteId).then(function (r) {
      if (!r || r.error) {
        sugg[noteId] = { state: 'error', error: (r && r.error) || 'unknown' };
      } else if (!r.suggestion || r.suggestion.type === 'none') {
        sugg[noteId] = { state: 'none', reason: r.reason };
      } else {
        // The document may have been deleted while we waited.
        if (r.suggestion.type === 'existing' && !store.doc(r.suggestion.docId)) {
          sugg[noteId] = { state: 'none' };
        } else {
          sugg[noteId] = { state: 'ready', suggestion: r.suggestion, reason: r.reason };
        }
      }
      renderAll();
    });
  }

  /* ---------------- rendering ---------------- */

  function timeHtml(n, mode, base) {
    var store = S();
    if (n.video_seconds == null) {
      if (mode === 'doc') {
        return '<a class="ln-time ln-time--none" href="' + esc(store.lessonHref(n, base)) + '" style="cursor:pointer">' +
          '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> לשיעור</a>';
      }
      return '<span class="ln-time ln-time--none" title="ההערה נכתבה בלי שהסרטון היה פתוח">בלי זמן</span>';
    }
    var t = store.formatTime(n.video_seconds);
    var inner = '<i class="fa-solid fa-play" aria-hidden="true"></i><span class="ln-time__num">' + esc(t) + '</span>';
    if (mode === 'doc') {
      return '<a class="ln-time" href="' + esc(store.lessonHref(n, base)) + '" aria-label="פתח את השיעור בדקה ' + esc(t) + '">' + inner + '</a>';
    }
    return '<button type="button" class="ln-time" data-act="seek" aria-label="קפוץ בסרטון לדקה ' + esc(t) + '">' + inner + '</button>';
  }

  function docChipHtml(n) {
    var d = n.doc_id && S().doc(n.doc_id);
    if (d) {
      return '<button type="button" class="ln-doc" data-act="picker" aria-label="שנה מסמך. כרגע: ' + esc(d.title) + '">' +
        '<i class="fa-regular fa-file-lines" aria-hidden="true"></i><span>' + esc(d.title) + '</span></button>';
    }
    return '<button type="button" class="ln-doc ln-doc--empty" data-act="picker">' +
      '<i class="fa-solid fa-folder-plus" aria-hidden="true"></i><span>שייך למסמך</span></button>';
  }

  function suggHtml(n) {
    if (n.doc_id) return '';
    var s = sugg[n.id];
    if (!s) return '';
    if (s.state === 'pending') {
      return '<div class="ln-sugg ln-sugg--quiet" role="status"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>' +
        '<span class="ln-sugg__text">מחפש לאיזה מסמך זה שייך…</span></div>';
    }
    if (s.state === 'error') {
      var msg = ERR_TEXT[s.error] || 'לא הצלחתי להציע מסמך הפעם.';
      return '<div class="ln-sugg ln-sugg--quiet" role="status"><span class="ln-sugg__text">' + esc(msg) + '</span>' +
        '<span class="ln-sugg__acts"><button type="button" class="ln-btn" data-act="picker">בחר ידנית</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="dismiss">סגור</button></span></div>';
    }
    if (s.state === 'none') {
      return '<div class="ln-sugg ln-sugg--quiet" role="status"><span class="ln-sugg__text">לא זיהיתי נושא ברור להערה הזו.' +
        (s.reason ? '<span class="ln-sugg__why">' + esc(s.reason) + '</span>' : '') + '</span>' +
        '<span class="ln-sugg__acts"><button type="button" class="ln-btn" data-act="picker">בחר מסמך</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="dismiss">השאר בלי מסמך</button></span></div>';
    }
    var sg = s.suggestion;
    var label = sg.type === 'new'
      ? 'לפתוח מסמך חדש: <strong>' + esc(sg.title) + '</strong>?'
      : 'להוסיף למסמך <strong>' + esc(sg.title) + '</strong>?';
    return '<div class="ln-sugg" role="status">' +
      '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true" style="color:var(--accent-purple)"></i>' +
      '<span class="ln-sugg__text">' + label + (s.reason ? '<span class="ln-sugg__why">' + esc(s.reason) + '</span>' : '') + '</span>' +
      '<span class="ln-sugg__acts">' +
        '<button type="button" class="ln-btn ln-btn--gold" data-act="accept">כן</button>' +
        '<button type="button" class="ln-btn" data-act="picker">מסמך אחר</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="dismiss">לא עכשיו</button>' +
      '</span></div>';
  }

  function pickerHtml(n) {
    var docs = S().docs();
    var btns = docs.map(function (d) {
      var on = d.id === n.doc_id;
      return '<button type="button" class="ln-btn" data-act="assign" data-doc="' + esc(d.id) + '" aria-pressed="' + on + '">' +
        esc(d.title) + '</button>';
    }).join('');
    return '<div class="ln-picker">' +
      '<p class="ln-picker__title">' + (docs.length ? 'לאיזה מסמך להוסיף?' : 'עוד אין לך מסמכים. תן שם לראשון:') + '</p>' +
      (docs.length ? '<div class="ln-picker__docs">' + btns + '</div>' : '') +
      '<div class="ln-picker__new">' +
        '<input type="text" maxlength="80" placeholder="מסמך חדש, למשל: לקוח LTV" aria-label="שם מסמך חדש" data-role="newdoc">' +
        '<button type="button" class="ln-btn ln-btn--gold" data-act="create">צור והוסף</button>' +
      '</div>' +
      '<div class="ln-picker__foot">' +
        (n.doc_id ? '<button type="button" class="ln-btn ln-btn--ghost" data-act="unassign">הוצא מהמסמך</button>' : '') +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="picker-close">ביטול</button>' +
      '</div></div>';
  }

  function cardHtml(n, opts) {
    var s = st(n.id);
    var body = s.editing
      ? '<textarea class="ln__input ln-note__edit" data-role="edit" maxlength="5000" aria-label="עריכת ההערה">' + esc(n.body) + '</textarea>' +
        '<div class="ln__bar"><span class="ln__hint">Ctrl+Enter לשמירה</span>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="edit-cancel">ביטול</button>' +
        '<button type="button" class="ln-btn ln-btn--gold" data-act="edit-save">שמור</button></div>'
      : '<p class="ln-note__body">' + esc(n.body) + '</p>';
    return '<li class="ln-note' + (s.fresh ? ' ln-note--fresh' : '') + '" data-id="' + esc(n.id) + '">' +
      '<div class="ln-note__head">' +
        timeHtml(n, opts.mode, opts.base) +
        docChipHtml(n) +
        '<span class="ln-note__tools">' +
          '<button type="button" class="ln-btn ln-btn--ghost ln-btn--icon" data-act="edit" aria-label="ערוך הערה"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>' +
          '<button type="button" class="ln-btn ln-btn--ghost ln-btn--icon ln-btn--danger" data-act="delete" aria-label="מחק הערה"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>' +
        '</span>' +
      '</div>' +
      body +
      (s.picker ? pickerHtml(n) : suggHtml(n)) +
    '</li>';
  }

  function listHtml(notes, opts) {
    if (!notes.length) return opts.emptyHtml || '';
    if (!opts.groupByLesson) {
      return '<ol class="ln__list">' + notes.map(function (n) { return cardHtml(n, opts); }).join('') + '</ol>';
    }
    var out = '', last = null, open = false;
    notes.forEach(function (n) {
      if (n.lesson_key !== last) {
        if (open) out += '</ol></section>';
        var info = S().lessonInfo(n.lesson_key);
        out += '<section class="nd-lesson"><h3>' + esc(info.title) + '</h3><p>' + esc(info.context) + '</p><ol class="ln__list">';
        open = true; last = n.lesson_key;
      }
      out += cardHtml(n, opts);
    });
    if (open) out += '</ol></section>';
    return out;
  }

  /* ---------------- events ---------------- */

  function focusIn(listEl, id, selector) {
    setTimeout(function () {
      var li = listEl.querySelector('.ln-note[data-id="' + id + '"]');
      var el = li && li.querySelector(selector);
      if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
    }, 0);
  }

  function handle(listEl, opts, ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || !listEl.contains(btn)) return;
    var li = btn.closest('.ln-note');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var store = S(), n = store.note(id);
    if (!n) return;
    var s = st(id), act = btn.getAttribute('data-act');

    if (act === 'seek') { if (opts.onSeek) opts.onSeek(n); return; }
    if (act === 'edit') { s.editing = true; s.picker = false; renderAll(); focusIn(listEl, id, '[data-role="edit"]'); return; }
    if (act === 'edit-cancel') { s.editing = false; renderAll(); return; }
    if (act === 'edit-save') {
      var ta = li.querySelector('[data-role="edit"]');
      if (ta && ta.value.trim()) store.updateNote(id, { body: ta.value });
      s.editing = false; renderAll(); return;
    }
    if (act === 'delete') {
      if (window.confirm('למחוק את ההערה? אי אפשר לשחזר.')) { delete ui[id]; delete sugg[id]; store.deleteNote(id); }
      return;
    }
    if (act === 'picker') { s.picker = !s.picker; s.editing = false; renderAll(); if (s.picker) focusIn(listEl, id, '.ln-picker button, .ln-picker input'); return; }
    if (act === 'picker-close') { s.picker = false; renderAll(); return; }
    if (act === 'dismiss') { delete sugg[id]; renderAll(); return; }
    if (act === 'assign') { store.assign(id, btn.getAttribute('data-doc')); s.picker = false; delete sugg[id]; return; }
    if (act === 'unassign') { store.assign(id, null); s.picker = false; return; }
    if (act === 'create') {
      var inp = li.querySelector('[data-role="newdoc"]');
      var title = inp && inp.value.trim();
      if (!title) { if (inp) inp.focus(); return; }
      var d = store.createDoc(title);
      if (d) { store.assign(id, d.id); s.picker = false; delete sugg[id]; }
      return;
    }
    if (act === 'accept') {
      var sg = sugg[id] && sugg[id].suggestion;
      if (!sg) return;
      var target = sg.type === 'new' ? store.createDoc(sg.title) : store.doc(sg.docId);
      if (target) store.assign(id, target.id);
      delete sugg[id];
      return;
    }
  }

  function mountList(listEl, opts) {
    var api = {
      el: listEl,
      render: function () {
        // Do not wipe a textarea the learner is typing in.
        var active = document.activeElement;
        var keep = active && listEl.contains(active) && active.getAttribute('data-role');
        var keepId = keep && active.closest('.ln-note') && active.closest('.ln-note').getAttribute('data-id');
        var keepVal = keep ? active.value : null;
        listEl.innerHTML = listHtml(opts.getNotes(), opts);
        if (keep && keepId) {
          var el = listEl.querySelector('.ln-note[data-id="' + keepId + '"] [data-role="' + keep + '"]');
          if (el) { el.value = keepVal; el.focus(); }
        }
      },
    };
    listEl.addEventListener('click', function (ev) { handle(listEl, opts, ev); });
    listEl.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var role = t.getAttribute('data-role');
      if (role === 'edit' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        var save = t.closest('.ln-note').querySelector('[data-act="edit-save"]');
        if (save) save.click();
      }
      if (role === 'newdoc' && ev.key === 'Enter') {
        ev.preventDefault();
        var c = t.closest('.ln-note').querySelector('[data-act="create"]');
        if (c) c.click();
      }
      if (ev.key === 'Escape') {
        var li = t.closest && t.closest('.ln-note');
        if (li) { var s = st(li.getAttribute('data-id')); if (s.picker || s.editing) { s.picker = false; s.editing = false; renderAll(); } }
      }
    });
    lists.push(api);
    api.render();
    return api;
  }

  window.addEventListener('bwc:notes-change', function (ev) {
    var r = ev && ev.detail && ev.detail.reason;
    if (r === 'sync' && !(ev.detail && ev.detail.cloud === 'synced')) return;  // status-only change
    renderAll();
  });

  window.bwcNotesUI = {
    mountList: mountList,
    requestSuggestion: requestSuggestion,
    markFresh: function (id) { st(id).fresh = true; setTimeout(function () { if (ui[id]) { ui[id].fresh = false; renderAll(); } }, 2500); },
    esc: esc,
  };
})();
