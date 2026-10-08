/* ==========================================================================
   notes-page.js — דף "המסמכים שלי" (pages/notes.html)

   רשימת המסמכים החיים של הלומד. בכל מסמך: כל ההערות שלו מכל השיעורים,
   לפי סדר הקורס, עם קישור לשיעור ולדקה. "הפוך לטיוטה" מחזיר מסמך נקי
   להעתקה (api/notes-ai.js), ו"העתק הערות" עובד גם בלי AI.

   מצב בכתובת: ?doc=<id> | ?doc=none (הערות בלי מסמך). בטלפון: רשימה או מסמך.
   ========================================================================== */
(function () {
  'use strict';

  var app, statusEl, selected = null, renaming = false, list = null;
  var drafts = {};   // docId -> { state: 'pending'|'ready'|'error', text, error, truncated }
  var bulk = null;   // { done, total } while suggesting for all unassigned notes

  function esc(s) { return window.bwcNotesUI.esc(s); }
  function store() { return window.bwcNotes; }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ''; }

  function readSelection() {
    var p = new URLSearchParams(location.search).get('doc');
    return p || null;
  }
  function writeSelection(id, push) {
    var url = location.pathname + (id ? '?doc=' + encodeURIComponent(id) : '');
    try { history[push ? 'pushState' : 'replaceState']({ doc: id }, '', url); } catch (e) {}
  }

  function lessonsIn(notes) {
    var seen = {};
    notes.forEach(function (n) { seen[n.lesson_key] = 1; });
    return Object.keys(seen).length;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function cloudLine() {
    var s = store();
    if (!s.isLoggedIn()) return 'ההערות שמורות רק בדפדפן הזה. התחבר כדי לשמור אותן בענן ולקבל הצעות שיוך.';
    var c = s.cloudState();
    if (c === 'synced') return 'שמור בענן ומסונכרן בין המכשירים שלך.';
    if (c === 'syncing') return 'שומר בענן…';
    if (c === 'missing') return 'ההערות שמורות בדפדפן הזה. השמירה בענן עוד לא הופעלה בפורטל.';
    if (c === 'error') return 'ההערות שמורות בדפדפן. ננסה לשמור בענן שוב.';
    return '';
  }

  /* ---------------- rendering ---------------- */

  function sideHtml() {
    var docs = store().docs();
    var none = store().notesForDoc(null).length;
    var items = docs.map(function (d) {
      var c = store().notesForDoc(d.id).length;
      return '<li><button type="button" data-doc="' + esc(d.id) + '" aria-current="' + (selected === d.id) + '">' +
        '<i class="fa-regular fa-file-lines" aria-hidden="true"></i><span class="nd-docs__name">' + esc(d.title) + '</span>' +
        '<span class="nd-docs__count" aria-label="' + c + ' הערות">' + c + '</span></button></li>';
    }).join('');
    return '<aside class="nd-card nd-side" aria-label="רשימת המסמכים">' +
      '<h2>מסמכים</h2>' +
      (docs.length ? '<ul class="nd-docs">' + items + '</ul>' : '<p class="ln__empty" style="text-align:start;padding:.2rem 0 .6rem">עוד אין מסמכים.</p>') +
      '<div class="nd-docs__sep" role="separator"></div>' +
      '<ul class="nd-docs"><li><button type="button" data-doc="none" aria-current="' + (selected === 'none') + '">' +
        '<i class="fa-solid fa-inbox" aria-hidden="true"></i><span class="nd-docs__name">הערות בלי מסמך</span>' +
        '<span class="nd-docs__count">' + none + '</span></button></li></ul>' +
      '<form class="nd-new" data-role="newdoc-form">' +
        '<label for="ndNewDoc" class="visually-hidden">שם למסמך חדש</label>' +
        '<input id="ndNewDoc" type="text" maxlength="80" placeholder="מסמך חדש, למשל: אווטאר">' +
        '<button type="submit" class="ln-btn ln-btn--gold" aria-label="צור מסמך"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>' +
      '</form>' +
    '</aside>';
  }

  /* The draft arrives as simple Markdown (headings, bullets, rules). Shown
     rendered so it reads like a document; "העתק טיוטה" still copies the
     Markdown. Every line is escaped first, so model output can never inject HTML. */
  function mdToHtml(md) {
    var out = [], inList = false;
    String(md || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      var m;
      if (/^[-*•]\s+/.test(line)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(line.replace(/^[-*•]\s+/, '')) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (!line) return;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { out.push('<hr>'); return; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        var lvl = Math.min(6, m[1].length + 3);   // # -> h4, ## -> h5
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        return;
      }
      out.push('<p>' + inline(line) + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }
  function inline(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function draftHtml(id) {
    var d = drafts[id];
    if (!d) return '';
    if (d.state === 'pending') {
      return '<div class="nd-draft" role="status"><div class="nd-draft__head"><h3><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> מסדר את ההערות לטיוטה…</h3></div></div>';
    }
    if (d.state === 'error') {
      var msg = {
        auth_required: 'צריך להתחבר כדי ליצור טיוטה.',
        api_unavailable: 'יצירת טיוטה זמינה רק בפורטל המלא.',
        rate_limited: 'יותר מדי בקשות בדקה האחרונה. נסה שוב עוד רגע.',
      }[d.error] || 'לא הצלחתי ליצור טיוטה הפעם. אפשר להעתיק את ההערות הגולמיות.';
      return '<div class="nd-draft" role="status"><p>' + esc(msg) + '</p></div>';
    }
    return '<section class="nd-draft" aria-label="טיוטה">' +
      '<div class="nd-draft__head"><h3><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> טיוטה מסודרת</h3>' +
        '<button type="button" class="ln-btn ln-btn--gold" data-act="copy-draft"><i class="fa-regular fa-copy" aria-hidden="true"></i> העתק טיוטה</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="close-draft">סגור</button></div>' +
      '<div class="nd-draft__body" tabindex="0">' + mdToHtml(d.text) + '</div>' +
      '<p class="nd-note-msg">נבנה רק מההערות שלך. ' + (d.truncated ? 'המסמך ארוך, ולכן נכללו ההערות הראשונות בלבד. ' : '') +
        'כדאי לעבור על הטיוטה לפני שמשתמשים בה.</p>' +
    '</section>';
  }

  function mainHtml() {
    var s = store();
    var isNone = selected === 'none';
    var doc = isNone ? null : s.doc(selected);
    var notes = s.notesForDoc(isNone ? null : selected);
    var titleHtml;
    if (!isNone && renaming) {
      titleHtml = '<form class="nd-new" data-role="rename-form" style="flex:1 1 16rem;margin:0">' +
        '<label for="ndRename" class="visually-hidden">שם המסמך</label>' +
        '<input id="ndRename" type="text" maxlength="80" value="' + esc(doc.title) + '">' +
        '<button type="submit" class="ln-btn ln-btn--gold">שמור</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="rename-cancel">ביטול</button></form>';
    } else {
      titleHtml = '<h2 class="nd-main__title" id="ndTitle" tabindex="-1">' + esc(isNone ? 'הערות בלי מסמך' : doc.title) + '</h2>';
    }
    var actions;
    if (isNone) {
      var canAi = s.isLoggedIn() && !(window.bwcApi && !window.bwcApi.available);
      actions = (notes.length && canAi)
        ? '<button type="button" class="ln-btn ln-btn--gold" data-act="suggest-all"' + (bulk ? ' disabled' : '') + '>' +
          '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ' +
          (bulk ? 'מציע… ' + bulk.done + '/' + bulk.total : 'הצע מסמך לכל ההערות') + '</button>'
        : '';
    } else {
      actions =
        '<button type="button" class="ln-btn ln-btn--gold" data-act="draft"' + (notes.length ? '' : ' disabled') + '>' +
          '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> הפוך לטיוטה</button>' +
        '<button type="button" class="ln-btn" data-act="copy-raw"' + (notes.length ? '' : ' disabled') + '>' +
          '<i class="fa-regular fa-copy" aria-hidden="true"></i> העתק הערות</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost" data-act="rename"><i class="fa-solid fa-pen" aria-hidden="true"></i> שנה שם</button>' +
        '<button type="button" class="ln-btn ln-btn--ghost ln-btn--danger" data-act="delete-doc"><i class="fa-regular fa-trash-can" aria-hidden="true"></i> מחק מסמך</button>';
    }
    return '<section class="nd-card nd-main" aria-labelledby="ndTitle">' +
      '<div class="nd-main__head">' +
        '<button type="button" class="ln-btn ln-btn--ghost nd-back" data-act="back"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> כל המסמכים</button>' +
        titleHtml +
      '</div>' +
      '<p class="nd-main__sub">' + (notes.length
        ? (notes.length === 1 ? 'הערה אחת' : notes.length + ' הערות') + ' מ' +
          (lessonsIn(notes) === 1 ? 'שיעור אחד' : lessonsIn(notes) + ' שיעורים') + ', לפי סדר הקורס'
        : (isNone ? 'כל ההערות שלך משויכות למסמכים.' : 'עוד אין הערות במסמך הזה. בשיעור, אחרי ששומרים הערה, אפשר לשייך אותה לכאן.')) + '</p>' +
      (actions ? '<div class="nd-actions">' + actions + '</div>' : '') +
      (isNone ? '' : draftHtml(selected)) +
      '<div id="ndList"></div>' +
    '</section>';
  }

  function emptyHtml() {
    return '<div class="nd-card nd-gate">' +
      '<div style="font-size:2rem;color:var(--accent-gold)"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></div>' +
      '<h2 style="margin-top:.6rem">עוד לא כתבת הערות</h2>' +
      '<p style="color:var(--text-secondary);margin:.5rem auto 1rem;max-inline-size:32rem;line-height:1.7">' +
        'בכל שיעור יש טאב "הערות". כותבים בחופשיות תוך כדי הצפייה, וכל הערה נשמרת עם הדקה בסרטון. ' +
        'אחר כך משייכים אותה למסמך, למשל "לקוח LTV", והוא מצטבר כאן מכל השיעורים.</p>' +
      '<a class="ln-btn ln-btn--gold" href="../index.html">לשיעורים</a>' +
      (store().isLoggedIn() ? '' : ' <button type="button" class="ln-btn" data-act="login">התחברות</button>') +
    '</div>';
  }

  function render(opts) {
    var s = store();
    var hasAny = s.allNotes().length || s.docs().length;
    app.setAttribute('aria-busy', 'false');
    setStatus(cloudLine());
    if (!hasAny) { app.innerHTML = emptyHtml(); list = null; return; }

    // A selection that no longer exists (deleted elsewhere) falls back to the list.
    if (selected && selected !== 'none' && !s.doc(selected)) { selected = null; renaming = false; }
    var view = selected ? 'doc' : 'list';
    var target = selected || (s.docs()[0] ? s.docs()[0].id : 'none');
    var shown = selected || target;   // desktop always shows something on the right

    var prev = selected;
    selected = shown;
    app.innerHTML = '<div class="nd-layout" data-view="' + view + '">' + sideHtml() + mainHtml() + '</div>';
    selected = prev;

    list = window.bwcNotesUI.mountList(app.querySelector('#ndList'), {
      mode: 'doc',
      base: '../',
      groupByLesson: true,
      getNotes: function () { return s.notesForDoc(shown === 'none' ? null : shown); },
      emptyHtml: '',
    });
    if (opts && opts.focusTitle) {
      var t = app.querySelector('#ndTitle');
      if (t) t.focus();
    }
    if (renaming) {
      var inp = app.querySelector('#ndRename');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function currentShown() {
    var el = app.querySelector('.nd-side button[aria-current="true"]');
    return el ? el.getAttribute('data-doc') : null;
  }

  /* ---------------- actions ---------------- */

  function select(id, push) {
    selected = id; renaming = false;
    writeSelection(id, push);
    render({ focusTitle: true });
    if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo({ top: 0 });
  }

  function makeDraft(id) {
    drafts[id] = { state: 'pending' };
    render();
    store().draft(id).then(function (r) {
      drafts[id] = (!r || r.error)
        ? { state: 'error', error: (r && r.error) || 'unknown' }
        : { state: 'ready', text: r.draft, truncated: !!r.truncated };
      render();
      var pre = app.querySelector('.nd-draft__body, .nd-draft');
      if (pre && pre.scrollIntoView) pre.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function suggestAll() {
    var notes = store().notesForDoc(null).slice(0, 10);   // guard.js allows 12/min
    if (!notes.length) return;
    bulk = { done: 0, total: notes.length };
    render();
    var i = 0;
    (function next() {
      if (i >= notes.length) { bulk = null; render(); setStatus('ההצעות מוכנות. אשר כל אחת בנפרד.'); return; }
      var n = notes[i++];
      window.bwcNotesUI.requestSuggestion(n.id);
      // requestSuggestion re-renders on its own; just pace the requests.
      setTimeout(function () { if (bulk) bulk.done = i; next(); }, 900);
    })();
  }

  function onClick(ev) {
    var docBtn = ev.target.closest('.nd-side [data-doc]');
    if (docBtn) { select(docBtn.getAttribute('data-doc'), true); return; }
    var a = ev.target.closest('[data-act]');
    if (!a || !app.contains(a) || a.closest('.ln-note')) return;   // note cards are handled by notes-ui
    var act = a.getAttribute('data-act');
    var shown = currentShown();
    var s = store();
    if (act === 'back') { select(null, true); return; }
    if (act === 'login') { if (window.bwcAuthModal) window.bwcAuthModal.open(); return; }
    if (act === 'draft') { makeDraft(shown); return; }
    if (act === 'close-draft') { delete drafts[shown]; render(); return; }
    if (act === 'copy-draft') {
      var d = drafts[shown];
      if (d && d.text) copy(d.text).then(function () { setStatus('הטיוטה הועתקה.'); }, function () { setStatus('ההעתקה נכשלה. סמן את הטקסט והעתק ידנית.'); });
      return;
    }
    if (act === 'copy-raw') {
      copy(s.plainText(shown)).then(function () { setStatus('ההערות הועתקו.'); }, function () { setStatus('ההעתקה נכשלה.'); });
      return;
    }
    if (act === 'rename') { selected = shown; renaming = true; render(); return; }
    if (act === 'rename-cancel') { renaming = false; render(); return; }
    if (act === 'delete-doc') {
      var doc = s.doc(shown);
      if (doc && window.confirm('למחוק את המסמך "' + doc.title + '"? ההערות עצמן לא יימחקו, הן יעברו ל"הערות בלי מסמך".')) {
        s.deleteDoc(shown); delete drafts[shown]; select(null, false);
      }
      return;
    }
    if (act === 'suggest-all') { suggestAll(); return; }
  }

  function onSubmit(ev) {
    var form = ev.target;
    var role = form.getAttribute('data-role');
    if (!role) return;
    ev.preventDefault();
    var s = store();
    if (role === 'newdoc-form') {
      var inp = form.querySelector('input');
      var d = inp && inp.value.trim() && s.createDoc(inp.value);
      if (d) select(d.id, true);
      else if (inp) inp.focus();
    }
    if (role === 'rename-form') {
      var r = form.querySelector('input');
      if (r && r.value.trim()) s.renameDoc(currentShown(), r.value);
      renaming = false; render();
    }
  }

  function boot() {
    app = document.getElementById('ndApp');
    statusEl = document.getElementById('ndStatus');
    if (!app || !window.bwcNotes || !window.bwcNotesUI) return;
    selected = readSelection();
    app.addEventListener('click', onClick);
    app.addEventListener('submit', onSubmit);
    window.addEventListener('popstate', function () { selected = readSelection(); renaming = false; render(); });
    window.addEventListener('bwc:notes-change', function (ev) {
      var r = ev && ev.detail && ev.detail.reason;
      // Note-card changes re-render the list on their own; structural changes
      // (documents, counts, sync results, account switch) need the whole page.
      if (r === 'sync' && ev.detail.cloud !== 'synced') { setStatus(cloudLine()); return; }
      if (!renaming) render();
    });
    store().ready().then(function () { render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
