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

     opts.voice         default true: a microphone button next to the box
                        (2026-11-16). Records with MediaRecorder, sends the
                        audio to /api/transcribe (Groq Whisper, Hebrew) and
                        APPENDS the text to the box for editing. Never sends.
                        Hidden on the GitHub Pages mirror (no /api there) and
                        in browsers without MediaRecorder.

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

    var voice = null;
    if (opts.voice !== false) voice = attachVoice(ta, row, foot, function () { grow(); updateCount(); saveDraft(); });

    var api = {
      voice: voice,
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

  /* --------------------------------------------------------------- voice */

  var VOICE_MAX_SEC = 120;
  var VOICE_MIN_SEC = 1.2;

  function voiceSupported() {
    if (window.bwcApi && !window.bwcApi.available) return false;   // static mirror
    return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Chrome/Android/Firefox record webm (opus); Safari on iPhone and Mac
  // records mp4 (aac). The server needs the real type to name the file.
  function pickMime() {
    var prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (var i = 0; i < prefs.length; i++) {
      try { if (MediaRecorder.isTypeSupported(prefs[i])) return prefs[i]; } catch (_) {}
    }
    return '';
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  async function authToken() {
    try {
      var r = await window.bwcSupabase.auth.getSession();
      return (r && r.data && r.data.session && r.data.session.access_token) || null;
    } catch (_) { return null; }
  }

  function permissionHelp() {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
    return ios
      ? 'הדפדפן לא קיבל גישה למיקרופון. באייפון: הגדרות, Safari, מיקרופון, ולבחור "שאל" או "אפשר". אחר כך לרענן את הדף ולנסות שוב.'
      : 'הדפדפן לא קיבל גישה למיקרופון. לחצו על סמל המנעול שליד כתובת האתר, אפשרו "מיקרופון", ונסו שוב.';
  }

  function attachVoice(ta, row, foot, onText) {
    if (!voiceSupported() || !row) return null;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bwc-mic';
    btn.setAttribute('aria-label', 'הקלטה קולית: לדבר במקום להקליד');
    btn.title = 'הקלטה קולית';
    btn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i>';
    if (ta.nextSibling) row.insertBefore(btn, ta.nextSibling); else row.appendChild(btn);

    // Status strip under the box: recording timer, progress, errors, retry.
    var bar = document.createElement('div');
    bar.className = 'bwc-voice';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    foot.parentNode.insertBefore(bar, foot);

    var st = { rec: null, stream: null, chunks: [], mime: '', started: 0, timer: null, blob: null, cancelled: false, busy: false };

    function paint(html, kind) {
      bar.className = 'bwc-voice' + (kind ? ' is-' + kind : '');
      bar.innerHTML = html;
      bar.hidden = !html;
    }
    function clear() { paint('', ''); }

    function stopTracks() {
      if (st.stream) { st.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); }
      st.stream = null;
    }

    function tick() {
      var sec = (Date.now() - st.started) / 1000;
      var t = bar.querySelector('[data-v-time]');
      if (t) t.textContent = fmtTime(sec) + ' / ' + fmtTime(VOICE_MAX_SEC);
      if (sec >= VOICE_MAX_SEC) finish();
    }

    function recordingUi() {
      paint(
        '<span class="bwc-voice__dot" aria-hidden="true"></span>' +
        '<span class="bwc-voice__label">מקליט</span>' +
        '<span class="bwc-voice__time" data-v-time>0:00 / ' + fmtTime(VOICE_MAX_SEC) + '</span>' +
        '<button type="button" class="bwc-voice__btn bwc-voice__btn--main" data-v="stop"><i class="fa-solid fa-stop" aria-hidden="true"></i> סיום</button>' +
        '<button type="button" class="bwc-voice__btn" data-v="cancel">ביטול</button>',
        'rec'
      );
    }

    async function start() {
      if (st.rec || st.busy) return;
      st.blob = null;
      try {
        st.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        var name = err && err.name;
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          paint('<span>לא נמצא מיקרופון במכשיר הזה. אפשר להמשיך בהקלדה.</span>', 'err');
        } else {
          paint('<span>' + permissionHelp() + '</span>', 'err');
        }
        return;
      }
      st.mime = pickMime();
      try {
        st.rec = st.mime ? new MediaRecorder(st.stream, { mimeType: st.mime }) : new MediaRecorder(st.stream);
      } catch (_) {
        st.rec = new MediaRecorder(st.stream);
      }
      st.mime = st.rec.mimeType || st.mime || 'audio/webm';
      st.chunks = [];
      st.cancelled = false;
      st.rec.ondataavailable = function (e) { if (e.data && e.data.size) st.chunks.push(e.data); };
      st.rec.onstop = onStopped;
      st.rec.start(1000);
      st.started = Date.now();
      btn.classList.add('is-recording');
      btn.hidden = true;
      recordingUi();
      st.timer = setInterval(tick, 250);
    }

    function finish() {
      if (st.rec && st.rec.state !== 'inactive') st.rec.stop();
    }
    function cancel() {
      st.cancelled = true;
      finish();
    }

    function onStopped() {
      clearInterval(st.timer);
      var dur = (Date.now() - st.started) / 1000;
      stopTracks();
      st.rec = null;
      btn.hidden = false;
      btn.classList.remove('is-recording');
      if (st.cancelled) { clear(); try { btn.focus({ preventScroll: true }); } catch (_) {} return; }
      if (dur < VOICE_MIN_SEC || !st.chunks.length) {
        paint('<span>ההקלטה קצרה מדי. לחצו על המיקרופון, דברו כמה שניות, ואז "סיום".</span>', 'err');
        return;
      }
      st.blob = new Blob(st.chunks, { type: st.mime.split(';')[0] });
      send();
    }

    function insertText(text) {
      var cur = ta.value;
      var sep = !cur ? '' : (/\s$/.test(cur) ? '' : (/[.!?׃:]$/.test(cur.trim()) ? '\n' : ' '));
      var max = ta.maxLength > 0 ? ta.maxLength : 100000;
      ta.value = (cur + sep + text).slice(0, max);
      if (onText) onText();
      try { ta.focus({ preventScroll: true }); } catch (_) { ta.focus(); }
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
    }

    function failUi(msg) {
      paint(
        '<span>' + msg + '</span>' +
        '<button type="button" class="bwc-voice__btn bwc-voice__btn--main" data-v="retry"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> לנסות שוב</button>' +
        '<button type="button" class="bwc-voice__btn" data-v="discard">לוותר על ההקלטה</button>',
        'err'
      );
    }

    async function send() {
      if (!st.blob || st.busy) return;
      st.busy = true;
      btn.disabled = true;
      paint('<span class="bwc-voice__spin" aria-hidden="true"></span><span>הופך את ההקלטה לטקסט...</span>', 'busy');
      try {
        var token = await authToken();
        if (!token) {
          failUi('צריך להתחבר כדי להשתמש בהקלטה. ההקלטה שמורה: התחברו ולחצו "לנסות שוב".');
          if (window.openLoginModal) { try { window.openLoginModal(); } catch (_) {} }
          return;
        }
        var res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': st.blob.type || st.mime.split(';')[0], Authorization: 'Bearer ' + token },
          body: st.blob,
        });
        var data = {};
        try { data = await res.json(); } catch (_) {}
        if (res.ok && data.ok && data.text) {
          st.blob = null;
          clear();
          insertText(data.text);
          return;
        }
        var reason = data && data.reason;
        if (reason === 'no_speech') failUi('לא שמעתי דיבור בהקלטה. אפשר לנסות שוב, או להקליט מחדש קרוב יותר למיקרופון.');
        else if (reason === 'daily_cap') { st.blob = null; paint('<span>הגעתם למכסת ההקלטות של היום. מחר יש עוד, ובינתיים אפשר להקליד.</span>', 'err'); }
        else if (res.status === 429) failUi('היו הרבה בקשות בדקה האחרונה. ההקלטה שמורה, חכו רגע ולחצו "לנסות שוב".');
        else if (res.status === 401) failUi('החיבור לחשבון פג. התחברו מחדש, ההקלטה שמורה.');
        else if (res.status === 413) { st.blob = null; paint('<span>ההקלטה ארוכה מדי לשליחה. נסו קטע קצר יותר, עד שתי דקות.</span>', 'err'); }
        else if (res.status === 503) { st.blob = null; paint('<span>ההקלטה הקולית לא זמינה כרגע. אפשר להמשיך בהקלדה.</span>', 'err'); }
        else failUi('התמלול לא הצליח הפעם. ההקלטה לא אבדה, אפשר לנסות שוב.');
      } catch (_) {
        failUi('נראה שהחיבור לאינטרנט נפל. ההקלטה לא אבדה, אפשר לנסות שוב.');
      } finally {
        st.busy = false;
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', function (e) { e.preventDefault(); start(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      e.preventDefault();
      var a = b.getAttribute('data-v');
      if (a === 'stop') finish();
      else if (a === 'cancel') cancel();
      else if (a === 'retry') send();
      else if (a === 'discard') { st.blob = null; clear(); }
    });

    return {
      button: btn,
      isRecording: function () { return !!st.rec; },
      cancel: function () { if (st.rec) cancel(); },
    };
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
