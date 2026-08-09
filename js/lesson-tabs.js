/* ==============================================================
   lesson-tabs.js — רצועת הטאבים של דף השיעור
   עסק ללא מתחרים · Vanilla JS, בלי פריימוורק, בלי שלב בנייה

   מה זה פותר (מילים של הלל):
     "אין מעבר חלק בין טאבים וחזרה לטאב הקודם."

   מה יש כאן:
     1. רצועת טאבים נגישה (role=tablist + חצים + Home/End)
     2. ניתוב ב-hash:  #lesson=m0-1-0&tab=practice
        → אפשר לשתף קישור לטאב, ורענון נשאר על אותו טאב
     3. history.pushState לכל מעבר טאב
        → "אחורה" בדפדפן מחזיר לטאב הקודם, לא לדף הקודם
     4. זיכרון טאב אחרון פר שיעור (localStorage)
     5. הטמעה עצלה של תרגול/מבחן ב-iframe.
        הפריים נוצר פעם אחת וממשיך לחיות — מעבר טאב רק מסתיר
        אותו, ולכן סבב תרגול באמצע ממשיך בדיוק מאיפה שהיה.

   למה iframe ולא הזרקת המנוע לתוך הדף:
     js/practice.js הוא סקריפט בסקופ גלובלי (state, showToast,
     init, escHtml…) והוא היה מתנגש בגלובלים של index.html.
     בנוסף css/practice.css מכיל שכבות position:fixed שהיו
     מכסות את כל דף השיעור. iframe מריץ את *אותו* מנוע בדיוק,
     בלי לשכפל שורת קוד אחת ובלי לגעת ב-pages/practice.html
     או ב-pages/quiz.html כדפים עצמאיים.
   ============================================================== */

(function () {
  'use strict';

  /* ================================================================
     קבועים
     ================================================================ */

  var TABS = ['about', 'ai', 'resources', 'practice', 'quiz', 'notes'];
  var DEFAULT_TAB = 'about';
  var LAST_TAB_KEY = 'bwc_lesson_tab_last';

  function memKey(lessonKey) { return 'bwc_lesson_tab_' + lessonKey; }

  /* ================================================================
     מצב
     ================================================================ */

  var opts = null;
  var tabButtons = {};   // name → button
  var panes = {};        // name → pane element
  var active = null;
  var booted = false;

  /* הטמעות: נבנות בפעם הראשונה שנכנסים לטאב, ואז חיות עד לרענון */
  var embeds = {
    practice: {
      pane: 'practice',
      cls: 'lt-embed--game',
      title: 'תרגול השיעור',
      wrap: null,
      frame: null,
      loadedUrl: null,
      url: function () {
        var key = opts.getLessonKey();
        if (!key) return null;
        return 'pages/practice.html?embed=1&lesson=' + encodeURIComponent(key);
      },
      blank: function () {
        return blankHtml(
          'fa-solid fa-gamepad',
          'בחרו שיעור כדי לתרגל אותו',
          'התרגול כאן תמיד בהקשר של השיעור שפתוח — האתגרים נשלפים מהתמלול שלו. בחרו שיעור מהתפריט בצד, והתרגול יופיע כאן.',
          'pages/practice.html',
          'למפת התרגול המלאה'
        );
      }
    },
    quiz: {
      pane: 'quiz',
      cls: 'lt-embed--quiz',
      title: 'מבחן המודול',
      wrap: null,
      frame: null,
      loadedUrl: null,
      url: function () {
        var mi = opts.getModuleIdx();
        return 'pages/quiz.html?embed=1' + (mi >= 0 ? '&quiz=' + mi : '');
      },
      blank: function () { return null; }   // רשימת המבחנים תמיד שימושית
    }
  };

  /* ================================================================
     עזרים
     ================================================================ */

  function blankHtml(icon, title, text, href, cta) {
    return '' +
      '<div class="lt-blank">' +
        '<div class="lt-blank__icon" aria-hidden="true"><i class="' + icon + '"></i></div>' +
        '<h3 class="lt-blank__title">' + title + '</h3>' +
        '<p class="lt-blank__text">' + text + '</p>' +
        (href ? '<a class="btn btn--gold" href="' + href + '">' + cta +
                ' <i class="fa-solid fa-arrow-left" aria-hidden="true"></i></a>' : '') +
      '</div>';
  }

  function parseHash() {
    var out = { lesson: null, tab: null };
    var h = String(window.location.hash || '').replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (chunk) {
      var eq = chunk.indexOf('=');
      if (eq < 0) return;
      var k = chunk.slice(0, eq);
      var v = decodeURIComponent(chunk.slice(eq + 1));
      if (k === 'lesson') out.lesson = v;
      if (k === 'tab' && TABS.indexOf(v) >= 0) out.tab = v;
    });
    return out;
  }

  function buildHash(tab) {
    var key = opts.getLessonKey();
    return key ? '#lesson=' + key + '&tab=' + tab : '#tab=' + tab;
  }

  function remember(tab) {
    try {
      localStorage.setItem(LAST_TAB_KEY, tab);
      var key = opts.getLessonKey();
      if (key) localStorage.setItem(memKey(key), tab);
    } catch (e) { /* מצב פרטי / מכסה — לא קריטי */ }
  }

  function recall(lessonKey) {
    try {
      if (lessonKey) {
        var per = localStorage.getItem(memKey(lessonKey));
        if (per && TABS.indexOf(per) >= 0) return per;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ================================================================
     הטמעות (iframe)
     ================================================================ */

  function mountEmbed(spec) {
    var pane = panes[spec.pane];
    if (!pane) return;

    var url = spec.url();

    /* אין מה להטמיע — מצב ריק מכובד בתוך הפאנל עצמו */
    if (!url) {
      var blank = spec.blank();
      if (blank !== null) {
        pane.classList.remove('lt__pane--flush');
        pane.innerHTML = blank;
        spec.wrap = null;
        spec.frame = null;
        spec.loadedUrl = null;
      }
      return;
    }

    /* כבר טעון על אותו URL — אין מה לעשות, זה בדיוק העניין:
       חוזרים לטאב והסבב ממשיך מאיפה שהיה. */
    if (spec.frame && spec.loadedUrl === url) return;

    if (!spec.frame) {
      /* יצירה ראשונה: ה-src נקבע *לפני* ההוספה ל-DOM כדי שלא
         תיווצר רשומת היסטוריה — אחרת "אחורה" היה מדלג עליה
         במקום לחזור לטאב הקודם. */
      pane.classList.add('lt__pane--flush');
      pane.innerHTML = '';

      var wrap = document.createElement('div');
      wrap.className = 'lt-embed ' + spec.cls;

      var skeleton = document.createElement('div');
      skeleton.className = 'lt-embed__skeleton';
      skeleton.innerHTML = '<i class="fa-solid fa-circle-notch" aria-hidden="true"></i><span>טוען…</span>';

      var frame = document.createElement('iframe');
      frame.title = spec.title;
      frame.loading = 'lazy';
      frame.setAttribute('allow', 'clipboard-write');
      frame.src = url;
      frame.addEventListener('load', function () { wrap.classList.add('is-ready'); });

      wrap.appendChild(skeleton);
      wrap.appendChild(frame);
      pane.appendChild(wrap);

      spec.wrap = wrap;
      spec.frame = frame;
      spec.loadedUrl = url;
      return;
    }

    /* השיעור התחלף — מפנים מחדש ב-location.replace ולא ב-src,
       כי השמה ל-src על iframe קיים דוחפת רשומת היסטוריה. */
    spec.wrap.classList.remove('is-ready');
    try {
      spec.frame.contentWindow.location.replace(url);
    } catch (e) {
      spec.frame.src = url;   // fallback (לא אמור לקרות — same-origin)
    }
    spec.loadedUrl = url;
  }

  /** מסמן הטמעה כלא-עדכנית. הטעינה בפועל תקרה רק כשנכנסים לטאב. */
  function invalidateEmbeds() {
    Object.keys(embeds).forEach(function (k) {
      var spec = embeds[k];
      if (!spec.frame) { spec.loadedUrl = null; return; }
      if (spec.loadedUrl !== spec.url()) {
        /* אם הטאב פתוח כרגע — מרעננים מיד; אחרת ממתינים לכניסה */
        if (active === k) mountEmbed(spec);
      }
    });
  }

  function scrollStripIntoView(delay) {
    var run = function () {
      var host = document.querySelector('.lt');
      if (!host) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      /* scroll-margin-block-start מוגדר ב-css/lesson-tabs.css כדי שהניווט
         העליון הדביק לא יכסה את הרצועה. */
      host.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    };
    /* בטעינת deep link הפריסה עוד זזה (ההירו נעלם, הנגן נפתח), אז
       גלילה מיידית הייתה נוחתת על מיקום שכבר לא קיים. */
    if (delay) setTimeout(run, delay); else run();
  }

  /* ================================================================
     החלפת טאב
     ================================================================ */

  /**
   * @param {string} name
   * @param {{push?:boolean, focus?:boolean, force?:boolean}} o
   */
  function activate(name, o) {
    o = o || {};
    if (TABS.indexOf(name) < 0) name = DEFAULT_TAB;
    if (name === active && !o.force) return;

    active = name;

    TABS.forEach(function (t) {
      var btn = tabButtons[t];
      var pane = panes[t];
      var on = (t === name);
      if (btn) {
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      }
      if (pane) {
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
      }
    });

    if (embeds[name]) mountEmbed(embeds[name]);

    /* מביאים את הרצועה לראש המסך. בלי זה, בטלפון, סרגל "בדוק תשובה"
       של התרגול (position:fixed בתחתית המסגרת) יכול לנחות מתחת לקצה
       המסך והלומד היה צריך לגלול את הדף כדי לענות. */
    if (o.push) scrollStripIntoView();
    else if (o.initial && embeds[name]) scrollStripIntoView(220);

    remember(name);

    /* ההיסטוריה: replace בטעינה הראשונה, push בכל מעבר מכוון.
       ככה "אחורה" עובר טאב-טאב, ורק בסוף יוצא מהדף. */
    var hash = buildHash(name);
    var st = { ltTab: name, ltLesson: opts.getLessonKey() };
    try {
      if (o.push) history.pushState(st, '', hash);
      else if (o.push !== false) history.replaceState(st, '', hash);
    } catch (e) { /* file:// חוסם pushState — הטאבים עדיין עובדים */ }

    if (o.focus && tabButtons[name]) tabButtons[name].focus();
    if (opts.onActivate) opts.onActivate(name);
  }

  /* ================================================================
     ניווט מקלדת
     ================================================================ */

  function onTabKeydown(e) {
    var idx = TABS.indexOf(active);
    var next = null;

    /* RTL: חץ שמאל = הבא, חץ ימין = הקודם */
    if (e.key === 'ArrowLeft')       next = TABS[(idx + 1) % TABS.length];
    else if (e.key === 'ArrowRight') next = TABS[(idx - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home')       next = TABS[0];
    else if (e.key === 'End')        next = TABS[TABS.length - 1];
    else return;

    e.preventDefault();
    /* ⚠️ חובה: ל-index.html יש מאזין חצים גלובלי על document שמדלג
       שיעור קדימה/אחורה. בלי לעצור את הבועה, חץ על הרצועה היה מחליף
       גם טאב וגם שיעור באותה לחיצה. */
    e.stopPropagation();
    activate(next, { push: true, focus: true });
  }

  /* ================================================================
     API ציבורי
     ================================================================ */

  var api = {
    /**
     * @param {{
     *   getLessonKey: function():(string|null),
     *   getModuleIdx: function():number,
     *   selectLessonByKey?: function(string):boolean,
     *   onActivate?: function(string)
     * }} config
     */
    init: function (config) {
      if (booted) return;
      opts = config;

      TABS.forEach(function (t) {
        tabButtons[t] = document.querySelector('.lt__tab[data-tab="' + t + '"]');
        panes[t] = document.querySelector('.lt__pane[data-pane="' + t + '"]');
        if (tabButtons[t]) {
          tabButtons[t].addEventListener('click', function () {
            activate(t, { push: true });
          });
          tabButtons[t].addEventListener('keydown', onTabKeydown);
        }
      });

      booted = true;

      /* טאב פתיחה: hash > זיכרון פר-שיעור > זיכרון גלובלי > ברירת מחדל */
      var h = parseHash();
      var start = h.tab
        || recall(opts.getLessonKey())
        || null;

      if (!start) {
        try {
          var last = localStorage.getItem(LAST_TAB_KEY);
          if (last && TABS.indexOf(last) >= 0) start = last;
        } catch (e) { /* ignore */ }
      }

      activate(start || DEFAULT_TAB, { push: false, force: true, initial: true });

      window.addEventListener('popstate', function (ev) {
        var st = ev && ev.state;
        var fromHash = parseHash();
        var tab = (st && st.ltTab) || fromHash.tab || DEFAULT_TAB;
        var lesson = (st && st.ltLesson) || fromHash.lesson || null;

        /* אם ההיסטוריה מצביעה על שיעור אחר — מחזירים גם אותו */
        if (lesson && lesson !== opts.getLessonKey() && opts.selectLessonByKey) {
          opts.selectLessonByKey(lesson);
        }
        activate(tab, { push: false, force: true });
      });
    },

    /** נקרא מ-index.html בכל בחירת שיעור. */
    onLessonChange: function () {
      if (!booted) return;
      var key = opts.getLessonKey();
      var wanted = recall(key);

      /* יש זיכרון לשיעור הזה → פותחים אותו.
         אין → נשארים בטאב הנוכחי (רצף לימוד: מי שמתרגל
         ועובר לשיעור הבא רוצה להמשיך לתרגל). */
      if (wanted && wanted !== active) {
        activate(wanted, { push: false, force: true });
      } else {
        try {
          history.replaceState(
            { ltTab: active, ltLesson: key }, '', buildHash(active)
          );
        } catch (e) { /* ignore */ }
      }
      invalidateEmbeds();
    },

    /** פתיחת טאב מבחוץ (FAB של המאמן, קישורים פנימיים). */
    open: function (name) { activate(name, { push: true }); },

    /** הטאב הפעיל כרגע. */
    current: function () { return active; },

    /** קריאת השיעור מה-hash — לשימוש ב-deep link בטעינה. */
    hashLesson: function () { return parseHash().lesson; }
  };

  window.LessonTabs = api;
})();
