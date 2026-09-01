/* ==========================================================================
   module-feed.js — the discussion wall inside a module.

   WHY
   Learners went through the whole course alone: watch, mark complete, and
   nothing they thought ever reached another person. Every module now carries
   its own wall, so opening module 4 shows what other people took from module
   4 before pressing play on anything.

   SCOPE ON PURPOSE
   A wall, not a forum. No threads, no replies, no likes, no notifications.
   Those need moderation attention nobody is staffing on a dormant project,
   and the value asked for here is "what did this module do for you" — which a
   flat, newest-first list delivers on its own.

   TRUST MODEL
   - Signed-in learners only. The course is paid content, so `anon` has no
     read policy at all (migration 009); guests get a login prompt instead.
   - The author name is stored ON the post at insert time. Rendering names any
     other way would mean reading OTHER learners' rows in `profiles`, and that
     table is deliberately own-row-only. No cross-learner profile read exists
     in this portal and this feature does not introduce the first one.
   - Every learner-supplied string is inserted as textContent, never HTML.
   - The 10-posts-per-hour limit is enforced by a database trigger. The button
     cooldown here is courtesy; the trigger is the actual rule.

   Requires: bwcSupabase, bwcAuth, MODULES (course-data.js).
   Mount:    BwcModuleFeed.mount(containerEl, moduleIdx)
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.BwcModuleFeed) return;

  var TABLE      = 'module_posts';
  var MAX_LEN    = 1500;
  var MIN_LEN    = 2;
  var PAGE_SIZE  = 30;

  var state = {
    moduleIdx: null,
    root: null,
    posts: [],
    user: null,
    isAdmin: false,
    editingId: null,
    busy: false,
    error: null,
    // Set only by a read that comes back "table does not exist". It starts
    // false on purpose: a guest never reaches that read, and starting true
    // would hide the login gate from them entirely.
    disabled: false
  };

  /* ---------------------------------------------------------------- utils */

  function sb() { return window.bwcSupabase || null; }

  function currentUser() {
    try {
      var u = window.bwcAuth && window.bwcAuth.getUser();
      return (u && u.id) ? u : null;
    } catch (_) { return null; }
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function firstName(name) {
    var n = (name || '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
  }

  function initials(name) {
    var n = (name || '').trim();
    if (!n) return '?';
    return n.charAt(0).toUpperCase();
  }

  // "לפני 3 דקות" reads as a living room; a raw timestamp reads as a log file.
  function timeAgo(iso) {
    var then = new Date(iso).getTime();
    if (!isFinite(then)) return '';
    var diff = Math.floor((Date.now() - then) / 1000);
    if (diff < 60)     return 'עכשיו';
    if (diff < 3600)   return 'לפני ' + Math.floor(diff / 60) + ' דקות';
    if (diff < 86400)  { var h = Math.floor(diff / 3600); return h === 1 ? 'לפני שעה' : 'לפני ' + h + ' שעות'; }
    if (diff < 604800) { var d = Math.floor(diff / 86400); return d === 1 ? 'אתמול' : 'לפני ' + d + ' ימים'; }
    try {
      return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
    } catch (_) { return ''; }
  }

  function moduleTitle(idx) {
    try { return (window.MODULES && MODULES[idx] && MODULES[idx].title) || ''; }
    catch (_) { return ''; }
  }

  /* ------------------------------------------------------------- rendering */

  function renderState(icon, title, text, actionLabel, onAction, extraClass) {
    var box = el('div', 'mfeed__state' + (extraClass ? ' ' + extraClass : ''));
    var i = el('i', 'fa-solid ' + icon);
    i.setAttribute('aria-hidden', 'true');
    box.appendChild(i);
    box.appendChild(el('h3', null, title));
    box.appendChild(el('p', null, text));
    if (actionLabel && onAction) {
      var btn = el('button', 'mfeed__btn', actionLabel);
      btn.type = 'button';
      btn.addEventListener('click', onAction);
      box.appendChild(btn);
    }
    return box;
  }

  function renderComposer() {
    var wrap = el('div', 'mfeed__composer');

    var ta = el('textarea');
    ta.id = 'mfeedInput';
    ta.maxLength = MAX_LEN;
    ta.setAttribute('aria-label', 'מה לקחת מהמודול הזה');
    ta.placeholder = 'מה לקחת מהמודול הזה? מה יישמת, מה עבד, איפה נתקעת…';

    var row = el('div', 'mfeed__composer-row');
    // "62 / 1500" renders as "1500 / 62" inside an RTL block, which reads as
    // 1500 out of 62 — the opposite of the truth. A single number with a
    // Hebrew label has no direction ambiguity at all.
    var counter = el('span', 'mfeed__counter', 'נשארו ' + MAX_LEN + ' תווים');
    var btn = el('button', 'mfeed__btn');
    btn.type = 'button';
    btn.disabled = true;
    btn.appendChild(el('span', null, 'שתף עם הקבוצה'));

    ta.addEventListener('input', function () {
      var len = ta.value.trim().length;
      var left = MAX_LEN - ta.value.length;
      counter.textContent = 'נשארו ' + left + ' תווים';
      counter.classList.toggle('is-over', left < 100);
      btn.disabled = len < MIN_LEN || state.busy;
    });

    btn.addEventListener('click', function () { submitPost(ta, btn); });

    row.appendChild(counter);
    row.appendChild(btn);
    wrap.appendChild(ta);
    wrap.appendChild(row);
    return wrap;
  }

  function renderPost(post) {
    var card = el('article', 'mfeed__post' + (post.is_hidden ? ' is-hidden' : ''));
    card.dataset.id = post.id;

    var head = el('div', 'mfeed__post-head');
    var name = firstName(post.author_name) || 'לומד/ת בתוכנית';

    var avatar = el('div', 'mfeed__avatar', initials(name));
    avatar.setAttribute('aria-hidden', 'true');
    head.appendChild(avatar);

    var who = el('div');
    who.appendChild(el('div', 'mfeed__author', name));
    var edited = post.updated_at && post.updated_at !== post.created_at ? ' · נערך' : '';
    who.appendChild(el('div', 'mfeed__meta', timeAgo(post.created_at) + edited));
    head.appendChild(who);

    var isMine  = state.user && post.user_id === state.user.id;
    var actions = el('div', 'mfeed__post-actions');

    if (isMine) {
      actions.appendChild(iconBtn('fa-pen', 'ערוך', function () {
        state.editingId = post.id;
        render();
      }));
      actions.appendChild(iconBtn('fa-trash', 'מחק', function () {
        if (window.confirm('למחוק את מה ששיתפת?')) deletePost(post.id);
      }));
    }
    if (state.isAdmin) {
      actions.appendChild(iconBtn(
        post.is_hidden ? 'fa-eye' : 'fa-eye-slash',
        post.is_hidden ? 'החזר לתצוגה' : 'הסתר מהקבוצה',
        function () { setHidden(post.id, !post.is_hidden); }
      ));
    }
    if (actions.childNodes.length) head.appendChild(actions);
    card.appendChild(head);

    if (state.editingId === post.id) {
      card.appendChild(renderEditor(post));
    } else {
      // textContent, never innerHTML — this string came from a learner.
      card.appendChild(el('p', 'mfeed__body', post.body));
      if (post.is_hidden) {
        card.appendChild(el('span', 'mfeed__flag', 'מוסתר מהקבוצה — רק אתה והמנהל רואים את זה'));
      }
    }
    return card;
  }

  function iconBtn(icon, label, onClick) {
    var b = el('button', 'mfeed__icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    var i = el('i', 'fa-solid ' + icon);
    i.setAttribute('aria-hidden', 'true');
    b.appendChild(i);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderEditor(post) {
    var wrap = el('div', 'mfeed__edit');
    var ta = el('textarea');
    ta.value = post.body;
    ta.maxLength = MAX_LEN;
    ta.setAttribute('aria-label', 'עריכת מה ששיתפת');

    var row = el('div', 'mfeed__edit-row');
    var save = el('button', 'mfeed__btn', 'שמור');
    save.type = 'button';
    save.addEventListener('click', function () {
      var body = ta.value.trim();
      if (body.length < MIN_LEN) return;
      updatePost(post.id, body);
    });
    var cancel = el('button', 'mfeed__btn mfeed__btn--ghost', 'ביטול');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { state.editingId = null; render(); });

    row.appendChild(save);
    row.appendChild(cancel);
    wrap.appendChild(ta);
    wrap.appendChild(row);
    return wrap;
  }

  function render() {
    var root = state.root;
    if (!root) return;
    root.innerHTML = '';

    // The wall is not switched on in this environment. Show nothing at all —
    // an empty section is honest, an error box is noise about our own deploy
    // order that no learner can act on.
    if (state.disabled) { root.hidden = true; return; }
    root.hidden = false;

    var head = el('div', 'mfeed__head');
    head.appendChild(el('h2', 'mfeed__title', 'מה לומדים אחרים לקחו מהמודול הזה'));
    if (state.posts.length) {
      head.appendChild(el('span', 'mfeed__count',
        state.posts.length === 1 ? 'שיתוף אחד' : state.posts.length + ' שיתופים'));
    }
    root.appendChild(head);
    root.appendChild(el('p', 'mfeed__sub',
      'המקום לכתוב מה יישמת מ' + (moduleTitle(state.moduleIdx) || 'המודול') +
      ', מה עבד ואיפה נתקעת. מי שייכנס אחריך יקבל את זה כערך אמיתי.'));

    // Guests never see the discussion — the course is paid content.
    if (!state.user) {
      root.appendChild(renderState(
        'fa-lock',
        'השיתופים פתוחים ללומדים רשומים',
        'התחבר כדי לראות מה לומדים אחרים כתבו על המודול הזה, ולהוסיף את מה שאתה לקחת ממנו.',
        'התחברות',
        function () { if (window.openLoginModal) window.openLoginModal(); }
      ));
      return;
    }

    root.appendChild(renderComposer());

    if (state.error) {
      root.appendChild(renderState('fa-triangle-exclamation', 'לא הצלחנו לטעון את השיתופים',
        state.error, 'נסה שוב', function () { load(); }, 'mfeed__error'));
      return;
    }

    if (!state.posts.length) {
      root.appendChild(renderState('fa-comment-dots', 'עדיין אף אחד לא שיתף כאן',
        'תהיה הראשון. משפט אחד על מה שהמודול הזה שינה אצלך שווה יותר מסיכום ארוך.'));
      return;
    }

    var list = el('div', 'mfeed__list');
    state.posts.forEach(function (p) { list.appendChild(renderPost(p)); });
    root.appendChild(list);
  }

  /* ------------------------------------------------------------------ data */

  // Migration 009 not applied yet = the feature is not switched on, which is
  // not an error the learner should ever read. Anything else IS worth showing.
  function isMissingTable(error) {
    if (!error) return false;
    var msg = error.message || '';
    return error.code === '42P01' || msg.indexOf('does not exist') !== -1;
  }

  function friendlyError(error) {
    if (!error) return 'משהו השתבש. נסה שוב.';
    var msg = error.message || '';
    if (msg.indexOf('rate_limited') !== -1) {
      return 'שיתפת הרבה בשעה האחרונה. קח הפסקה קצרה ותחזור.';
    }
    return 'משהו השתבש. נסה שוב.';
  }

  function load() {
    var client = sb();
    state.error = null;
    if (!client || !state.user) { render(); return Promise.resolve(); }

    return client.from(TABLE)
      .select('id, user_id, author_name, body, is_hidden, created_at, updated_at')
      .eq('module_idx', state.moduleIdx)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
      .then(function (res) {
        if (res.error) {
          state.posts = [];
          state.disabled = isMissingTable(res.error);
          state.error = state.disabled ? null : friendlyError(res.error);
        } else {
          state.disabled = false;
          state.posts = res.data || [];
        }
        render();
      })
      .catch(function (err) {
        state.posts = [];
        state.disabled = isMissingTable(err);
        state.error = state.disabled ? null : friendlyError(err);
        render();
      });
  }

  function myDisplayName() {
    var u = state.user;
    if (!u) return '';
    var meta = u.user_metadata || {};
    return (meta.full_name || meta.name || '').trim();
  }

  function submitPost(ta, btn) {
    var client = sb();
    var body = (ta.value || '').trim();
    if (!client || !state.user || body.length < MIN_LEN || state.busy) return;

    state.busy = true;
    btn.disabled = true;

    client.from(TABLE).insert({
      user_id: state.user.id,
      module_idx: state.moduleIdx,
      author_name: myDisplayName(),
      body: body.slice(0, MAX_LEN)
    }).select().then(function (res) {
      state.busy = false;
      if (res.error) {
        window.alert(friendlyError(res.error));
        btn.disabled = false;
        return;
      }
      ta.value = '';
      // Prepend locally instead of refetching: the learner sees their own post
      // land immediately, which is what makes posting feel worth doing.
      if (res.data && res.data[0]) state.posts.unshift(res.data[0]);
      render();
    }).catch(function (err) {
      state.busy = false;
      btn.disabled = false;
      window.alert(friendlyError(err));
    });
  }

  function updatePost(id, body) {
    var client = sb();
    if (!client) return;
    client.from(TABLE).update({ body: body.slice(0, MAX_LEN) }).eq('id', id).select()
      .then(function (res) {
        if (res.error) { window.alert(friendlyError(res.error)); return; }
        var row = res.data && res.data[0];
        if (row) {
          state.posts = state.posts.map(function (p) { return p.id === id ? row : p; });
        }
        state.editingId = null;
        render();
      });
  }

  function deletePost(id) {
    var client = sb();
    if (!client) return;
    client.from(TABLE).delete().eq('id', id).then(function (res) {
      if (res.error) { window.alert(friendlyError(res.error)); return; }
      state.posts = state.posts.filter(function (p) { return p.id !== id; });
      render();
    });
  }

  function setHidden(id, hidden) {
    var client = sb();
    if (!client) return;
    client.from(TABLE).update({ is_hidden: hidden }).eq('id', id).select()
      .then(function (res) {
        if (res.error) { window.alert(friendlyError(res.error)); return; }
        var row = res.data && res.data[0];
        if (row) state.posts = state.posts.map(function (p) { return p.id === id ? row : p; });
        render();
      });
  }

  function resolveAdmin() {
    var client = sb();
    if (!client || !state.user) { state.isAdmin = false; return Promise.resolve(); }
    // Own profile row only — the same read every other page already performs.
    return client.from('profiles').select('role').eq('id', state.user.id).maybeSingle()
      .then(function (res) {
        state.isAdmin = !!(res && res.data && res.data.role === 'admin');
      })
      .catch(function () { state.isAdmin = false; });
  }

  /* ------------------------------------------------------------------ mount */

  function mount(container, moduleIdx) {
    if (!container) return;
    var idx = parseInt(moduleIdx, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx > 7) return;

    state.root = container;
    state.moduleIdx = idx;
    state.user = currentUser();
    container.classList.add('mfeed');
    render();

    function refresh() {
      state.user = currentUser();
      resolveAdmin().then(load);
    }

    if (window.bwcAuth && typeof window.bwcAuth.ready === 'function') {
      window.bwcAuth.ready().then(refresh).catch(refresh);
    } else {
      refresh();
    }
    window.addEventListener('bwc:auth-change', refresh);
  }

  window.BwcModuleFeed = { mount: mount, reload: load };
})();
