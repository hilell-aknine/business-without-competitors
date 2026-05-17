/* ============================================================
   ONBOARDING — First-time visitor flow (Endowed Progress Effect)
   ------------------------------------------------------------
   - Shows a one-time modal with 3 cosmetic steps.
   - Each step adds +1.5% to a SEPARATE bonus key
     (bwc_onboarding_bonus_pct) — never touches real lesson progress.
   - All-3-done  -> bwc_onboarding_completed = 'true', modal stays gone.
   - X / "skip"  -> closes modal but does NOT mark completed.

   Storage keys (all under bwc_ namespace):
     bwc_onboarding_completed        'true' | absent
     bwc_onboarding_bonus_pct        number 0..4.5
     bwc_onboarding_steps            JSON {video,goal,tour: bool}
     bwc_weekly_goal                 '3' | '5' | '7' | '10'

   Public surface: window.Onboarding.{ getBonusPct, render, reset }
   ============================================================ */
(function () {
    'use strict';

    // -------- Configuration --------
    var INTRO_VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // placeholder — replace with real intro
    var STEP_BONUS = 1.5;       // percent per completed step
    var TOTAL_STEPS = 3;        // -> 4.5% max bonus

    var KEY_SEEN   = 'onboarding_seen';            // primary — set on any close
    var KEY_DONE   = 'bwc_onboarding_completed';   // legacy — kept for read-side migration
    var KEY_BONUS  = 'bwc_onboarding_bonus_pct';
    var KEY_STEPS  = 'bwc_onboarding_steps';
    var KEY_GOAL   = 'bwc_weekly_goal';

    // -------- Storage helpers --------
    function lsGet(k, fallback) {
        try { var v = localStorage.getItem(k); return v === null ? fallback : v; }
        catch (e) { return fallback; }
    }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota / private mode */ } }

    function getSteps() {
        try {
            var raw = localStorage.getItem(KEY_STEPS);
            if (!raw) return { video: false, goal: false, tour: false };
            var parsed = JSON.parse(raw);
            return {
                video: !!parsed.video,
                goal:  !!parsed.goal,
                tour:  !!parsed.tour
            };
        } catch (e) {
            return { video: false, goal: false, tour: false };
        }
    }
    function setSteps(steps) {
        lsSet(KEY_STEPS, JSON.stringify(steps));
        var doneCount = (steps.video ? 1 : 0) + (steps.goal ? 1 : 0) + (steps.tour ? 1 : 0);
        var bonus = +(doneCount * STEP_BONUS).toFixed(2);
        lsSet(KEY_BONUS, String(bonus));
    }

    function getBonusPct() {
        var raw = lsGet(KEY_BONUS, '0');
        var n = parseFloat(raw);
        if (!isFinite(n) || n < 0) return 0;
        if (n > TOTAL_STEPS * STEP_BONUS) return TOTAL_STEPS * STEP_BONUS;
        return n;
    }

    function isCompleted() {
        return lsGet(KEY_SEEN, '') === 'true' || lsGet(KEY_DONE, '') === 'true';
    }

    // -------- Modal HTML rendering --------
    function buildModal() {
        var root = document.getElementById('onbOverlay');
        if (!root) return null;

        var steps = getSteps();
        var bonus = getBonusPct();

        root.innerHTML = [
            '<div class="onb-modal" role="dialog" aria-modal="true" aria-labelledby="onbTitle" dir="rtl">',
                '<button type="button" class="onb-close" id="onbClose" aria-label="סגור">',
                    '<i class="fa-solid fa-xmark" aria-hidden="true"></i>',
                '</button>',

                '<div class="onb-eyebrow">',
                    '<i class="fa-solid fa-sparkles" aria-hidden="true"></i>',
                    'ברוך הבא',
                '</div>',
                '<h2 id="onbTitle" class="onb-title">',
                    '3 צעדים קצרים, ואתה <b>בדרך</b>.',
                '</h2>',
                '<p class="onb-sub">',
                    'התחלנו לך את ההתקדמות. כל צעד שתסיים כאן מוסיף לך תאוצה לפני השיעור הראשון — ',
                    'בלי הבטחות, רק מומנטום.',
                '</p>',

                '<div class="onb-meter" aria-live="polite">',
                    '<span class="onb-meter__label">',
                        '<i class="fa-solid fa-bolt" aria-hidden="true"></i>',
                        'בונוס פתיחה שצברת',
                    '</span>',
                    '<span class="onb-meter__value" id="onbBonusValue">+', bonus.toFixed(1), '%</span>',
                '</div>',

                '<div class="onb-steps" id="onbStepsList">',
                    renderStepBtn('video', steps.video,
                        'fa-circle-play',
                        'צפה בסרטון פתיחה',
                        'דקה וחצי על איך לנצל את הפורטל נכון.',
                        'פתח סרטון'),
                    renderStepGoal(steps.goal),
                    renderStepBtn('tour', steps.tour,
                        'fa-compass',
                        'סיור מודרך בפורטל',
                        'נראה לך איפה כל דבר נמצא, כדי שלא תתבזבז זמן בחיפושים.',
                        'התחל סיור'),
                '</div>',

                '<div class="onb-foot">',
                    '<span class="onb-foot__hint">',
                        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ',
                        'הצעדים האלה לא מחליפים שיעורים — הם רק עוזרים לך להתחיל בצורה חכמה.',
                    '</span>',
                    '<button type="button" class="onb-foot__skip" id="onbSkip">דלג לעת עתה</button>',
                '</div>',
            '</div>'
        ].join('');

        return root;
    }

    function renderStepBtn(id, done, icon, title, sub, cta) {
        return [
            '<button type="button"',
                ' class="onb-step', done ? ' is-done' : '', '"',
                ' data-onb-step="', id, '"',
                ' aria-pressed="', done ? 'true' : 'false', '">',
                '<span class="onb-step__icon" aria-hidden="true">',
                    '<i class="fa-solid ', (done ? 'fa-check' : icon), '"></i>',
                '</span>',
                '<span class="onb-step__body">',
                    '<span class="onb-step__title">', title, '</span>',
                    '<span class="onb-step__sub">', sub, '</span>',
                '</span>',
                '<span class="onb-step__cta">',
                    '<span class="onb-step__cta-text" data-cta="', cta, '"></span>',
                    (done ? '' : '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>'),
                '</span>',
            '</button>'
        ].join('');
    }

    function renderStepGoal(done) {
        var saved = lsGet(KEY_GOAL, '5');
        var options = ['3', '5', '7', '10'];
        var optsHtml = options.map(function (o) {
            return '<option value="' + o + '"' + (o === saved ? ' selected' : '') + '>' + o + ' שיעורים</option>';
        }).join('');

        return [
            '<div class="onb-step onb-step--goal', (done ? ' is-done' : ''), '" data-onb-step="goal" aria-label="הגדרת יעד שבועי">',
                '<span class="onb-step__icon" aria-hidden="true">',
                    '<i class="fa-solid ', (done ? 'fa-check' : 'fa-bullseye'), '"></i>',
                '</span>',
                '<span class="onb-step__body">',
                    '<span class="onb-step__title">הגדר יעד שבועי</span>',
                    '<span class="onb-step__sub">כמה שיעורים אתה רוצה לסיים בשבוע? בלי לחץ — תמיד אפשר לשנות.</span>',
                '</span>',
                '<span class="onb-step__cta">',
                    '<span class="onb-step__cta-text" data-cta="', (done ? '' : 'בחר'), '"></span>',
                '</span>',
                '<div class="onb-step__goal-row">',
                    '<label for="onbGoalSelect">היעד שלי:</label>',
                    '<select id="onbGoalSelect" class="onb-goal-select" aria-label="כמה שיעורים בשבוע">',
                        optsHtml,
                    '</select>',
                    '<button type="button" class="onb-goal-confirm" id="onbGoalConfirm">',
                        (done ? 'עדכן יעד' : 'שמור יעד'),
                    '</button>',
                '</div>',
            '</div>'
        ].join('');
    }

    // -------- Step actions --------
    function markStep(id) {
        var steps = getSteps();
        if (steps[id]) return; // already done — idempotent
        steps[id] = true;
        setSteps(steps);
        // Re-render modal to reflect state, refresh meter + step icons
        buildModal();
        attachHandlers();
        // Refresh visible course progress (hero/header/sidebar)
        try { if (typeof window.renderHero === 'function') window.renderHero(); } catch (e) {}
        // If all done, close + persist completion
        if (steps.video && steps.goal && steps.tour) {
            lsSet(KEY_SEEN, 'true');
            // Small delay so user sees the final tick before close
            setTimeout(close, 700);
        }
    }

    function attachHandlers() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;

        var closeBtn = root.querySelector('#onbClose');
        if (closeBtn) closeBtn.addEventListener('click', close);

        var skipBtn = root.querySelector('#onbSkip');
        if (skipBtn) skipBtn.addEventListener('click', close);

        // Step: video
        var videoBtn = root.querySelector('[data-onb-step="video"]');
        if (videoBtn) {
            videoBtn.addEventListener('click', function () {
                if (videoBtn.classList.contains('is-done')) return;
                if (INTRO_VIDEO_URL) {
                    try { window.open(INTRO_VIDEO_URL, '_blank', 'noopener'); } catch (e) {}
                }
                markStep('video');
            });
        }

        // Step: goal
        var goalBtn = root.querySelector('#onbGoalConfirm');
        var goalSelect = root.querySelector('#onbGoalSelect');
        if (goalBtn && goalSelect) {
            goalBtn.addEventListener('click', function () {
                lsSet(KEY_GOAL, goalSelect.value);
                markStep('goal');
            });
        }

        // Step: tour
        var tourBtn = root.querySelector('[data-onb-step="tour"]');
        if (tourBtn) {
            tourBtn.addEventListener('click', function () {
                if (tourBtn.classList.contains('is-done')) return;
                // Real guided tour is out of scope — placeholder mark.
                markStep('tour');
            });
        }

        // ESC to close
        root.addEventListener('keydown', onKeydown);
    }

    function onKeydown(ev) {
        if (ev.key === 'Escape') { close(); }
    }

    // -------- Open / close --------
    function open() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;
        buildModal();
        attachHandlers();
        root.hidden = false;
        document.body.style.overflow = 'hidden';
        // Focus the close button for accessibility, after the rise animation
        setTimeout(function () {
            var c = root.querySelector('#onbClose');
            if (c) c.focus();
        }, 60);
    }

    function close() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;
        // Any close (X / "דלג לעת עתה" / ESC / finish-all) marks the modal as
        // seen so it never reopens on subsequent loads.
        lsSet(KEY_SEEN, 'true');
        root.hidden = true;
        root.removeEventListener('keydown', onKeydown);
        document.body.style.overflow = '';
    }

    // -------- Hero progress bonus injection --------
    /**
     * Add the bonus % to the displayed lesson-progress numbers in:
     *   - #heroProgressPct (hero)
     *   - #heroProgressFill (hero bar width)
     *   - #headerProgressPct + #headerProgressFill
     *   - #sidePct + #sideFill
     * Real lesson progress (completedLessons array) is NEVER touched.
     * The display % is capped at 100. A small chip is added next to the
     * hero progress label when bonus > 0.
     */
    function applyDisplayBonus() {
        var bonus = getBonusPct();
        if (bonus <= 0) {
            removeBonusChip();
            return;
        }

        var ids = [
            { pct: 'heroProgressPct',   fill: 'heroProgressFill'   },
            { pct: 'headerProgressPct', fill: 'headerProgressFill' },
            { pct: 'sidePct',           fill: 'sideFill'           }
        ];

        ids.forEach(function (pair) {
            var pctEl = document.getElementById(pair.pct);
            var fillEl = document.getElementById(pair.fill);
            if (!pctEl || !fillEl) return;

            // Parse the current "real" pct from text (renderHero just wrote it).
            var raw = (pctEl.textContent || '0').replace('%', '').trim();
            var basePct = parseFloat(raw);
            if (!isFinite(basePct)) basePct = 0;
            var boosted = Math.min(100, +(basePct + bonus).toFixed(1));

            // Whole number for header/side (matches existing visual), 1 decimal for hero
            if (pair.pct === 'heroProgressPct') {
                pctEl.textContent = boosted.toFixed(1).replace(/\.0$/, '') + '%';
            } else {
                pctEl.textContent = Math.round(boosted) + '%';
            }
            fillEl.style.width = boosted + '%';
        });

        addBonusChip(bonus);
    }

    function addBonusChip(bonus) {
        var row = document.querySelector('.v1-hero__progress-row');
        if (!row) return;
        var existing = row.querySelector('.onb-bonus-tip');
        if (existing) {
            existing.setAttribute('title', 'כולל ' + bonus.toFixed(1) + '% בונוס פתיחה');
            existing.querySelector('.onb-bonus-tip__val').textContent = '+' + bonus.toFixed(1) + '%';
            return;
        }
        var chip = document.createElement('span');
        chip.className = 'onb-bonus-tip';
        chip.setAttribute('title', 'כולל ' + bonus.toFixed(1) + '% בונוס פתיחה');
        chip.setAttribute('aria-label', 'כולל ' + bonus.toFixed(1) + ' אחוז בונוס פתיחה');
        chip.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>'
            + '<span class="onb-bonus-tip__val">+' + bonus.toFixed(1) + '%</span>';
        // Insert next to the pct label inside the row
        var pctSpan = row.querySelector('.v1-hero__progress-pct');
        if (pctSpan && pctSpan.parentNode) {
            pctSpan.parentNode.insertBefore(chip, pctSpan);
        } else {
            row.appendChild(chip);
        }
    }

    function removeBonusChip() {
        var existing = document.querySelector('.v1-hero__progress-row .onb-bonus-tip');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    // -------- Hook into existing renderHero so bonus is re-applied on every render --------
    function hookRenderHero() {
        var orig = window.renderHero;
        if (typeof orig !== 'function') return; // Hero render not present — bail.
        if (orig.__onbWrapped) return;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            try { applyDisplayBonus(); } catch (e) {}
            return r;
        };
        wrapped.__onbWrapped = true;
        window.renderHero = wrapped;
    }

    // -------- Boot --------
    function boot() {
        hookRenderHero();
        // Apply bonus on initial paint (in case renderHero already ran before our script).
        applyDisplayBonus();

        if (!isCompleted()) {
            // Show the modal on first visit, after a tiny delay so the page can paint first.
            setTimeout(open, 350);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // -------- Public API --------
    window.Onboarding = {
        getBonusPct: getBonusPct,
        applyDisplayBonus: applyDisplayBonus,
        open: open,
        close: close,
        reset: function () {
            try {
                localStorage.removeItem(KEY_SEEN);
                localStorage.removeItem(KEY_DONE);
                localStorage.removeItem(KEY_BONUS);
                localStorage.removeItem(KEY_STEPS);
            } catch (e) {}
            removeBonusChip();
        }
    };
})();
