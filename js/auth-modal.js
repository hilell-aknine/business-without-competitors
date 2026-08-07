/* ==========================================================================
   auth-modal.js — Login modal.

   SIGNUP LIVES ON ITS OWN PAGE (pages/signup.html), not here.
   Rationale: signup now collects full name + email + password with real
   validation. Duplicating that inside the modal would create two signup paths
   that drift apart, and the modal path would keep producing profiles with no
   name — which is exactly the hole we are closing. So this modal is
   login-only, and the "הרשמה" tab is a link to the signup page. There is
   exactly one way to create an account.

   Auto-mounts a single modal element on the first open(). Loads CSS lazily
   from /css/auth-modal.css if not already present in the document.

   API:
     window.bwcAuthModal.open()        // login
     window.bwcAuthModal.open('signup')// redirects to pages/signup.html
     window.bwcAuthModal.close()
     window.openLoginModal()           // global alias used by page gates
     window.bwcAuthModal.signupHref()  // resolved URL of the signup page

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
  var submitBtn = null;
  var statusEl = null;
  var lastFocused = null;
  var mounted = false;
  var busy = false;

  /* Relative path prefix, mirroring global-nav's getBasePath(). Keeps the site
     working on Vercel, GitHub Pages and local file:// alike. */
  function basePath() {
    return /\/pages\//.test(window.location.pathname) ? '../' : '';
  }

  function signupHref() {
    return basePath() + 'pages/signup.html';
  }

  /* ---- Inject CSS link if missing (so any page can call open() w/o fail) ---- */
  function ensureCss() {
    if (document.querySelector('link[data-bwc-auth-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = basePath() + 'css/auth-modal.css';
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
          '<a class="bwc-auth-tab bwc-auth-tab--link" role="tab" aria-selected="false" href="' + signupHref() + '" data-signup-link>הרשמה</a>' +
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
          '<button type="submit" class="bwc-auth-submit">התחבר</button>' +
          '<div class="bwc-auth-status" role="status" aria-live="polite"></div>' +
          '<p class="bwc-auth-forgot"><button type="button" class="bwc-auth-forgot-btn">שכחתי סיסמה</button></p>' +
          '<p class="bwc-auth-hint">אין לך עדיין חשבון? ' +
            '<a class="bwc-auth-hint-link" href="' + signupHref() + '" data-signup-link>פתח חשבון בחינם</a>' +
          '</p>' +
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
    submitBtn   = root.querySelector('.bwc-auth-submit');
    statusEl    = root.querySelector('.bwc-auth-status');

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

    /* Forgot password */
    root.querySelector('.bwc-auth-forgot-btn').addEventListener('click', function () {
      forgotPassword();
    });

    mounted = true;
  }

  function setStatus(msg, success) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (success) statusEl.classList.add('is-success');
    else statusEl.classList.remove('is-success');
  }

  async function submit() {
    if (busy) return;
    var email = (emailInput.value || '').trim();
    var pw    = pwInput.value || '';

    if (!email) { setStatus('יש להזין מייל.'); emailInput.focus(); return; }
    if (!pw)    { setStatus('יש להזין סיסמה.'); pwInput.focus(); return; }

    setStatus('');
    busy = true;
    submitBtn.disabled = true;
    var prevText = submitBtn.textContent;
    submitBtn.textContent = 'מתחבר…';

    try {
      var res = await window.bwcAuth.signIn(email, pw);

      if (res && res.error) {
        setStatus(res.error);
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

  async function forgotPassword() {
    var email = (emailInput ? emailInput.value : '').trim();
    if (!email) {
      setStatus('יש להזין מייל תחילה.');
      if (emailInput) emailInput.focus();
      return;
    }
    if (!/.+@.+\..+/.test(email)) {
      setStatus('כתובת המייל אינה תקינה.');
      if (emailInput) emailInput.focus();
      return;
    }

    /* Build absolute URL to reset-password.html regardless of which page
       the modal is opened from (root pages vs. /pages/ subdirectory). */
    var resetPath = /\/pages\//.test(window.location.pathname)
      ? window.location.pathname.replace(/\/[^/]*$/, '') + '/reset-password.html'
      : '/pages/reset-password.html';
    var redirectTo = window.location.origin + resetPath;

    setStatus('');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await window.bwcSupabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo
      });
      if (res.error) {
        setStatus('שגיאה בשליחה. נסה שוב.');
      } else {
        setStatus('שלחנו אליך קישור לאיפוס הסיסמה. בדוק את תיבת הדואר שלך.', true);
      }
    } catch (e) {
      setStatus('שגיאת רשת. נסה שוב.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function open(initialMode) {
    if (window.bwcAuth && window.bwcAuth.getUser()) {
      // Already logged in — nothing to do.
      return;
    }
    // Signup is a page, not a mode. Any caller still asking for 'signup' gets
    // sent there instead of a second, weaker signup form.
    if (initialMode === 'signup') {
      window.location.href = signupHref();
      return;
    }
    mount();
    setStatus('');
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
        setStatus('');
        if (lastFocused && typeof lastFocused.focus === 'function') {
          try { lastFocused.focus(); } catch (_) {}
        }
      }
    };
    setTimeout(hide, 240);
  }

  window.bwcAuthModal = Object.freeze({
    open: open,
    close: close,
    signupHref: signupHref
  });

  /* Global alias. pages/admin-stats.html and pages/apply.html already call
     `window.openLoginModal && window.openLoginModal()` on their gate buttons,
     but nothing ever defined it — so those buttons silently did nothing.
     Defining it here fixes both gates without touching either page. */
  if (typeof window.openLoginModal !== 'function') {
    window.openLoginModal = function () { open('login'); };
  }
})();
