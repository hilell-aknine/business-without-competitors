/* ==========================================================================
   global-nav.js — Single source of truth for site navigation.

   Usage on any page:
     <header class="gnav" data-page="library"></header>
     <script src="../js/global-nav.js"></script>
   The script auto-mounts on DOMContentLoaded into any element matching
   `header.gnav[data-page]`. You can also call window.GlobalNav.mount(el, page)
   manually.

   Path resolution: links are emitted as RELATIVE paths so the site works
   identically on Vercel, GitHub Pages, and local file:// preview. Pages under
   /pages/ get a `../` prefix; root pages get nothing.
   ========================================================================== */
(function () {
  'use strict';

  /** Pages where this nav appears, in display order. */
  var PRIMARY_ITEMS = [
    { id: 'home',     label: 'בית',       icon: 'fa-house',         path: 'index.html' },
    { id: 'library',  label: 'ספרייה',    icon: 'fa-book-open',     path: 'pages/library.html' },
    { id: 'practice', label: 'תרגול',     icon: 'fa-dumbbell',      path: 'pages/practice.html' },
    { id: 'quiz',     label: 'מבחנים',    icon: 'fa-graduation-cap', path: 'pages/quiz.html', accent: true }
  ];

  /** Items that live inside the "More" (⋯) dropdown. */
  var MORE_ITEMS = [
    { id: 'hub',      label: 'השיטה',         icon: 'fa-atom',        path: 'hub.html' },
    { id: 'modules',  label: 'מודולים',       icon: 'fa-layer-group', path: 'pages/library.html?type=modules' },
    { id: 'seminars', label: 'סמינרים',       icon: 'fa-microphone',  path: 'pages/seminars.html' },
    { id: 'track',    label: 'שיח מנהיגות עם תמר', icon: 'fa-heart-pulse', path: 'pages/track.html?id=tamar-tuesday' },
    {
      id: 'transcripts',
      label: 'תמלולים מלאים',
      icon: 'fa-folder-open',
      href: 'https://drive.google.com/drive/folders/1eqCQSbe9sonexa6JTx2Qst8Nmfr-yZD7?usp=sharing',
      external: true
    },
    { id: 'apply',    label: 'עוזר היישום',  icon: 'fa-seedling',   path: 'pages/apply.html' },
    { id: 'notes',    label: 'המסמכים שלי',  icon: 'fa-folder-open', path: 'pages/notes.html' },
    { id: 'progress', label: 'ההתקדמות שלי', icon: 'fa-chart-line', path: 'pages/progress.html' },
    { id: 'profile',  label: 'הפרופיל שלי',  icon: 'fa-user-gear',  path: 'pages/profile.html'  }
  ];

  /**
   * Detect the depth of the current page so we can emit the right relative
   * prefix. Pages directly under root → "". Pages under /pages/ → "../".
   * Matches whether served from / or from any sub-path on Vercel.
   */
  function getBasePath() {
    var p = (window.location && window.location.pathname) || '';
    return /\/pages\//.test(p) ? '../' : '';
  }

  function resolveHref(item) {
    if (item.external && item.href) return item.href;
    return getBasePath() + item.path;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderPrimaryLink(item, currentPage) {
    var isActive = item.id === currentPage;
    var classes = ['gnav__link'];
    if (item.accent) classes.push('gnav__link--accent');
    if (isActive) classes.push('is-active');
    return (
      '<a href="' + escapeHtml(resolveHref(item)) + '"' +
      ' class="' + classes.join(' ') + '"' +
      (isActive ? ' aria-current="page"' : '') +
      ' data-gnav-item="' + escapeHtml(item.id) + '">' +
        '<i class="fa-solid ' + escapeHtml(item.icon) + '" aria-hidden="true"></i>' +
        '<span>' + escapeHtml(item.label) + '</span>' +
      '</a>'
    );
  }

  /* The MORE menu never marked the page you were standing on. Items that live
     only here — "ההתקדמות שלי", "הפרופיל שלי", "עוזר היישום", the track — gave
     no "you are here" signal at all, which reads as "this page is not in the
     navigation". Primary links have carried aria-current since day one; this
     brings the menu in line. */
  function renderMoreItem(item, currentPage) {
    var attrs = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    var isActive = !item.external && item.id === currentPage;
    return (
      '<a href="' + escapeHtml(resolveHref(item)) + '"' +
      ' class="gnav__more-item' + (isActive ? ' is-active' : '') + '"' +
      ' role="menuitem"' +
      (isActive ? ' aria-current="page"' : '') +
      ' data-gnav-item="' + escapeHtml(item.id) + '"' +
      attrs + '>' +
        '<i class="fa-solid ' + escapeHtml(item.icon) + '" aria-hidden="true"></i>' +
        '<span>' + escapeHtml(item.label) + '</span>' +
      '</a>'
    );
  }

  function buildHTML(currentPage) {
    // FIX-ENGINE F-015 (2026-07-22): בדף הבית אין פריטי ניווט ראשיים (בית/ספרייה/תרגול/מבחנים)
    // לבקשת הלל — הפורטל עצמו הוא המרכז. בשאר הדפים התפריט נשאר כדי שאפשר יהיה לחזור.
    var primaryItems = currentPage === 'home' ? [] : PRIMARY_ITEMS;
    var primary = primaryItems.map(function (i) { return renderPrimaryLink(i, currentPage); }).join('');
    var more    = MORE_ITEMS.map(function (i) { return renderMoreItem(i, currentPage); }).join('');
    var brandHref = getBasePath() + 'index.html';
    return (
      '<div class="gnav__start">' +
        '<a class="gnav__brand" href="' + escapeHtml(brandHref) + '" aria-label="עסק ללא מתחרים — חזרה לדף הבית">' +
          '<span class="gnav__brand-icon"><i class="fa-solid fa-rocket" aria-hidden="true"></i></span>' +
          '<span class="gnav__brand-text">עסק ללא <b>מתחרים</b></span>' +
        '</a>' +
      '</div>' +
      '<nav class="gnav__center" aria-label="ניווט ראשי">' +
        '<ul class="gnav__nav" role="list">' + primary + '</ul>' +
      '</nav>' +
      '<div class="gnav__end">' +
        // Admin-only door, filled in by showAdminLinks() once is_admin() says so.
        '<span class="gnav__admin-slot" data-gnav-admin-slot hidden></span>' +
        '<div class="gnav__auth-wrap" data-gnav-auth>' +
          '<button type="button" class="gnav__auth gnav__auth--guest" data-gnav-auth-trigger aria-label="התחברות" aria-haspopup="dialog">' +
            '<i class="fa-solid fa-user" aria-hidden="true"></i>' +
            '<span class="gnav__auth-label">התחברות</span>' +
          '</button>' +
          '<div class="gnav__auth-menu" id="gnavAuthMenu" role="menu" aria-label="פעולות חשבון" hidden>' +
            '<div class="gnav__auth-email" data-gnav-auth-email></div>' +
            '<div data-gnav-admin hidden></div>' +
            '<button type="button" class="gnav__auth-item" role="menuitem" data-gnav-auth-signout>' +
              '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>' +
              '<span>התנתקות</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="gnav__more-wrap">' +
          '<button type="button" class="gnav__more" aria-label="עוד" aria-haspopup="menu" aria-expanded="false" aria-controls="gnavMoreMenu">' +
            '<i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i>' +
          '</button>' +
          '<div class="gnav__more-menu" id="gnavMoreMenu" role="menu" aria-label="פעולות נוספות" hidden>' +
            more +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ----- More menu controller (open/close, outside-click, Escape) ----- */
  function wireMoreMenu(root) {
    var trigger = root.querySelector('.gnav__more');
    var menu    = root.querySelector('.gnav__more-menu');
    if (!trigger || !menu) return;

    function isOpen() {
      return !menu.hidden && menu.classList.contains('is-open');
    }
    function open() {
      if (isOpen()) return;
      menu.hidden = false;
      requestAnimationFrame(function () { menu.classList.add('is-open'); });
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
      if (!isOpen() && menu.hidden) return;
      menu.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      var hide = function () {
        if (!menu.classList.contains('is-open')) menu.hidden = true;
        menu.removeEventListener('transitionend', hide);
      };
      menu.addEventListener('transitionend', hide);
      setTimeout(function () {
        if (!menu.classList.contains('is-open')) menu.hidden = true;
      }, 220);
    }
    function toggle() { if (isOpen()) close(); else open(); }

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    menu.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[role="menuitem"]')) {
        setTimeout(close, 0);
      }
    });

    document.addEventListener('click', function (e) {
      if (!isOpen()) return;
      var t = e.target;
      if (!(t instanceof Node)) return;
      if (menu.contains(t) || trigger.contains(t)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close();
        try { trigger.focus(); } catch (err) {}
      }
    });
  }

  /* ----- Auth button controller (guest -> opens modal; signed-in -> menu) ----- */
  function wireAuth(root) {
    var wrap    = root.querySelector('[data-gnav-auth]');
    var trigger = root.querySelector('[data-gnav-auth-trigger]');
    var menu    = root.querySelector('#gnavAuthMenu');
    var emailEl = root.querySelector('[data-gnav-auth-email]');
    var signout = root.querySelector('[data-gnav-auth-signout]');
    if (!wrap || !trigger) return;

    function getInitial(email) {
      if (!email) return '?';
      return String(email.trim().charAt(0) || '?').toUpperCase();
    }

    function setSignedOutUI() {
      trigger.classList.add('gnav__auth--guest');
      trigger.classList.remove('gnav__auth--user');
      trigger.setAttribute('aria-label', 'התחברות');
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML =
        '<i class="fa-solid fa-user" aria-hidden="true"></i>' +
        '<span class="gnav__auth-label">התחברות</span>';
      if (menu) { menu.hidden = true; menu.classList.remove('is-open'); }
      hideAdminLinks();
    }

    function setSignedInUI(user) {
      trigger.classList.remove('gnav__auth--guest');
      trigger.classList.add('gnav__auth--user');
      trigger.setAttribute('aria-label', 'חשבון: ' + (user.email || ''));
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-controls', 'gnavAuthMenu');
      trigger.innerHTML =
        '<span class="gnav__auth-initial" aria-hidden="true">' + escapeHtml(getInitial(user.email)) + '</span>';
      if (emailEl) emailEl.textContent = user.email || '';
      showAdminLinks(user);
    }

    /* Admin entry points. The admin pages existed (pages/admin-users.html,
       pages/admin-stats.html) but no menu anywhere linked to them, so an admin
       who logged in saw exactly what a learner sees and concluded he had no
       admin access. The role check is the same is_admin() RPC the admin pages
       use; the links are only a door. RLS on the data is the real lock. */
    /* 2026-10-22: Hillel still "saw no admin button". Measured on production
       with his own session: the links WERE there on every page, but only
       inside the account menu, which opens from the small initial-letter
       circle. Nothing on screen said "admin". Now an admin also gets a
       visible "פאנל ניהול" button in the bar itself, on every page, desktop
       and phone. Two smaller holes closed on the way:
         * a failed is_admin() call (session still restoring, network blip)
           was memoized as "checked", so the links never came for the rest
           of the page's life. Now a failure is retried.
         * the answer is remembered for this tab (sessionStorage), so after a
           refresh the button is there at once instead of after a round trip.
           It is only a hint: is_admin() still runs and can take it away. */
    var adminBox = root.querySelector('[data-gnav-admin]');
    var adminSlot = root.querySelector('[data-gnav-admin-slot]');
    var adminCheckedFor = null;
    var adminRetry = null;
    var ADMIN_HINT = 'bwc_is_admin_';

    function adminHint(uid, val) {
      try {
        if (val === undefined) return sessionStorage.getItem(ADMIN_HINT + uid) === '1';
        if (val) sessionStorage.setItem(ADMIN_HINT + uid, '1');
        else sessionStorage.removeItem(ADMIN_HINT + uid);
      } catch (e) { return false; }
    }

    function renderAdmin() {
      var base = getBasePath();
      var here = (location.pathname.split('/').pop() || '').toLowerCase();
      if (adminBox) {
        adminBox.innerHTML =
          '<a class="gnav__auth-item" role="menuitem" href="' + escapeHtml(base + 'pages/admin-users.html') + '">' +
            '<i class="fa-solid fa-users-gear" aria-hidden="true"></i><span>ניהול משתמשים</span></a>' +
          '<a class="gnav__auth-item" role="menuitem" href="' + escapeHtml(base + 'pages/admin-stats.html') + '">' +
            '<i class="fa-solid fa-chart-pie" aria-hidden="true"></i><span>נתוני למידה</span></a>';
        adminBox.hidden = false;
      }
      if (adminSlot) {
        var active = here === 'admin-users.html' || here === 'admin-stats.html';
        adminSlot.innerHTML =
          '<a class="gnav__admin' + (active ? ' is-active' : '') + '" data-gnav-admin-top' +
          ' href="' + escapeHtml(base + 'pages/admin-users.html') + '"' +
          (active ? ' aria-current="page"' : '') + ' aria-label="פאנל ניהול" title="פאנל ניהול">' +
            '<i class="fa-solid fa-user-shield" aria-hidden="true"></i>' +
            '<span class="gnav__admin-label">פאנל ניהול</span>' +
          '</a>';
        adminSlot.hidden = false;
      }
    }

    function clearAdmin() {
      if (adminBox) { adminBox.hidden = true; adminBox.innerHTML = ''; }
      if (adminSlot) { adminSlot.hidden = true; adminSlot.innerHTML = ''; }
    }

    function showAdminLinks(user, attempt) {
      if (!user || !user.id) return;
      attempt = attempt || 0;
      if (!attempt && adminCheckedFor === user.id) return;
      adminCheckedFor = user.id;
      if (adminRetry) { clearTimeout(adminRetry); adminRetry = null; }
      if (adminHint(user.id)) renderAdmin();   // instant after a refresh

      function retry() {
        if (adminCheckedFor !== user.id || attempt >= 4) return;
        adminRetry = setTimeout(function () { showAdminLinks(user, attempt + 1); }, 1500 * (attempt + 1));
      }

      var sb = window.bwcSupabase;
      if (!sb || typeof sb.rpc !== 'function') { retry(); return; }
      sb.rpc('is_admin', { uid: user.id }).then(function (res) {
        if (adminCheckedFor !== user.id) return;
        if (!res || res.error) { retry(); return; }
        if (res.data === true) { adminHint(user.id, true); renderAdmin(); }
        else { adminHint(user.id, false); clearAdmin(); }
      }, retry);
    }
    function hideAdminLinks() {
      adminCheckedFor = null;
      if (adminRetry) { clearTimeout(adminRetry); adminRetry = null; }
      clearAdmin();
    }

    function openMenu() {
      if (!menu) return;
      menu.hidden = false;
      requestAnimationFrame(function () { menu.classList.add('is-open'); });
      trigger.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      if (!menu) return;
      menu.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      setTimeout(function () {
        if (!menu.classList.contains('is-open')) menu.hidden = true;
      }, 220);
    }

    /* Click handler: guest -> open modal, user -> toggle menu */
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var user = window.bwcAuth ? window.bwcAuth.getUser() : null;
      if (!user) {
        if (window.bwcAuthModal && typeof window.bwcAuthModal.open === 'function') {
          window.bwcAuthModal.open('login');
        } else {
          console.error('[gnav] auth modal not loaded');
        }
        return;
      }
      if (menu && menu.hidden) openMenu();
      else closeMenu();
    });

    if (signout) {
      signout.addEventListener('click', function (e) {
        e.preventDefault();
        closeMenu();
        if (window.bwcAuth) window.bwcAuth.signOut();
      });
    }

    /* Outside click closes the user menu */
    document.addEventListener('click', function (e) {
      if (!menu || menu.hidden) return;
      var t = e.target;
      if (!(t instanceof Node)) return;
      if (menu.contains(t) || trigger.contains(t)) return;
      closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu && !menu.hidden) {
        e.preventDefault();
        closeMenu();
        try { trigger.focus(); } catch (_) {}
      }
    });

    /* React to auth state changes (login from another tab, logout, etc.) */
    function applyState(user) {
      if (user) setSignedInUI(user);
      else setSignedOutUI();
    }

    if (window.bwcAuth) {
      window.bwcAuth.onChange(applyState);
    } else {
      // auth.js may load after global-nav.js (defer order). Listen for the event.
      window.addEventListener('bwc:auth-change', function (ev) {
        var user = ev && ev.detail && ev.detail.user;
        applyState(user);
      });
    }
  }

  /**
   * Mount the navbar into the given element with the given current page id.
   * If `el` is omitted, looks up `header.gnav[data-page]`.
   */
  function mount(el, page) {
    if (typeof el === 'string') { page = el; el = null; }
    if (!el) el = document.querySelector('header.gnav[data-page]');
    if (!el) return null;
    var currentPage = page || el.getAttribute('data-page') || '';
    el.classList.add('gnav');
    el.setAttribute('aria-label', 'ניווט ראשי');
    el.innerHTML = buildHTML(currentPage);
    wireMoreMenu(el);
    wireAuth(el);
    return el;
  }

  function autoMount() {
    var hosts = document.querySelectorAll('header.gnav[data-page]');
    hosts.forEach(function (host) { mount(host, host.getAttribute('data-page')); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.GlobalNav = { mount: mount, _items: { primary: PRIMARY_ITEMS, more: MORE_ITEMS } };
})();
