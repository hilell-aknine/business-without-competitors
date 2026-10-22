/* ==========================================================================
   chat-composer.js — shared writing box + full-screen mode for the AI chats.
   Added 2026-10-22 (Hillel: "מרגיש מוגבל בתווים, וחוויית הכתיבה לא טובה").

   Used by:
     js/protocol.js     — "שאל את השיעור" in the lesson's מורה AI tab
     js/apply-coach.js  — the interview chat in pages/apply.html

   window.bwcComposer.enhance(textarea, opts) -> { clearDraft(), grow() }
     opts.onSend()      called on Ctrl/Cmd+Enter
     opts.max           char limit (default MAX_CHARS)
     opts.draftKey      localStorage key (string, or a function returning one):
                        unsent text survives reloads and errors
     * auto-grows with the text up to a CSS max-height, then scrolls
     * Enter = new line. Ctrl/Cmd+Enter = send (a long answer is never sent
       by accident). The send button still works everywhere, incl. phones.
     * counter appears only near the limit (80%+)

   window.bwcComposer.fullscreen
     .bind(button, panel, { onChange(open), opener })  toggle button for a
        panel; `opener` = a container (e.g. composer.foot) that gets a second
        small "כתיבה במסך מלא" button next to the writing box
     .enter(panel) / .exit() / .isOpen()
     * the panel is moved to <body> while open, so no ancestor transform /
       backdrop-filter / z-index can trap the fixed layer; it goes back to
       its exact place on exit
     * Esc closes; focus returns to the toggle button
     * follows window.visualViewport, so the phone keyboard never covers
       the writing box
   ========================================================================== */
(function () {
  'use strict';
  if (window.bwcComposer) return;

  var MAX_CHARS = 10000;
  var WARN_AT = 0.8;
  var nf = (function () {
    try { return new Intl.NumberFormat('he-IL'); } catch (_) { return { format: String }; }
  })();

  function isTouch() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
  }
  function isMac() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  }

  /* ------------------------------------------------------------ composer */

  function enhance(ta, opts) {
    if (!ta) return null;
    if (ta._bwcComposer) return ta._bwcComposer;
    opts = opts || {};
    var max = opts.max || MAX_CHARS;

    ta.maxLength = max;
    ta.classList.add('bwc-composer');
    ta.setAttribute('dir', 'auto');

    // Footer under the input row: shortcut hint + (near the limit) a counter.
    var foot = document.createElement('div');
    foot.className = 'bwc-composer__foot';
    var hint = document.createElement('span');
    hint.className = 'bwc-composer__hint';
    hint.textContent = isTouch()
      ? 'Enter יורד שורה. כדי לשלוח, לחץ על הכפתור.'
      : 'Enter יורד שורה · ' + (isMac() ? 'Cmd' : 'Ctrl') + '+Enter שולח';
    var count = document.createElement('span');
    count.className = 'bwc-composer__count';
    count.setAttribute('aria-live', 'polite');
    count.hidden = true;
    foot.appendChild(hint);
    foot.appendChild(count);
    var row = opts.row || ta.parentElement;
    if (row && row.parentNode) row.parentNode.insertBefore(foot, row.nextSibling);

    function grow() {
      ta.style.height = 'auto';
      var cs = getComputedStyle(ta);
      var border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      ta.style.height = (ta.scrollHeight + border) + 'px';
    }

    function updateCount() {
      var len = ta.value.length;
      if (len < max * WARN_AT) { count.hidden = true; count.className = 'bwc-composer__count'; return; }
      count.hidden = false;
      var left = max - len;
      count.className = 'bwc-composer__count' + (left <= max * 0.05 ? ' is-near' : '');
      count.textContent = left > 0
        ? 'נשארו ' + nf.format(left) + ' תווים מתוך ' + nf.format(max)
        : 'הגעת לאורך המקסימלי, ' + nf.format(max) + ' תווים';
    }

    function draftKey() {
      var k = typeof opts.draftKey === 'function' ? opts.draftKey() : opts.draftKey;
      return k ? String(k) : '';
    }
    var draftTimer = null;
    function saveDraft() {
      var k = draftKey();
      if (!k) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(function () {
        try {
          if (ta.value.trim()) localStorage.setItem(k, ta.value);
          else localStorage.removeItem(k);
        } catch (_) {}
      }, 400);
    }
    function clearDraft() {
      clearTimeout(draftTimer);
      var k = draftKey();
      try { if (k) localStorage.removeItem(k); } catch (_) {}
    }
    // Put the saved draft (if any) into the box. Called on enhance, and by
    // pages whose draft key changes (apply.html switches modules).
    function loadDraft() {
      clearTimeout(draftTimer);
      var k = draftKey();
      var d = null;
      try { d = k ? localStorage.getItem(k) : null; } catch (_) {}
      ta.value = d ? d.slice(0, max) : '';
      grow(); updateCount();
    }

    if (!ta.value && draftKey()) {
      try {
        var d0 = localStorage.getItem(draftKey());
        if (d0) ta.value = d0.slice(0, max);
      } catch (_) {}
    }

    ta.addEventListener('input', function () { grow(); updateCount(); saveDraft(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (typeof opts.onSend === 'function') opts.onSend();
      }
      // Plain Enter / Shift+Enter: default behaviour, a new line.
    });

    var api = {
      grow: grow,
      clearDraft: clearDraft,
      loadDraft: loadDraft,
      refresh: function () { grow(); updateCount(); },
      foot: foot,
    };
    ta._bwcComposer = api;
    requestAnimationFrame(function () { grow(); updateCount(); });
    return api;
  }

  /* ---------------------------------------------------------- fullscreen */

  var fs = { panel: null, placeholder: null, button: null, onChange: null };

  function setVV() {
    if (!fs.panel) return;
    var vv = window.visualViewport;
    if (vv) {
      fs.panel.style.setProperty('--bwc-fs-h', vv.height + 'px');
      fs.panel.style.setProperty('--bwc-fs-top', vv.offsetTop + 'px');
    } else {
      fs.panel.style.setProperty('--bwc-fs-h', window.innerHeight + 'px');
      fs.panel.style.setProperty('--bwc-fs-top', '0px');
    }
    var log = fs.panel.querySelector('[data-fs-log]');
    if (log && document.activeElement && fs.panel.contains(document.activeElement) &&
        document.activeElement.tagName === 'TEXTAREA') {
      log.scrollTop = log.scrollHeight;
    }
  }

  function onKey(e) {
    if (e.key === 'Escape' && fs.panel) {
      // Let an open login modal handle its own Esc first.
      if (document.querySelector('.bwc-auth-overlay.is-open, .bwc-auth-overlay[open]')) return;
      e.preventDefault();
      exit();
    }
  }

  function paintButton(btn, open) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'יציאה ממסך מלא' : 'פתיחה במסך מלא');
    btn.title = open ? 'יציאה ממסך מלא (Esc)' : 'מסך מלא';
    btn.innerHTML = open
      ? '<i class="fa-solid fa-xmark" aria-hidden="true"></i><span>יציאה ממסך מלא</span>'
      : '<i class="fa-solid fa-expand" aria-hidden="true"></i><span>מסך מלא</span>';
  }

  function enter(panel, btn, onChange) {
    if (!panel || fs.panel === panel) return;
    if (fs.panel) exit();
    fs.panel = panel;
    fs.button = btn || null;
    fs.onChange = onChange || null;
    fs.placeholder = document.createComment('bwc-chat-fs');
    panel.parentNode.insertBefore(fs.placeholder, panel);
    document.body.appendChild(panel);
    panel.classList.add('bwc-chat-fs');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    document.documentElement.classList.add('bwc-chat-fs-open');
    setVV();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVV);
      window.visualViewport.addEventListener('scroll', setVV);
    }
    window.addEventListener('resize', setVV);
    document.addEventListener('keydown', onKey, true);
    paintButton(fs.button, true);

    var log = panel.querySelector('[data-fs-log]');
    if (log) log.scrollTop = log.scrollHeight;
    var ta = panel.querySelector('textarea');
    if (ta && ta._bwcComposer) ta._bwcComposer.grow();
    // Desktop: straight into writing. Phone: don't pop the keyboard uninvited.
    if (ta && !isTouch()) { try { ta.focus({ preventScroll: true }); } catch (_) { ta.focus(); } }
    if (fs.onChange) fs.onChange(true);
  }

  function exit() {
    var panel = fs.panel;
    if (!panel) return;
    var btn = fs.button;
    var cb = fs.onChange;
    panel.classList.remove('bwc-chat-fs');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.style.removeProperty('--bwc-fs-h');
    panel.style.removeProperty('--bwc-fs-top');
    if (fs.placeholder && fs.placeholder.parentNode) {
      fs.placeholder.parentNode.insertBefore(panel, fs.placeholder);
      fs.placeholder.parentNode.removeChild(fs.placeholder);
    } else if (panel.parentNode) {
      // Its old home was rebuilt (lesson switched): drop the stale panel.
      panel.parentNode.removeChild(panel);
    }
    document.documentElement.classList.remove('bwc-chat-fs-open');
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', setVV);
      window.visualViewport.removeEventListener('scroll', setVV);
    }
    window.removeEventListener('resize', setVV);
    document.removeEventListener('keydown', onKey, true);
    fs.panel = fs.placeholder = fs.button = fs.onChange = null;
    paintButton(btn, false);
    var ta = panel.querySelector('textarea');
    if (ta && ta._bwcComposer) ta._bwcComposer.grow();
    if (btn && btn.isConnected) { try { btn.focus({ preventScroll: true }); } catch (_) {} }
    if (cb) cb(false);
  }

  function bind(btn, panel, opts) {
    if (!btn || !panel) return;
    opts = opts || {};
    paintButton(btn, false);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (fs.panel === panel) exit();
      else enter(panel, btn, opts.onChange);
    });

    // A second way in, right under the writing box: on a phone the header
    // button has usually scrolled away by the time you are typing.
    if (opts.opener) {
      var o = document.createElement('button');
      o.type = 'button';
      o.className = 'bwc-fs-open';
      o.setAttribute('data-fs-hide', '');
      o.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i><span>כתיבה במסך מלא</span>';
      o.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        enter(panel, btn, opts.onChange);
      });
      opts.opener.appendChild(o);
    }
  }

  window.bwcComposer = Object.freeze({
    MAX_CHARS: MAX_CHARS,
    enhance: enhance,
    fullscreen: Object.freeze({
      bind: bind,
      enter: enter,
      exit: exit,
      isOpen: function () { return !!fs.panel; },
      panel: function () { return fs.panel; },
    }),
  });
})();
