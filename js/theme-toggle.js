// ===== Theme - עסק ללא מתחרים =====
// 2026-11-12: one rule for the whole portal. Light is the default (Zvika's
// slides are light); the learner's own choice is remembered in `bwc-theme`.
// The first paint is handled by a one-line script in each page's <head>; this
// file only exposes the API. The switch itself lives in the ⋮ menu
// (js/global-nav.js), which carries the same logic, so pages that never
// loaded this file still get the toggle.
(function () {
    var KEY = 'bwc-theme';

    function get() {
        try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; }
        catch (e) { return 'light'; }
    }

    function set(theme) {
        theme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(KEY, theme); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('bwc:theme-change', { detail: { theme: theme } })); } catch (e) {}
        return theme;
    }

    if (!window.bwcTheme) {
        window.bwcTheme = { get: get, set: set, toggle: function () { return set(get() === 'dark' ? 'light' : 'dark'); } };
    }
    document.documentElement.setAttribute('data-theme', get());
})();
