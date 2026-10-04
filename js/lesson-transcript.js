/* ==============================================================
   lesson-transcript.js — טאב "תמלול" בדף השיעור
   עסק ללא מתחרים · Vanilla JS, בלי פריימוורק, בלי שלב בנייה

   מה זה פותר (2026-10-04, בקשת הלל):
     "בכל סרטון טאב עם התמלול המלא של השיעור, שיהיה קל להעתיק אותו."

   איך:
     התמלולים יושבים רק בצד השרת ומוצפנים בגיט (חוק ברזל 4), ולכן
     הטקסט נמשך מ-/api/lesson-transcript עם ה-JWT של המשתמש המחובר.
     כל שיעור נמשך פעם אחת לסשן ונשמר בזיכרון — מעבר בין שיעורים
     וחזרה לא שורף את מכסת הבקשות (12 לדקה לכל IP ב-guard.js).

   ממשק: window.LessonTranscript.render(paneEl, lessonKey)
   נקרא מ-js/lesson-tabs.js כשנכנסים לטאב או מחליפים שיעור בזמן שהוא פתוח.
   ============================================================== */

(function () {
  'use strict';

  var cache = {};        // lessonKey → { title, text }
  var requested = null;  // השיעור האחרון שביקשנו — תשובה מאוחרת לשיעור קודם נזרקת

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stateHtml(icon, title, text, extra) {
    return '' +
      '<div class="lt-blank">' +
        '<div class="lt-blank__icon" aria-hidden="true"><i class="' + icon + '"></i></div>' +
        '<h3 class="lt-blank__title">' + title + '</h3>' +
        (text ? '<p class="lt-blank__text">' + text + '</p>' : '') +
        (extra || '') +
      '</div>';
  }

  async function authToken() {
    try {
      var r = await window.bwcSupabase.auth.getSession();
      return (r && r.data && r.data.session && r.data.session.access_token) || null;
    } catch (e) { return null; }
  }

  async function fetchTranscript(key) {
    var headers = {};
    var token = await authToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch('/api/lesson-transcript?lesson=' + encodeURIComponent(key), { headers: headers });
    var data = await res.json().catch(function () { return {}; });
    return { status: res.status, data: data };
  }

  /* ---------- העתקה ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    /* נפילה לדפדפנים ישנים / הקשר לא מאובטח */
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.insetInlineStart = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy_failed'));
    });
  }

  function wireCopy(pane, entry) {
    var btn = pane.querySelector('[data-action="copy-transcript"]');
    var status = pane.querySelector('.ltr__status');
    if (!btn) return;
    var label = btn.querySelector('span');
    var icon = btn.querySelector('i');
    var timer = null;

    btn.addEventListener('click', function () {
      var payload = (entry.title ? entry.title + '\n\n' : '') + entry.text;
      copyText(payload).then(function () {
        btn.classList.add('is-done');
        icon.className = 'fa-solid fa-check';
        label.textContent = 'הועתק';
        status.textContent = 'התמלול המלא הועתק ללוח';
      }, function () {
        /* ההעתקה נחסמה: מסמנים את הטקסט כדי שאפשר יהיה ללחוץ Ctrl+C */
        var body = pane.querySelector('.ltr__body');
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(body);
        sel.removeAllRanges();
        sel.addRange(range);
        label.textContent = 'סומן — לחצו Ctrl+C';
        status.textContent = 'ההעתקה האוטומטית נחסמה. הטקסט סומן, אפשר להעתיק ידנית';
      });
      clearTimeout(timer);
      timer = setTimeout(function () {
        btn.classList.remove('is-done');
        icon.className = 'fa-regular fa-copy';
        label.textContent = 'העתקת התמלול';
      }, 2400);
    });
  }

  /* ---------- רינדור ---------- */

  function renderEntry(pane, entry) {
    var words = entry.text.split(/\s+/).filter(Boolean).length;
    var minutes = Math.max(1, Math.round(words / 200));
    var paragraphs = entry.text.split(/\n{2,}/).map(function (p) {
      return '<p>' + esc(p) + '</p>';
    }).join('');

    pane.innerHTML = '' +
      '<div class="ltr">' +
        '<div class="ltr__bar">' +
          '<div class="ltr__meta">' +
            '<strong class="ltr__title">' + esc(entry.title || 'תמלול השיעור') + '</strong>' +
            '<span class="ltr__count">' + words.toLocaleString('he-IL') + ' מילים · כ-' + minutes + ' דק\' קריאה</span>' +
          '</div>' +
          '<button type="button" class="btn btn--gold ltr__copy" data-action="copy-transcript">' +
            '<i class="fa-regular fa-copy" aria-hidden="true"></i> <span>העתקת התמלול</span>' +
          '</button>' +
        '</div>' +
        '<p class="ltr__note">תמלול אוטומטי מתוך הסרטון, בלי עריכה ובלי סימני פיסוק.</p>' +
        '<div class="ltr__body" tabindex="0" aria-label="התמלול המלא של השיעור">' + paragraphs + '</div>' +
        '<span class="visually-hidden ltr__status" role="status" aria-live="polite"></span>' +
      '</div>';

    wireCopy(pane, entry);
  }

  async function render(pane, key) {
    if (!pane) return;
    requested = key;

    if (!key) {
      pane.innerHTML = stateHtml('fa-solid fa-file-lines', 'בחרו שיעור כדי לראות את התמלול',
        'התמלול המלא של כל שיעור מופיע כאן, עם כפתור העתקה בלחיצה אחת.');
      return;
    }

    if (cache[key]) { renderEntry(pane, cache[key]); return; }

    if (window.bwcApi && !window.bwcApi.available) {
      pane.innerHTML = window.bwcApi.unavailableHtml();
      return;
    }

    pane.innerHTML = '<div class="ltr__loading"><i class="fa-solid fa-circle-notch" aria-hidden="true"></i><span>טוען את התמלול…</span></div>';

    var r;
    try { r = await fetchTranscript(key); }
    catch (e) { r = { status: 0, data: {} }; }

    if (requested !== key) return;   // הלומד כבר עבר לשיעור אחר

    if (r.status === 200 && r.data && r.data.ok) {
      cache[key] = { title: r.data.title, text: r.data.text };
      renderEntry(pane, cache[key]);
      return;
    }

    if (r.status === 401) {
      pane.innerHTML = stateHtml('fa-solid fa-lock', 'התמלול זמין למשתמשים מחוברים',
        'ההתחברות חינמית ולוקחת חצי דקה, והיא גם שומרת את ההתקדמות שלך בענן.',
        '<button type="button" class="btn btn--gold" data-action="open-login">התחברות / הרשמה</button>');
      var b = pane.querySelector('[data-action="open-login"]');
      if (b) b.addEventListener('click', function () {
        if (typeof window.openLoginModal === 'function') window.openLoginModal();
      });
      return;
    }

    if (r.status === 404) {
      pane.innerHTML = stateHtml('fa-regular fa-file', 'לשיעור הזה אין עדיין תמלול',
        'הסרטון הזה לא תומלל במערכת. כל שאר השיעורים כוללים תמלול מלא.');
      return;
    }

    var retry = '<button type="button" class="btn btn--gold" data-action="retry-transcript">לנסות שוב</button>';
    pane.innerHTML = stateHtml('fa-solid fa-triangle-exclamation',
      r.status === 429 ? 'יותר מדי בקשות ברגע אחד' : 'לא הצלחנו לטעון את התמלול',
      r.status === 429 ? 'חכו דקה ונסו שוב.' : 'בדקו את החיבור לאינטרנט ונסו שוב.', retry);
    var rb = pane.querySelector('[data-action="retry-transcript"]');
    if (rb) rb.addEventListener('click', function () { render(pane, key); });
  }

  window.LessonTranscript = { render: render };
})();
