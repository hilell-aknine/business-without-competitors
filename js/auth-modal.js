/* ==========================================================================
   auth-modal.js — Login / Signup modal.

   Auto-mounts a single modal element on the first open(). Loads CSS lazily
   from /css/auth-modal.css if not already present in the document.

   API:
     window.bwcAuthModal.open('login' | 'signup')   // default: 'login'
     window.bwcAuthModal.close()

   Loading order: must come AFTER auth.js (uses window.bwcAuth).
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.bwcAuthModal) return;
  if (!window.bwcAuth) {
    console.error('[auth-modal] requires bwcAuth. Check script load order.');
    return;
  }

  var root = null;       // .bwc-auth-overlay
  var card = null;       // .bwc-auth-card
  var emailInput = null;
  var pwInput = null;
  var pw2Input = null;
  var pw2Field = null;
  var submitBtn = null;
  var statusEl = null;
  var titleEl = null;
  var tabLogin = null;
  var tabSignup = null;
  var hintEl = null;
  var lastFocused = null;
  var mode = 'login';
  var mounted = false;
  var busy = false;

  /* ---- Inject CSS link if missing (so any page can call open() w/o fail) ---- */
  function ensureCss() {
    if (document.querySelector('link[data-bwc-auth-css]')) return;
    // Resolve relative to current page depth, mirroring global-nav's approach.
    var prefix = /\/pages\//.test(window.location.pathname) ? '../' : '';
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prefix + 'css/auth-modal.css';
    link.setAttribute('data-bwc-auth-css', '');
    document.head.appendChild(link);
  }

  function buildHTML() {
    var div = document.createElement('div');
    div.className = 'bwc-auth-overlay';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-labelledby', 'bwcAuthTitle');
    div.hidden = true;
    div.innerHTML =
      '<div class="bwc-auth-card" role="document">' +
        '<div class="bwc-auth-head">' +
          '<h2 class="bwc-auth-title" id="bwcAuthTitle">התחברות</h2>' +
          '<button type="button" class="bwc-auth-close" aria-label="סגור">×</button>' +
        '</div>' +
        '<div class="bwc-auth-tabs" role="tablist" aria-label="התחברות או הרשמה">' +
          '<button type="button" class="bwc-auth-tab" role="tab" aria-selected="true" data-mode="login">התחברות</button>' +
          '<button type="button" class="bwc-auth-tab" role="tab" aria-selected="false" data-mode="signup">הרשמה</button>' +
        '</div>' +
        '<form class="bwc-auth-form" novalidate>' +
          '<div class="bwc-auth-field">' +
            '<label class="bwc-auth-label" for="bwcAuthEmail">מייל</label>' +
            '<input class="bwc-auth-input" id="bwcAuthEmail" type="email" autocomplete="email" required placeholder="name@example.com">' +
          '</div>' +
          '<div class="bwc-auth-field">' +
            '<label class="bwc-auth-label" for="bwcAuthPw">סיסמה</label>' +
            '<input class="bwc-auth-input" id="bwcAuthPw" type="password" autocomplete="current-password" minlength="6" required placeholder="לפחות 6 תווים">' +
          '</div>' +
          '<div class="bwc-auth-field" data-pw2 hidden>' +
            '<label class="bwc-auth-label" for="bwcAuthPw2">אישור סיסמה</label>' +
            '<input class="bwc-auth-input" id="bwcAuthPw2" type="password" autocomplete="new-password" minlength="6" placeholder="הזן שוב">' +
          '</div>' +
          '<button type="submit" class="bwc-auth-submit">התחבר</button>' +
          '<div class="bwc-auth-status" role="status" aria-live="polite"></div>' +
          '<p class="bwc-auth-hint">אין לך עדיין חשבון? לחץ על "הרשמה".</p>' +
        '</form>' +
      '</div>';
    return div;
  }

  function mount() {
    if (mounted) return;
    ensureCss();
    root = buildHTML();
    document.body.appendChild(root);

    card        = root.querySelector('.bwc-auth-card');
    emailInput  = root.querySelector('#bwcAuthEmail');
    pwInput     = root.querySelector('#bwcAuthPw');
    pw2Input    = root.querySelector('#bwcAuthPw2');
    pw2Field    = root.querySelector('[data-pw2]');
    submitBtn   = root.querySelector('.bwc-auth-submit');
    statusEl    = root.querySelector('.bwc-auth-status');
    titleEl     = root.querySelector('.bwc-auth-title');
    tabLogin    = root.querySelector('[data-mode="login"]');
    tabSignup   = root.querySelector('[data-mode="signup"]');
    hintEl      = root.querySelector('.bwc-auth-hint');

    /* Tab switch */
    tabLogin.addEventListener('click', function () { setMode('login'); });
    tabSignup.addEventListener('click', function () { setMode('signup'); });

    /* Close: X button, overlay click, Escape */
    root.querySelector('.bwc-auth-close').addEventListener('click', close);
    root.addEventListener('click', function (e) {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root && !root.hidden) {
        e.preventDefault();
        close();
      }
    });

    /* Submit */
    root.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });

    mounted = true;
  }

  function setStatus(msg, success) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (success) statusEl.classList.add('is-success');
    else statusEl.classList.remove('is-success');
  }

  function setMode(next) {
    mode = next === 'signup' ? 'signup' : 'login';
    if (titleEl)   titleEl.textContent = (mode === 'signup') ? 'הרשמה' : 'התחברות';
    if (submitBtn) submitBtn.textContent = (mode === 'signup') ? 'הירשם' : 'התחבר';
    if (tabLogin)  tabLogin.setAttribute('aria-selected', mode === 'login' ? 'true' : 'false');
    if (tabSignup) tabSignup.setAttribute('aria-selected', mode === 'signup' ? 'true' : 'false');
    if (pw2Field)  pw2Field.hidden = (mode !== 'signup');
    if (pwInput)   pwInput.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
    if (hintEl) {
      hintEl.textContent = (mode === 'signup')
        ? 'אם כבר יש לך חשבון — לחץ על "התחברות". ההתקדמות שלך תועלה לענן בכניסה הראשונה.'
        : 'אין לך עדיין חשבון? לחץ על "הרשמה".';
    }
    setStatus('');
  }

  async function submit() {
    if (busy) return;
    var email = (emailInput.value || '').trim();
    var pw    = pwInput.value || '';
    var pw2   = pw2Input ? (pw2Input.value || '') : '';

    if (!email) { setStatus('יש להזין מייל.'); emailInput.focus(); return; }
    if (!pw)    { setStatus('יש להזין סיסמה.'); pwInput.focus(); return; }
    if (mode === 'signup' && pw !== pw2) {
      setStatus('הסיסמאות לא תואמות.');
      pw2Input.focus();
      return;
    }

    setStatus('');
    busy = true;
    submitBtn.disabled = true;
    var prevText = submitBtn.textContent;
    submitBtn.textContent = (mode === 'signup') ? 'נרשם…' : 'מתחבר…';

    try {
      var res = (mode === 'signup')
        ? await window.bwcAuth.signUp(email, pw)
        : await window.bwcAuth.signIn(email, pw);

      if (res && res.error) {
        setStatus(res.error);
        return;
      }

      if (mode === 'signup' && (!res || !res.user)) {
        // Email confirmation flow (when "Confirm email" is enabled in Supabase)
        setStatus('שלחנו אליך מייל אישור. בדוק את תיבת הדואר ואז התחבר.', true);
        setMode('login');
        return;
      }

      setStatus('הצלחה! מעדכן את ההתקדמות שלך…', true);
      setTimeout(close, 600);
    } catch (e) {
      setStatus(e && e.message ? e.message : 'משהו השתבש. נסה שוב.');
    } finally {
      busy = false;
      submitBtn.disabled = false;
      submitBtn.textContent = prevText;
    }
  }

  function open(initialMode) {
    if (window.bwcAuth && window.bwcAuth.getUser()) {
      // Already logged in — nothing to do.
      return;
    }
    mount();
    setMode(initialMode === 'signup' ? 'signup' : 'login');
    lastFocused = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(function () {
      root.classList.add('is-open');
      if (emailInput) {
        try { emailInput.focus(); } catch (_) {}
      }
    });
  }

  function close() {
    if (!root || root.hidden) return;
    root.classList.remove('is-open');
    var hide = function () {
      if (!root.classList.contains('is-open')) {
        root.hidden = true;
        // Reset fields so secrets aren't lingering in DOM if reopened later.
        if (emailInput) emailInput.value = '';
        if (pwInput)    pwInput.value = '';
        if (pw2Input)   pw2Input.value = '';
        setStatus('');
        if (lastFocused && typeof lastFocused.focus === 'function') {
          try { lastFocused.focus(); } catch (_) {}
        }
      }
    };
    setTimeout(hide, 240);
  }

  window.bwcAuthModal = Object.freeze({ open: open, close: close });
})();
