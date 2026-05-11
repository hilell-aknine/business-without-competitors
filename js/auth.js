/* ==========================================================================
   auth.js — Thin wrapper around window.bwcSupabase.auth.

   Exposes a single global: window.bwcAuth
     bwcAuth.ready()            -> Promise<void>      (resolves after first init)
     bwcAuth.getUser()          -> { id, email } | null
     bwcAuth.signUp(email, pw)  -> Promise<{ user?, error? }>
     bwcAuth.signIn(email, pw)  -> Promise<{ user?, error? }>
     bwcAuth.signOut()          -> Promise<void>
     bwcAuth.onChange(cb)       -> () => void  (unsubscribe)

   Emits a window event 'bwc:auth-change' with detail { user } whenever the
   session state changes (login, logout, token refresh).

   Loading order (each consuming page must include in this order):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
     <script src="js/supabase-config.js" defer></script>
     <script src="js/auth.js" defer></script>
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.bwcAuth) return;

  if (!window.bwcSupabase) {
    console.error('[auth] bwcSupabase is not initialized. Include supabase-config.js before auth.js.');
    return;
  }

  var sb = window.bwcSupabase;
  var currentUser = null;
  var listeners = new Set();
  var readyResolvers = [];
  var initialized = false;

  function pickUser(u) {
    if (!u) return null;
    return { id: u.id, email: u.email || '' };
  }

  function emit() {
    var detail = { user: currentUser };
    listeners.forEach(function (cb) {
      try { cb(currentUser); } catch (e) { console.error('[auth] listener error', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('bwc:auth-change', { detail: detail }));
    } catch (_) { /* old browsers */ }
  }

  function setUser(u) {
    var next = pickUser(u);
    var prevId = currentUser && currentUser.id;
    var nextId = next && next.id;
    currentUser = next;
    if (prevId !== nextId || (!prevId && !nextId && initialized === false)) {
      emit();
    }
  }

  /* ---- Bootstrap: read existing session, then start listening for changes ---- */
  sb.auth.getSession().then(function (res) {
    var sess = res && res.data && res.data.session;
    setUser(sess ? sess.user : null);
  }).catch(function (e) {
    console.error('[auth] getSession failed', e);
    setUser(null);
  }).finally(function () {
    initialized = true;
    readyResolvers.splice(0).forEach(function (r) { r(); });
  });

  sb.auth.onAuthStateChange(function (event, session) {
    setUser(session ? session.user : null);
  });

  function ready() {
    if (initialized) return Promise.resolve();
    return new Promise(function (resolve) { readyResolvers.push(resolve); });
  }

  function getUser() {
    return currentUser;
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.add(cb);
    if (initialized) {
      try { cb(currentUser); } catch (e) { console.error('[auth] listener init error', e); }
    }
    return function () { listeners.delete(cb); };
  }

  /* ---- Auth ops ---- */

  function translateError(err) {
    if (!err) return null;
    var msg = (err.message || '').toLowerCase();
    if (msg.includes('invalid login') || msg.includes('invalid credentials')) {
      return 'מייל או סיסמה שגויים.';
    }
    if (msg.includes('user already registered') || msg.includes('already exists')) {
      return 'המייל הזה כבר רשום. נסה להתחבר במקום.';
    }
    if (msg.includes('password should be at least')) {
      return 'הסיסמה קצרה מדי — לפחות 6 תווים.';
    }
    if (msg.includes('email') && msg.includes('confirm')) {
      return 'המייל לא אומת. בדוק את תיבת הדואר שלך.';
    }
    if (msg.includes('rate limit')) {
      return 'יותר מדי ניסיונות. נסה שוב בעוד דקה.';
    }
    if (msg.includes('network')) {
      return 'אין חיבור לאינטרנט. נסה שוב.';
    }
    return err.message || 'משהו השתבש. נסה שוב.';
  }

  function validateEmailAndPw(email, password) {
    var e = (email || '').trim();
    if (!e || !/.+@.+\..+/.test(e)) return 'מייל לא תקין.';
    if (!password || password.length < 6) return 'סיסמה חייבת להיות לפחות 6 תווים.';
    return null;
  }

  async function signUp(email, password) {
    var v = validateEmailAndPw(email, password);
    if (v) return { error: v };
    try {
      var res = await sb.auth.signUp({ email: email.trim(), password: password });
      if (res.error) return { error: translateError(res.error) };
      return { user: pickUser(res.data && res.data.user) };
    } catch (e) {
      return { error: translateError(e) };
    }
  }

  async function signIn(email, password) {
    var v = validateEmailAndPw(email, password);
    if (v) return { error: v };
    try {
      var res = await sb.auth.signInWithPassword({ email: email.trim(), password: password });
      if (res.error) return { error: translateError(res.error) };
      return { user: pickUser(res.data && res.data.user) };
    } catch (e) {
      return { error: translateError(e) };
    }
  }

  async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { console.error('[auth] signOut failed', e); }
  }

  window.bwcAuth = Object.freeze({
    ready: ready,
    getUser: getUser,
    onChange: onChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut
  });
})();
