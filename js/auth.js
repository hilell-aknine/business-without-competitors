/* ==========================================================================
   auth.js — Thin wrapper around window.bwcSupabase.auth.

   Exposes a single global: window.bwcAuth
     bwcAuth.ready()            -> Promise<void>      (resolves after first init)
     bwcAuth.getUser()          -> { id, email } | null
     bwcAuth.signUp(email, pw, meta) -> Promise<{ user?, error? }>
                                  meta = { full_name } -> stored in
                                  auth.users.raw_user_meta_data and copied into
                                  public.profiles by handle_new_user()
                                  (migration 006). Email is the only contact
                                  field we collect — no phone, by decision.
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
      if (nextId) { backfillPendingProfile(); }
    }
  }

  /* ---- Pending profile backfill -------------------------------------------
     pages/signup.html caches { full_name } under bwc_pending_profile before
     calling signUp. The handle_new_user() trigger (migration 006) is the
     primary writer, but with "Confirm email" turned on there is no client
     session at signup time, and pre-006 accounts have no name at all.
     So the first time a session appears on ANY page, we push whatever is
     pending into the learner's own profiles row (allowed by the existing
     profiles_self_update policy) and drop the cache.
     Runs automatically from setUser — no page needs to call it. */
  var PENDING_PROFILE_KEY = 'bwc_pending_profile';
  var backfillRan = false;

  async function backfillPendingProfile() {
    if (backfillRan) return;
    var user = currentUser;
    if (!user) return;

    var pending = null;
    try {
      var raw = localStorage.getItem(PENDING_PROFILE_KEY);
      if (raw) pending = JSON.parse(raw);
    } catch (e) { pending = null; }
    if (!pending || !pending.full_name) return;

    backfillRan = true;
    try {
      // ensure_profile() (migration 003) self-heals a missing profiles row so
      // the UPDATE below has something to hit.
      try { await sb.rpc('ensure_profile'); } catch (_) {}

      var res = await sb.from('profiles')
        .update({ full_name: pending.full_name })
        .eq('id', user.id);
      if (res && res.error) {
        backfillRan = false;
        console.warn('[auth] profile backfill failed',
          { code: res.error.code, message: res.error.message });
        return;
      }
      try { localStorage.removeItem(PENDING_PROFILE_KEY); } catch (_) {}
    } catch (e) {
      backfillRan = false;
      console.warn('[auth] profile backfill threw', e);
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

  function cleanMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    var out = {};
    var name = String(meta.full_name || '').trim().replace(/\s+/g, ' ');
    if (name) out.full_name = name.slice(0, 120);
    return Object.keys(out).length ? out : null;
  }

  async function signUp(email, password, meta) {
    var v = validateEmailAndPw(email, password);
    if (v) return { error: v };
    try {
      var payload = { email: email.trim(), password: password };
      var data = cleanMeta(meta);
      // options.data lands in auth.users.raw_user_meta_data. The handle_new_user
      // trigger (migration 006) is what actually writes it into public.profiles,
      // because with "Confirm email" on there is no client session at this point.
      if (data) payload.options = { data: data };
      var res = await sb.auth.signUp(payload);
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
    signOut: signOut,
    backfillPendingProfile: backfillPendingProfile,
    PENDING_PROFILE_KEY: PENDING_PROFILE_KEY
  });
})();
