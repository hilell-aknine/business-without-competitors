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

  function renderMoreItem(item) {
    var attrs = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return (
      '<a href="' + escapeHtml(resolveHref(item)) + '"' +
      ' class="gnav__more-item"' +
      ' role="menuitem"' +
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
    var more    = MORE_ITEMS.map(renderMoreItem).join('');
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
        '<div class="gnav__auth-wrap" data-gnav-auth>' +
          '<button type="button" class="gnav__auth gnav__auth--guest" data-gnav-auth-trigger aria-label="התחברות" aria-haspopup="dialog">' +
            '<i class="fa-solid fa-user" aria-hidden="true"></i>' +
            '<span class="gnav__auth-label">התחברות</span>' +
          '</button>' +
          '<div class="gnav__auth-menu" id="gnavAuthMenu" role="menu" aria-label="פעולות חשבון" hidden>' +
            '<div class="gnav__auth-email" data-gnav-auth-email></div>' +
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
