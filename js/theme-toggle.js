// ===== Theme Toggle - עסק ללא מתחרים =====
// Dark/Light mode with localStorage persistence + OS preference fallback

(function() {
    const STORAGE_KEY = 'bwc-theme';

    function getPreferredTheme() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
        updateToggleIcon(theme);
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        setTheme(current === 'dark' ? 'light' : 'dark');
    }

    function updateToggleIcon(theme) {
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (theme === 'dark') {
            icon.className = 'fa-solid fa-sun';
        } else {
            icon.className = 'fa-solid fa-moon';
        }
    }

    function injectToggleButton() {
        const navLeft = document.querySelector('.top-nav-left');
        if (!navLeft) return;
        const btn = document.createElement('button');
        btn.id = 'themeToggle';
        btn.className = 'theme-toggle';
        btn.onclick = toggleTheme;
        btn.setAttribute('aria-label', 'החלף מצב תצוגה');
        btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        navLeft.insertBefore(btn, navLeft.firstChild);
        updateToggleIcon(getPreferredTheme());
    }

    // Apply theme immediately to prevent FOUC
    setTheme(getPreferredTheme());

    // Inject toggle button when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectToggleButton);
    } else {
        injectToggleButton();
    }

    // Listen for OS theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(STORAGE_KEY)) {
            setTheme(e.matches ? 'dark' : 'light');
        }
    });
})();
