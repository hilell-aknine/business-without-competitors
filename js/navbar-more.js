/* ==========================================================================
   navbar-more.js — Controller for the header's "More" (3-dots) dropdown.
   Wires up: click trigger to toggle, outside-click + Escape to close,
   ARIA state sync. Exposes window.NavbarMore = { open, close, toggle }.
   IIFE — no globals leak.
   ========================================================================== */
(function () {
  'use strict';

  /** @type {HTMLButtonElement|null} */ var trigger = null;
  /** @type {HTMLElement|null} */      var menu    = null;

  function isOpen() {
    return !!menu && !menu.hidden && menu.classList.contains('is-open');
  }

  function open() {
    if (!trigger || !menu) return;
    if (isOpen()) return;
    menu.hidden = false;
    // Force a frame so the transition runs from the [hidden] -> shown state.
    requestAnimationFrame(function () {
      menu.classList.add('is-open');
    });
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!trigger || !menu) return;
    if (!isOpen() && menu.hidden) return;
    menu.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    // Hide after the transition so it's not a tab/AT target while closed.
    var hide = function () {
      if (!menu.classList.contains('is-open')) {
        menu.hidden = true;
      }
      menu.removeEventListener('transitionend', hide);
    };
    menu.addEventListener('transitionend', hide);
    // Fallback in case transitionend doesn't fire (reduced motion, etc.).
    setTimeout(function () {
      if (!menu.classList.contains('is-open')) {
        menu.hidden = true;
      }
    }, 220);
  }

  function toggle() {
    if (isOpen()) {
      close();
    } else {
      open();
    }
  }

  function onDocClick(e) {
    if (!isOpen()) return;
    var target = e.target;
    if (!(target instanceof Node)) return;
    // Click inside the dropdown OR on the trigger itself: ignore here.
    // (The trigger has its own handler that calls toggle.)
    if (menu.contains(target)) return;
    if (trigger.contains(target)) return;
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
      // Return focus to the trigger for keyboard users.
      try { trigger.focus(); } catch (err) {}
    }
  }

  function init() {
    trigger = document.querySelector('.v1-hd__more');
    menu    = document.querySelector('.v1-hd__more-menu');
    if (!trigger || !menu) return;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    // When a menu item is activated, close the menu (links/buttons inside).
    menu.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var item = t.closest('[role="menuitem"]');
      if (item) {
        // Let the item's own behavior run (link nav, original button handler),
        // then close. Use a microtask so external handlers fire first.
        setTimeout(close, 0);
      }
    });

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NavbarMore = {
    open: open,
    close: close,
    toggle: toggle
  };
})();
