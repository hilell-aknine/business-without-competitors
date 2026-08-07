/* ==========================================================================
   signup.js — the ONE signup path (pages/signup.html).

   Collects full name + email + password, and hands the name to Supabase as
   signup metadata. The handle_new_user() trigger (migration 006) copies it
   into public.profiles. Before 006 the modal only asked for email + password,
   so every profiles row had a NULL full_name — which is why the admin
   dashboard had nothing but UUIDs to show.

   Email is the only contact field. No phone (decision, 2026-08-07).

   Belt and braces: the name is also cached locally under
   `bwc_pending_profile`, and auth.js pushes it into profiles the first time a
   session appears on any page. That covers the "Confirm email" flow, where
   there is no session at signup time.

   Load order (all defer): Supabase CDN -> supabase-config -> auth ->
   auth-modal -> global-nav -> signup.js
   ========================================================================== */
(function () {
  'use strict';

  var PENDING_KEY = 'bwc_pending_profile';
  var FIELDS = ['name', 'email', 'pw', 'pw2'];

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------------------------------------------------------- utils */

  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function setFieldError(field, msg) {
    var wrap = document.querySelector('[data-field="' + field + '"]');
    var err = $('err' + field.charAt(0).toUpperCase() + field.slice(1));
    if (err) err.textContent = msg || '';
    if (wrap) wrap.classList.toggle('is-invalid', !!msg);
  }

  function clearErrors() {
    FIELDS.forEach(function (f) { setFieldError(f, ''); });
    setStatus('');
  }

  function setStatus(msg, success) {
    var el = $('suStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-success', !!success);
  }

  /* ------------------------------------------------------------ validation */

  function validate(values) {
    var errors = {};

    var name = values.name.trim().replace(/\s+/g, ' ');
    if (!name) errors.name = 'צריך שם מלא.';
    else if (name.length < 2) errors.name = 'השם קצר מדי.';
    else if (name.indexOf(' ') === -1) errors.name = 'שם פרטי ושם משפחה, בבקשה.';

    var email = values.email.trim();
    if (!email) errors.email = 'צריך כתובת מייל.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'כתובת המייל לא נראית תקינה.';

    if (!values.pw) errors.pw = 'צריך סיסמה.';
    else if (values.pw.length < 6) errors.pw = 'הסיסמה קצרה מדי, לפחות 6 תווים.';

    if (!values.pw2) errors.pw2 = 'צריך לאשר את הסיסמה.';
    else if (values.pw && values.pw !== values.pw2) errors.pw2 = 'הסיסמאות לא תואמות.';

    return { errors: errors, clean: { name: name, email: email } };
  }

  /* ------------------------------------------------- profile backfill hook */

  /* The real implementation lives in auth.js so EVERY page can heal a pending
     profile, not just this one. auth.js also fires it automatically the first
     time a session appears; this wrapper just lets us await it here. */
  function backfillProfile() {
    if (window.bwcAuth && window.bwcAuth.backfillPendingProfile) {
      return window.bwcAuth.backfillPendingProfile();
    }
    return Promise.resolve();
  }

  /* --------------------------------------------------------------- submit */

  var busy = false;

  async function onSubmit(ev) {
    ev.preventDefault();
    if (busy) return;

    clearErrors();

    var values = {
      name:  $('suName').value  || '',
      email: $('suEmail').value || '',
      pw:    $('suPw').value    || '',
      pw2:   $('suPw2').value   || ''
    };

    var v = validate(values);
    var keys = Object.keys(v.errors);
    if (keys.length) {
      keys.forEach(function (k) { setFieldError(k, v.errors[k]); });
      var firstInput = document.querySelector('[data-field="' + keys[0] + '"] .su-input');
      if (firstInput) { try { firstInput.focus(); } catch (e) {} }
      return;
    }

    if (!window.bwcAuth) {
      setStatus('הדף עדיין נטען. נסה שוב בעוד רגע.');
      return;
    }

    busy = true;
    var btn = $('suSubmit');
    btn.disabled = true;
    var prev = btn.textContent;
    btn.textContent = 'פותח חשבון…';

    try {
      // Cache before the network call: if the account is created but the page
      // is closed before the redirect, the next login still backfills the name.
      lsSet(PENDING_KEY, JSON.stringify({ full_name: v.clean.name }));

      var res = await window.bwcAuth.signUp(v.clean.email, values.pw, {
        full_name: v.clean.name
      });

      if (res && res.error) {
        setStatus(res.error);
        if (/כבר רשום/.test(res.error)) setFieldError('email', res.error);
        return;
      }

      // Session present -> "Confirm email" is off, the learner is already in.
      var hasSession = !!(window.bwcAuth.getUser() || (res && res.user));
      showDone(hasSession, v.clean.email);
      if (hasSession) await backfillProfile();
    } catch (e) {
      setStatus((e && e.message) ? e.message : 'משהו השתבש. נסה שוב.');
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  function hideFormBlocks() {
    var form = $('suForm');
    if (form) form.classList.add('hidden');
    var why = $('suWhy');
    if (why) why.classList.add('hidden');
  }

  function showDone(hasSession, email) {
    hideFormBlocks();

    var done = $('suDone');
    if (!done) return;
    done.classList.remove('hidden');

    if (hasSession) {
      $('suDoneTitle').textContent = 'החשבון נפתח. ברוך הבא.';
      $('suDoneMsg').textContent =
        'עכשיו נשאל אותך כמה שאלות קצרות על העסק שלך, כדי שנדע מאיפה נכון להתחיל.';
      $('suDoneCta').textContent = 'המשך לפורטל';
      $('suDoneCta').href = '../index.html';
      // Give the learner a beat to read, then move on.
      setTimeout(function () { window.location.href = '../index.html'; }, 2200);
    } else {
      $('suDoneTitle').textContent = 'כמעט שם. צריך לאשר את המייל';
      $('suDoneMsg').textContent =
        'שלחנו הודעת אישור אל ' + email + '. פתח אותה, לחץ על הקישור, ואז חזור לכאן והתחבר. ' +
        'אם ההודעה לא הגיעה תוך כמה דקות, בדוק בתיקיית הספאם.';
      $('suDoneCta').textContent = 'חזרה לפורטל';
      $('suDoneCta').href = '../index.html';
    }
  }

  /* ---------------------------------------------------------------- init  */

  function applyAuthState() {
    var user = window.bwcAuth && window.bwcAuth.getUser();
    if (!user) return;
    // Already signed in — no reason to show a signup form.
    var done = $('suDone');
    if (done && !done.classList.contains('hidden')) return; // just signed up
    hideFormBlocks();
    var panel = $('suSignedIn');
    if (panel) panel.classList.remove('hidden');
    var emailEl = $('suSignedInEmail');
    if (emailEl) emailEl.textContent = 'החשבון המחובר: ' + (user.email || '');
  }

  function wirePasswordToggles() {
    var toggles = document.querySelectorAll('[data-toggle-pw]');
    Array.prototype.forEach.call(toggles, function (btn) {
      btn.addEventListener('click', function () {
        var input = $(btn.getAttribute('data-toggle-pw'));
        if (!input) return;
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.setAttribute('aria-label', showing ? 'הצג סיסמה' : 'הסתר סיסמה');
        var icon = btn.querySelector('i');
        if (icon) icon.className = showing ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var form = $('signupForm');
    if (form) form.addEventListener('submit', onSubmit);

    // Clear a field's error as soon as the learner starts fixing it.
    FIELDS.forEach(function (f) {
      var input = document.querySelector('[data-field="' + f + '"] .su-input');
      if (input) input.addEventListener('input', function () { setFieldError(f, ''); });
    });

    wirePasswordToggles();

    var loginLink = $('suLoginLink');
    if (loginLink) {
      loginLink.addEventListener('click', function () {
        if (window.bwcAuthModal) window.bwcAuthModal.open('login');
      });
    }

    if (window.bwcAuth) {
      window.bwcAuth.ready().then(applyAuthState);
      window.bwcAuth.onChange(applyAuthState);
    }
  });

  window.bwcSignup = { PENDING_KEY: PENDING_KEY };
})();
