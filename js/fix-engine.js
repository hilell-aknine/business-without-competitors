/* ============================================================================
 * FIX ENGINE — מנוע תיקונים (פיגום נשלף · white-label · תבנית סקיל)
 * ----------------------------------------------------------------------------
 * Alt+קליק על כל אלמנט → תיבת הערה → Enter. נשמר לוח קנבן (הזנתי/בטיפול/הושלם).
 * ייצוא ל-JSON → אומרים לקלוד "תיקון" → טעינת דוח חזרה → אישור ידני.
 *
 * התקנה: הנח קובץ זה תחת js/ (או תיקיית הסקריפטים של הפרויקט), הוסף בסוף ה-HTML:
 *   <script src="js/fix-engine.js?v=1" data-project="שם-פרויקט-קצר"></script>
 * ותייג פעם-אחת את המכלים הגדולים ב-data-area="שם-אזור" data-src="קובץ-מקור".
 * data-project חובה: localStorage משותף לכל ה-origin (למשל localhost:8765 לכל
 * הפרויקטים) — בלעדיו הלוח יציג כרטיסים של פרויקטים אחרים שנבדקו על אותו פורט.
 *
 * הסרה מלאה (מהלך אחד): מחק את שורת ה-<script> ואת הקובץ הזה. אין תלות ב-DB.
 * כיבוי בזמן ריצה: localStorage 'fixEngine.enabled' = 'false'.
 *
 * שדרוג לסבב אוטומטי (פרויקט עם Supabase/שרת): החלף persist()/export/import
 * בקריאות ל-API. ראה §5 ב-SKILL.md.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__fixEngineLoaded) return;
  window.__fixEngineLoaded = true;

  /* שער פרודקשן (2026-07-22): בדומיין חי המנוע כבוי כברירת מחדל — תלמידים/לקוחות לא
   * רואים את כפתור ה-🛠️. הפעלה: להוסיף ?fix=1 ל-URL פעם אחת (נשמר ב-localStorage).
   * כיבוי חוזר: localStorage 'fixEngine.enabled'='false'. ב-localhost פעיל תמיד (פיתוח). */
  var qsFix = /[?&]fix=1\b/.test(location.search);
  if (qsFix) { try { localStorage.setItem('fixEngine.enabled', 'true'); } catch (e) {} }
  var isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var optState = null;
  try { optState = localStorage.getItem('fixEngine.enabled'); } catch (e) {}
  if (optState === 'false') return;
  if (!qsFix && optState !== 'true' && !isLocalHost) return;

  /* מרחב-שמות פר-פרויקט. המפתח הגלובלי הישן 'fixEngine.tickets.v1' (בלי סיומת)
   * מוזנח בכוונה — הוא מכיל כרטיסים מעורבים מכמה פרויקטים שרצו על אותו origin. */
  var project = (document.currentScript && document.currentScript.getAttribute('data-project')) || 'default';
  var KEY = 'fixEngine.tickets.v1.' + project;
  var tickets = JSON.parse(localStorage.getItem(KEY) || '[]');
  var enabled = true; /* השער למעלה כבר סינן — אם הגענו לכאן, המנוע פעיל */
  var pendingCtx = null, hlEl = null;

  /* שם קובץ ההורדה — data-project אם הוגדר, אחרת נגזר מכותרת הדף (white-label) */
  var slug = project !== 'default' ? project
    : (document.title || 'app').trim().replace(/\s+/g, '-').replace(/[^\w֐-׿-]/g, '').slice(0, 40) || 'app';
  var DOWNLOAD_NAME = 'fixes-' + slug + '.json';

  /* ---------- CSS מוזרק ---------- */
  var css = document.createElement('style');
  css.id = 'fe-style';
  css.textContent = [
    '.fe-hl{outline:2px dashed #D4AF37!important;outline-offset:2px;cursor:crosshair!important}',
    '#fe-popup{position:fixed;z-index:99999;background:#14263a;border:1px solid #D4AF37;border-radius:12px;padding:12px;width:300px;box-shadow:0 12px 40px rgba(0,0,0,.55);display:none;font-family:system-ui,sans-serif;direction:rtl}',
    '#fe-popup .fe-target{font-size:.7rem;color:#9db4cc;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#fe-popup textarea{width:100%;height:64px;background:#0d1a2a;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eaf1f8;font-family:inherit;font-size:.9rem;padding:8px;resize:none;box-sizing:border-box}',
    '#fe-popup textarea:focus{outline:1px solid #4a7fb5}',
    '#fe-popup .fe-hint{font-size:.66rem;color:#6f8299;margin-top:6px}',
    '#fe-fab{position:fixed;bottom:78px;left:16px;z-index:99998;background:#D4AF37;color:#0d1a2a;border:none;border-radius:99px;padding:11px 18px;font-family:system-ui,sans-serif;font-weight:700;font-size:.9rem;cursor:pointer;box-shadow:0 6px 24px rgba(212,175,55,.4);display:flex;align-items:center;gap:7px;direction:rtl}',
    '#fe-fab .count{background:#0d1a2a;color:#D4AF37;border-radius:99px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:.78rem;padding:0 6px}',
    '#fe-board{position:fixed;inset:0;z-index:99999;background:rgba(6,14,24,.9);backdrop-filter:blur(6px);display:none;overflow:auto;padding:30px 20px;font-family:system-ui,sans-serif;direction:rtl}',
    '#fe-board.open{display:block}',
    '.fe-board-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;max-width:1180px;margin:0 auto 20px}',
    '.fe-board-head h2{font-size:1.4rem;color:#eaf1f8;margin:0}.fe-board-head h2 span{color:#D4AF37}',
    '.fe-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.fe-btn{background:#22496e;color:#fff;border:none;border-radius:9px;padding:8px 15px;font-family:inherit;font-size:.82rem;cursor:pointer}',
    '.fe-btn.gold{background:#D4AF37;color:#0d1a2a;font-weight:700}',
    '.fe-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:1180px;margin:0 auto}',
    '@media(max-width:760px){.fe-cols{grid-template-columns:1fr}}',
    '.fe-col{background:#0f2136;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px;min-height:120px}',
    '.fe-col h3{font-size:.9rem;font-weight:700;color:#eaf1f8;margin:0 0 12px;display:flex;align-items:center;gap:7px}',
    '.fe-col h3 .dot{width:9px;height:9px;border-radius:50%}',
    '.fe-col[data-col="הזנתי"] .dot{background:#4a7fb5}.fe-col[data-col="בטיפול"] .dot{background:#D4AF37}.fe-col[data-col="הושלם"] .dot{background:#5fc48a}',
    '.fe-card{background:#14263a;border:1px solid rgba(255,255,255,.09);border-radius:11px;padding:11px 13px;margin-bottom:11px;font-size:.84rem;color:#eaf1f8}',
    '.fe-card .fe-id{font-size:.66rem;color:#D4AF37;margin-bottom:4px;display:flex;justify-content:space-between}',
    '.fe-card .fe-note{line-height:1.5;margin-bottom:8px}',
    '.fe-card .fe-ctx{font-size:.68rem;color:#9db4cc;line-height:1.6;border-top:1px dashed rgba(255,255,255,.1);padding-top:7px;margin-top:4px}',
    '.fe-card .fe-reply{background:rgba(74,127,181,.14);border-right:3px solid #4a7fb5;border-radius:8px;padding:8px 10px;margin-top:8px;font-size:.76rem;line-height:1.6}',
    '.fe-card .fe-reply::before{content:"\\1F916 \\05D3\\05D9\\05D5\\05D5\\05D7 \\05E7\\05DC\\05D5\\05D3: ";color:#8fb8e0;font-weight:700}',
    '.fe-card .fe-btns{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}',
    '.fe-card .fe-btns button{font-size:.72rem;padding:4px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#9db4cc;cursor:pointer;font-family:inherit}',
    '.fe-card .fe-btns button.done{border-color:#5fc48a;color:#5fc48a}',
    '.fe-empty{font-size:.76rem;color:#5f7288;text-align:center;padding:22px 0}',
    '#fe-toast{position:fixed;bottom:140px;left:50%;transform:translateX(-50%);background:#D4AF37;color:#0d1a2a;padding:10px 24px;border-radius:99px;font-weight:700;z-index:100000;display:none;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:system-ui;direction:rtl}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- DOM מוזרק ---------- */
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<button id="fe-fab" title="לוח התיקונים">🛠️ תיקונים <span class="count" id="fe-count">0</span></button>' +
    '<div id="fe-popup"><div class="fe-target" id="fe-popup-target"></div>' +
    '<textarea id="fe-popup-text" placeholder="מה לתקן כאן? משפט אחד..."></textarea>' +
    '<div class="fe-hint">Enter = שמירה · Shift+Enter = שורה · Esc = ביטול</div></div>' +
    '<div id="fe-board"><div class="fe-board-head"><h2>לוח <span>תיקונים</span></h2>' +
    '<div class="fe-actions">' +
    '<button class="fe-btn gold" id="fe-export">⬇ ייצוא ל-JSON</button>' +
    '<label class="fe-btn" style="cursor:pointer">⬆ טעינת דוח קלוד<input type="file" id="fe-import" accept=".json" style="display:none"></label>' +
    '<button class="fe-btn" id="fe-clear-done">נקה הושלמו</button>' +
    '<button class="fe-btn" id="fe-close">✕ סגור</button></div></div>' +
    '<div class="fe-cols">' +
    '<div class="fe-col" data-col="הזנתי"><h3><span class="dot"></span>הזנתי</h3><div class="fe-list"></div></div>' +
    '<div class="fe-col" data-col="בטיפול"><h3><span class="dot"></span>בטיפול</h3><div class="fe-list"></div></div>' +
    '<div class="fe-col" data-col="הושלם"><h3><span class="dot"></span>הושלם</h3><div class="fe-list"></div></div>' +
    '</div></div>' +
    '<div id="fe-toast"></div>';
  document.body.appendChild(wrap);

  var $ = function (s) { return document.querySelector(s); };
  var popup = $('#fe-popup'), popupText = $('#fe-popup-text'), board = $('#fe-board');

  /* ---------- קריאת מצב הלשונית מה-DOM (גנרי, לא תלוי בפריימוורק) ----------
   * מנסה כמה קונבנציות נפוצות: aria-selected, .active, [hidden], data-view. */
  function activeScreen() {
    var tab = document.querySelector('[role="tab"][aria-selected="true"], .tab.active, .active[data-tab], nav .active');
    var view = document.querySelector('.view:not([hidden]), [data-view]:not([hidden]), .tab-panel:not([hidden])');
    return {
      tab: tab ? (tab.getAttribute('aria-label') || tab.dataset.tab || tab.textContent.trim().slice(0, 30)) : null,
      view: view ? (view.getAttribute('data-view') || view.getAttribute('data-tab-panel') || null) : null
    };
  }

  function cssChain(el) {
    var parts = [], cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      var p = cur.tagName.toLowerCase();
      if (cur.id) p += '#' + cur.id;
      else if (cur.classList.length) p += '.' + [].slice.call(cur.classList, 0, 2).join('.');
      if (cur.dataset && cur.dataset.area) p += '[data-area=' + cur.dataset.area + ']';
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(' › ');
  }

  function buildContext(el, x, y) {
    var src = el.closest('[data-src]');
    var area = el.closest('[data-area]');
    var heading = (el.closest('section,.view,.card,.panel') || document.body).querySelector('h1,h2,h3');
    var r = el.getBoundingClientRect();
    return {
      project: project,
      page: location.pathname,
      screen: activeScreen(),
      element: {
        chain: cssChain(el),
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.value || '').trim().slice(0, 120),
        nearbyHeading: heading ? heading.innerText.trim().slice(0, 80) : null,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        clickPoint: { x: x, y: y }
      },
      sourceFile: src ? src.dataset.src : '(אין data-src על מכל האב — נפילה על נתיב+טקסט)',
      area: area ? area.dataset.area : null,
      viewport: { w: innerWidth, h: innerHeight },
      capturedAt: new Date().toISOString()
    };
  }

  /* ---------- Alt+hover ---------- */
  document.addEventListener('mousemove', function (e) {
    if (hlEl) { hlEl.classList.remove('fe-hl'); hlEl = null; }
    if (!enabled || !e.altKey) return;
    var t = e.target;
    if (t === document.body || t.closest('#fe-popup,#fe-board,#fe-fab')) return;
    hlEl = t; t.classList.add('fe-hl');
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'Alt' && hlEl) { hlEl.classList.remove('fe-hl'); hlEl = null; }
  });

  /* ---------- Alt+קליק ---------- */
  document.addEventListener('click', function (e) {
    if (!enabled || !e.altKey) return;
    if (e.target.closest('#fe-popup,#fe-board,#fe-fab')) return;
    e.preventDefault(); e.stopPropagation();
    pendingCtx = buildContext(e.target, e.clientX, e.clientY);
    $('#fe-popup-target').textContent = '🎯 ' + pendingCtx.element.chain;
    popup.style.display = 'block';
    popup.style.left = Math.min(e.clientX, innerWidth - 320) + 'px';
    popup.style.top = Math.min(e.clientY + 12, innerHeight - 160) + 'px';
    popupText.value = ''; popupText.focus();
  }, true);

  popupText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveTicket(); }
    if (e.key === 'Escape') closePopup();
  });
  document.addEventListener('click', function (e) {
    if (popup.style.display === 'block' && !e.target.closest('#fe-popup') && !e.altKey) closePopup();
  });
  function closePopup() { popup.style.display = 'none'; pendingCtx = null; }

  function saveTicket() {
    var note = popupText.value.trim();
    if (!note) return closePopup();
    var id = 'F-' + String(tickets.length + 1).padStart(3, '0');
    tickets.push({ id: id, note: note, status: 'הזנתי', context: pendingCtx, reply: null, createdAt: new Date().toISOString() });
    persist(); closePopup(); toast('נלכד ✓ ' + id);
  }

  /* ---------- לוח ---------- */
  function persist() { localStorage.setItem(KEY, JSON.stringify(tickets)); render(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render() {
    $('#fe-count').textContent = tickets.filter(function (t) { return t.status !== 'הושלם'; }).length;
    document.querySelectorAll('.fe-col').forEach(function (col) {
      var list = col.querySelector('.fe-list'); list.innerHTML = '';
      var items = tickets.filter(function (t) { return t.status === col.dataset.col; });
      if (!items.length) { list.innerHTML = '<div class="fe-empty">— ריק —</div>'; return; }
      items.forEach(function (t) {
        var ctx = t.context || {}, sc = ctx.screen || {};
        var d = document.createElement('div'); d.className = 'fe-card';
        d.innerHTML =
          '<div class="fe-id"><span>' + esc(t.id) + '</span><span>' + new Date(t.createdAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '</span></div>' +
          '<div class="fe-note">' + esc(t.note) + '</div>' +
          '<div class="fe-ctx">📍 ' + esc((sc.tab || '') + (sc.view ? ' / ' + sc.view : '')) + ' · 📄 ' + esc(ctx.sourceFile || '') + '<br>🔗 ' + esc(ctx.element ? ctx.element.chain : '') + '</div>' +
          (t.reply ? '<div class="fe-reply">' + esc(t.reply) + '</div>' : '') +
          '<div class="fe-btns">' +
          (t.status === 'בטיפול' ? '<button class="done" data-act="done">✓ אשר — הושלם</button>' : '') +
          (t.status === 'הזנתי' ? '<button data-act="del">מחק</button>' : '') +
          (t.status === 'הושלם' ? '<button data-act="reopen">פתח מחדש</button>' : '') +
          '</div>';
        d.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            var a = b.dataset.act;
            if (a === 'done') t.status = 'הושלם';
            if (a === 'reopen') t.status = 'הזנתי';
            if (a === 'del') tickets = tickets.filter(function (x) { return x !== t; });
            persist();
          });
        });
        list.appendChild(d);
      });
    });
  }

  $('#fe-fab').addEventListener('click', function () { board.classList.add('open'); });
  $('#fe-close').addEventListener('click', function () { board.classList.remove('open'); });
  $('#fe-clear-done').addEventListener('click', function () {
    tickets = tickets.filter(function (t) { return t.status !== 'הושלם'; }); persist();
  });

  $('#fe-export').addEventListener('click', function () {
    var data = { exportedAt: new Date().toISOString(), source: document.title || location.pathname, tickets: tickets };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = DOWNLOAD_NAME; a.click();
    toast(DOWNLOAD_NAME + ' ירד — עכשיו תגיד לקלוד: "תיקון"');
  });

  $('#fe-import').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var arr = Array.isArray(parsed) ? parsed : (parsed.replies || []);
        var n = 0;
        arr.forEach(function (r) {
          var t = tickets.find(function (x) { return x.id === r.id; });
          if (t) { t.reply = r.reply || t.reply; if (t.status === 'הזנתי') t.status = 'בטיפול'; n++; }
        });
        persist(); toast(n + ' דיווחים נטענו — עבור ואשר');
      } catch (err) { toast('קובץ לא תקין'); }
    };
    reader.readAsText(f); e.target.value = '';
  });

  function toast(msg) {
    var t = $('#fe-toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }

  render();
})();
