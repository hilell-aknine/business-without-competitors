/* ============================================================
   ONBOARDING — "מי אני" questionnaire (server-backed)
   ------------------------------------------------------------
   REPLACES the old 3-step cosmetic flow (intro video / weekly goal / tour).
   Two things were wrong with it:
     1. Nothing reached the server. Every answer died in localStorage, so the
        portal knew literally nothing about its learners.
     2. The "intro video" step opened a hardcoded placeholder YouTube id
        (dQw4w9WgXcQ — a Rickroll) on a public site. There is no real intro
        video, so the step is gone rather than left pointing at a joke link.

   What stays: the Endowed Progress Effect. Six questions x 0.75% = the same
   4.5% opening bonus ceiling as before, applied to the DISPLAYED progress
   only. Real lesson progress (bwc_completed) is never touched.

   Questions are derived from the actual course (The Atomic Method, 8 modules:
   הכנה / מנהיגות / חדשנות / מוצר משנה חיים / הפיצוח / השפעה / המרה /
   אופטימיזציה, plus the "בורות וסולמות" seminar), not a generic template.
   The obstacle question maps each answer to the module that answers it.

   Storage
     localStorage (offline cache + guests):
       bwc_onboarding_q_v1     JSON { answers:{qid:{id,label}}, completedAt }
       bwc_onboarding_q_seen   'true' once the modal has been shown
       bwc_onboarding_bonus_pct  number 0..4.5   (kept from the old flow)
       bwc_weekly_goal           '3'|'5'|'7'|'10' (kept from the old flow)
     Supabase (source of truth for logged-in learners):
       public.onboarding_answers — one row per user (migration 006)

   Sync model deliberately does NOT reuse sync-localstorage.js, which is
   one-time-per-device (a known open bug). Every answer upserts immediately,
   and on login we reconcile local <-> server both ways.

   Public surface: window.Onboarding.{ getBonusPct, applyDisplayBonus,
                                       open, close, reset, getAnswers }
   Load order: after supabase-config -> auth (needs window.bwcAuth).
   ============================================================ */
(function () {
    'use strict';

    /* ---------------------------------------------------- configuration */

    var TOTAL_STEPS = 6;
    var STEP_BONUS  = 0.75;            // 6 x 0.75 = 4.5% — same ceiling as before
    var MAX_BONUS   = TOTAL_STEPS * STEP_BONUS;

    var KEY_DATA   = 'bwc_onboarding_q_v1';
    var KEY_SEEN   = 'bwc_onboarding_q_seen';
    var KEY_BONUS  = 'bwc_onboarding_bonus_pct';   // shared with the old flow
    var KEY_GOAL   = 'bwc_weekly_goal';            // shared with the old flow

    /* Legacy keys — read only, so an existing learner keeps their old bonus
       and we can tell that they went through the previous flow. */
    var LEGACY_SEEN  = 'onboarding_seen';
    var LEGACY_DONE  = 'bwc_onboarding_completed';

    /* The six questions. `col` is the matching column in onboarding_answers. */
    var QUESTIONS = [
        {
            id: 'business_stage',
            col: 'business_stage',
            icon: 'fa-stairs',
            title: 'איפה העסק שלך עומד היום?',
            sub: 'בשפה של "בורות וסולמות" — על איזה שלב בסולם אתה עומד עכשיו.',
            options: [
                { id: 'idea',   label: 'יש רעיון, עדיין אין עסק' },
                { id: 'first',  label: 'עסק צעיר, לקוחות ראשונים' },
                { id: 'solo',   label: 'עסק שרץ — אבל הכל תלוי בי' },
                { id: 'team',   label: 'יש צוות, רוצה לצמוח' },
                { id: 'leader', label: 'מוביל בתחום, מחפש את הקפיצה הבאה' }
            ]
        },
        {
            id: 'business_type',
            col: 'business_type',
            icon: 'fa-box-open',
            title: 'מה אתה מוכר?',
            sub: 'זה מה שיקבע איך תיראה ההצעה שלך כשנגיע לבנות אותה.',
            options: [
                { id: 'service',   label: 'שירות אישי — ייעוץ, טיפול, ליווי' },
                { id: 'digital',   label: 'קורס או מוצר דיגיטלי' },
                { id: 'product',   label: 'מוצר פיזי או חנות' },
                { id: 'b2b',       label: 'שירות לעסקים (B2B)' },
                { id: 'undecided', label: 'עוד לא סגרתי על זה' }
            ]
        },
        {
            id: 'main_obstacle',
            col: 'main_obstacle',
            icon: 'fa-mountain',
            title: 'מה החומה שאתה נתקל בה עכשיו?',
            sub: 'בחר את זו שהכי כואבת. לפי התשובה נדע לאיזה מודול להפנות אותך קודם.',
            options: [
                { id: 'positioning', label: 'אני נראה כמו כולם, אין לי בידול', hint: 'מודול 5 · הפיצוח האטומי' },
                { id: 'product',     label: 'לא בטוח שהמוצר שלי באמת משנה חיים', hint: 'מודול 4 · מוצר משנה חיים' },
                { id: 'selling',     label: 'קשה לי למכור בלי להרגיש דוחף', hint: 'מודול 6 · השפעה אטומית' },
                { id: 'conversion',  label: 'יש התעניינות, אבל אנשים לא סוגרים', hint: 'מודול 7 · המרה אטומית' },
                { id: 'mindset',     label: 'הראש שלי: פחד, דחיינות, חוסר עקביות', hint: 'מודול 1 · הכנה אטומית' },
                { id: 'operations',  label: 'אין ארגון, הכל רץ דרכי', hint: 'מודול 2 · מנהיגות אטומית' }
            ]
        },
        {
            id: 'desired_outcome',
            col: 'desired_outcome',
            icon: 'fa-flag-checkered',
            title: 'איך ייראה "הצליח" בסוף הקורס?',
            sub: 'דבר אחד. זה מה שנמדוד מולו.',
            options: [
                { id: 'unique',     label: 'מיצוב שאין לו מתחרים' },
                { id: 'product',    label: 'מוצר שלקוחות מספרים עליו לאחרים' },
                { id: 'close_rate', label: 'יותר סגירות מאותה כמות פניות' },
                { id: 'org',        label: 'עסק שממשיך לרוץ גם בלעדיי' },
                { id: 'self',       label: 'שינוי בראש שלי לפני שינוי בעסק' }
            ]
        },
        {
            id: 'weekly_hours',
            col: 'weekly_hours',
            icon: 'fa-hourglass-half',
            title: 'כמה זמן בשבוע יש לך ללמידה ויישום?',
            sub: 'תשובה כנה עדיפה על תשובה שאפתנית — לפי זה נקבע קצב.',
            options: [
                { id: 'lt1',  label: 'עד שעה' },
                { id: '1to3', label: 'שעה עד שלוש' },
                { id: '3to6', label: 'שלוש עד שש' },
                { id: 'gt6',  label: 'יותר משש' }
            ]
        },
        {
            id: 'weekly_goal',
            col: null,                       // stored in its own numeric column
            icon: 'fa-bullseye',
            title: 'כמה שיעורים תסגור בשבוע?',
            sub: 'בלי לחץ. תמיד אפשר לשנות אחר כך.',
            options: [
                { id: '3',  label: '3 שיעורים בשבוע' },
                { id: '5',  label: '5 שיעורים בשבוע' },
                { id: '7',  label: '7 שיעורים בשבוע' },
                { id: '10', label: '10 שיעורים בשבוע' }
            ]
        }
    ];

    /* Which module each obstacle answer points at (0-based module index). */
    var OBSTACLE_TO_MODULE = {
        positioning: 4, product: 3, selling: 5, conversion: 6, mindset: 0, operations: 1
    };

    /* ------------------------------------------------- storage helpers */

    function lsGet(k, fallback) {
        try { var v = localStorage.getItem(k); return v === null ? fallback : v; }
        catch (e) { return fallback; }
    }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota / private mode */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function getState() {
        try {
            var raw = localStorage.getItem(KEY_DATA);
            if (!raw) return { answers: {}, completedAt: null };
            var p = JSON.parse(raw);
            return {
                answers: (p && p.answers && typeof p.answers === 'object') ? p.answers : {},
                completedAt: (p && p.completedAt) || null
            };
        } catch (e) {
            return { answers: {}, completedAt: null };
        }
    }

    function answeredCount(state) {
        return QUESTIONS.filter(function (q) { return !!(state.answers && state.answers[q.id]); }).length;
    }

    function saveState(state) {
        lsSet(KEY_DATA, JSON.stringify(state));
        var bonus = +(Math.min(TOTAL_STEPS, answeredCount(state)) * STEP_BONUS).toFixed(2);
        // Never lower a bonus a legacy learner already earned.
        var prev = parseFloat(lsGet(KEY_BONUS, '0'));
        if (!isFinite(prev)) prev = 0;
        lsSet(KEY_BONUS, String(Math.max(prev, bonus)));
        var goal = state.answers && state.answers.weekly_goal;
        if (goal && goal.id) lsSet(KEY_GOAL, String(goal.id));
    }

    function getBonusPct() {
        var n = parseFloat(lsGet(KEY_BONUS, '0'));
        if (!isFinite(n) || n < 0) return 0;
        return Math.min(n, MAX_BONUS);
    }

    function hasBeenSeen() {
        return lsGet(KEY_SEEN, '') === 'true';
    }

    function isLegacyUser() {
        return lsGet(LEGACY_SEEN, '') === 'true' || lsGet(LEGACY_DONE, '') === 'true';
    }

    /* ------------------------------------------------------ server sync */

    function sb() { return window.bwcSupabase || null; }
    function currentUser() { return (window.bwcAuth && window.bwcAuth.getUser()) || null; }

    function buildRow(userId, state) {
        var a = state.answers || {};
        var row = { user_id: userId, answers: a, steps_done: answeredCount(state) };
        QUESTIONS.forEach(function (q) {
            if (!q.col) return;
            row[q.col] = a[q.id] ? a[q.id].label : null;
        });
        var goal = a.weekly_goal ? parseInt(a.weekly_goal.id, 10) : NaN;
        row.weekly_goal = isFinite(goal) ? goal : null;
        row.completed_at = state.completedAt || null;
        return row;
    }

    var pushInFlight = false;
    var lastPush = null;   // outcome of the most recent upsert, read by renderSummary

    async function pushToServer(state) {
        var client = sb();
        var user = currentUser();
        if (!client || !user) return { deferred: true };
        if (pushInFlight) return { skipped: true };
        pushInFlight = true;
        try {
            // onboarding_answers FK-references profiles(id); ensure_profile()
            // (migration 003) self-heals the parent row for legacy/OAuth users
            // so the upsert can't die on a 23503 foreign-key violation.
            try { await client.rpc('ensure_profile'); } catch (_) {}

            var res = await client
                .from('onboarding_answers')
                .upsert(buildRow(user.id, state), { onConflict: 'user_id' });

            if (res && res.error) {
                // 42P01 = table missing -> migration 006 has not been applied.
                console.warn('[onboarding] server save failed',
                    { code: res.error.code, message: res.error.message, hint: res.error.hint });
                return { ok: false, error: res.error };
            }
            return { ok: true };
        } catch (e) {
            console.warn('[onboarding] server save threw', e);
            return { ok: false, error: e };
        } finally {
            pushInFlight = false;
        }
    }

    async function pullFromServer() {
        var client = sb();
        var user = currentUser();
        if (!client || !user) return null;
        try {
            var res = await client
                .from('onboarding_answers')
                .select('answers, completed_at, steps_done')
                .eq('user_id', user.id)
                .maybeSingle();
            if (res && res.error) {
                console.warn('[onboarding] server load failed',
                    { code: res.error.code, message: res.error.message });
                return null;
            }
            return (res && res.data) || null;
        } catch (e) {
            console.warn('[onboarding] server load threw', e);
            return null;
        }
    }

    /* On login: whoever has more answers wins. A guest who filled the
       questionnaire before signing up keeps their answers; a learner on a new
       device pulls theirs down. Deliberately NOT routed through
       sync-localstorage.js, which only ever runs once per device. */
    var reconciled = false;

    async function reconcileOnLogin() {
        if (reconciled) return;
        var user = currentUser();
        if (!user) return;
        reconciled = true;

        var local = getState();
        var remote = await pullFromServer();

        var localN = answeredCount(local);
        var remoteN = remote ? Object.keys(remote.answers || {}).length : 0;

        if (remote && remoteN >= localN && remoteN > 0) {
            var merged = { answers: remote.answers || {}, completedAt: remote.completed_at || null };
            saveState(merged);
            if (merged.completedAt || remoteN >= TOTAL_STEPS) lsSet(KEY_SEEN, 'true');
            applyDisplayBonus();
        } else if (localN > 0) {
            await pushToServer(local);
        }
    }

    /* ------------------------------------------------- modal rendering */

    var stepIdx = 0;     // which question is on screen

    function firstUnansweredIndex(state) {
        for (var i = 0; i < QUESTIONS.length; i++) {
            if (!state.answers[QUESTIONS[i].id]) return i;
        }
        return QUESTIONS.length - 1;
    }

    function renderProgressDots(state) {
        return QUESTIONS.map(function (q, i) {
            var cls = 'onb-dot';
            if (state.answers[q.id]) cls += ' is-done';
            if (i === stepIdx) cls += ' is-current';
            return '<span class="' + cls + '" aria-hidden="true"></span>';
        }).join('');
    }

    function renderQuestion(state) {
        var q = QUESTIONS[stepIdx];
        var chosen = state.answers[q.id];
        var opts = q.options.map(function (o) {
            var isSel = chosen && chosen.id === o.id;
            return [
                '<button type="button" class="onb-opt', (isSel ? ' is-selected' : ''), '"',
                    ' data-opt="', esc(o.id), '" aria-pressed="', (isSel ? 'true' : 'false'), '">',
                    '<span class="onb-opt__mark" aria-hidden="true"></span>',
                    '<span class="onb-opt__body">',
                        '<span class="onb-opt__label">', esc(o.label), '</span>',
                        (o.hint ? '<span class="onb-opt__hint">' + esc(o.hint) + '</span>' : ''),
                    '</span>',
                '</button>'
            ].join('');
        }).join('');

        return [
            '<div class="onb-q" data-q="', esc(q.id), '">',
                '<div class="onb-q__head">',
                    '<span class="onb-q__icon" aria-hidden="true"><i class="fa-solid ', esc(q.icon), '"></i></span>',
                    '<div>',
                        '<h3 class="onb-q__title">', esc(q.title), '</h3>',
                        '<p class="onb-q__sub">', esc(q.sub), '</p>',
                    '</div>',
                '</div>',
                '<div class="onb-opts" role="group" aria-label="', esc(q.title), '">', opts, '</div>',
            '</div>'
        ].join('');
    }

    function renderSummary(state) {
        var rows = QUESTIONS.map(function (q) {
            var a = state.answers[q.id];
            if (!a) return '';
            return '<li><span class="onb-sum__q">' + esc(q.title) + '</span>'
                 + '<span class="onb-sum__a">' + esc(a.label) + '</span></li>';
        }).join('');

        var obstacle = state.answers.main_obstacle;
        var mi = obstacle ? OBSTACLE_TO_MODULE[obstacle.id] : undefined;
        var mods = window.MODULES || [];
        var rec = '';
        if (mi !== undefined && mods[mi]) {
            rec = '<p class="onb-sum__rec"><i class="fa-solid fa-arrow-turn-down" aria-hidden="true"></i> '
                + 'לפי מה שסימנת, המודול שיענה לך הכי מהר הוא <b>מודול ' + (mi + 1) + ' · '
                + esc(mods[mi].title) + '</b>.</p>';
        }

        // Seed the save note synchronously. pushToServer() resolves before the
        // summary is built, so without this the line renders empty on the very
        // run that matters most (the one where the learner just finished).
        // lastPush holds the real outcome, so we never claim "saved to your
        // account" when the upsert actually failed.
        var note;
        if (!currentUser()) {
            note = 'התשובות שמורות במכשיר הזה. ברגע שתפתח חשבון הן יעלו אליו.';
        } else if (lastPush && lastPush.ok === false) {
            note = 'התשובות שמורות במכשיר. השמירה בחשבון תנסה שוב בכניסה הבאה.';
        } else {
            note = 'התשובות נשמרו בחשבון שלך.';
        }

        return [
            '<div class="onb-sum">',
                '<div class="onb-sum__icon" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></div>',
                '<h3 class="onb-sum__title">זהו. אנחנו יודעים מאיפה להתחיל.</h3>',
                rec,
                '<ul class="onb-sum__list">', rows, '</ul>',
                '<p class="onb-sum__note" id="onbSaveNote">', esc(note), '</p>',
            '</div>'
        ].join('');
    }

    function buildModal(showSummary) {
        var root = document.getElementById('onbOverlay');
        if (!root) return null;

        var state = getState();
        var bonus = getBonusPct();
        var done = answeredCount(state);
        var isSummary = !!showSummary;

        root.innerHTML = [
            '<div class="onb-modal" role="dialog" aria-modal="true" aria-labelledby="onbTitle" dir="rtl">',
                '<button type="button" class="onb-close" id="onbClose" aria-label="סגור">',
                    '<i class="fa-solid fa-xmark" aria-hidden="true"></i>',
                '</button>',

                '<div class="onb-eyebrow">',
                    '<i class="fa-solid fa-sparkles" aria-hidden="true"></i>',
                    isSummary ? 'מוכן להתחיל' : 'לפני שמתחילים',
                '</div>',
                '<h2 id="onbTitle" class="onb-title">',
                    isSummary
                        ? 'התאמנו לך את <b>נקודת ההתחלה</b>.'
                        : '<b>שש שאלות</b> קצרות, ואנחנו יודעים מאיפה להתחיל.',
                '</h2>',
                '<p class="onb-sub">',
                    isSummary
                        ? 'התשובות נשמרות אצלך בחשבון. אפשר לשנות אותן בכל רגע דרך "ברוך הבא לפורטל" בסרגל הצד.'
                        : 'הקורס נבנה סביב מצב העסק שלך, לא סביב ממוצע. כל תשובה גם מוסיפה לך תאוצה לפני השיעור הראשון.',
                '</p>',

                '<div class="onb-meter" aria-live="polite">',
                    '<span class="onb-meter__label">',
                        '<i class="fa-solid fa-bolt" aria-hidden="true"></i>',
                        'בונוס פתיחה שצברת',
                    '</span>',
                    '<span class="onb-meter__value" id="onbBonusValue">+', bonus.toFixed(2).replace(/0$/, ''), '%</span>',
                '</div>',

                (isSummary ? '' :
                    '<div class="onb-progress">' +
                        '<div class="onb-dots">' + renderProgressDots(state) + '</div>' +
                        '<span class="onb-progress__count">' + (stepIdx + 1) + ' מתוך ' + TOTAL_STEPS + '</span>' +
                    '</div>'),

                '<div class="onb-body" id="onbBody">',
                    isSummary ? renderSummary(state) : renderQuestion(state),
                '</div>',

                '<div class="onb-foot">',
                    isSummary
                        ? '<button type="button" class="onb-goal-confirm" id="onbFinish">קדימה, לשיעור הראשון</button>'
                        : (
                            '<div class="onb-foot__nav">' +
                                (stepIdx > 0
                                    ? '<button type="button" class="onb-nav-btn" id="onbBack">' +
                                        '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> אחורה</button>'
                                    : '') +
                            '</div>' +
                            '<button type="button" class="onb-foot__skip" id="onbSkip">דלג לעת עתה</button>'
                        ),
                '</div>',

                (isSummary || done === 0 ? '' :
                    '<p class="onb-foot__hint">התשובות נשמרות תוך כדי. אפשר לעצור באמצע ולחזור.</p>'),
            '</div>'
        ].join('');

        return root;
    }

    /* ------------------------------------------------------ interactions */

    function chooseOption(optId) {
        var q = QUESTIONS[stepIdx];
        var opt = null;
        for (var i = 0; i < q.options.length; i++) {
            if (q.options[i].id === optId) { opt = q.options[i]; break; }
        }
        if (!opt) return;

        var state = getState();
        state.answers[q.id] = { id: opt.id, label: opt.label };

        var isLast = (answeredCount(state) >= TOTAL_STEPS);
        if (isLast && !state.completedAt) state.completedAt = new Date().toISOString();
        saveState(state);

        // Fire-and-forget: never block the UI on the network. The outcome is
        // parked in lastPush so renderSummary can tell the truth about it, and
        // also patched in live if the summary is already on screen.
        pushToServer(state).then(function (r) {
            lastPush = r;
            var note = document.getElementById('onbSaveNote');
            if (!note) return;
            if (r && r.ok) note.textContent = 'התשובות נשמרו בחשבון שלך.';
            else if (r && r.deferred) note.textContent = 'התשובות שמורות במכשיר. ברגע שתתחבר הן יעלו לחשבון.';
            else note.textContent = 'התשובות שמורות במכשיר. השמירה בחשבון תנסה שוב בכניסה הבאה.';
        });

        // Refresh the visible course progress (hero / header / sidebar).
        try { if (typeof window.renderHero === 'function') window.renderHero(); } catch (e) {}

        // Advance: next unanswered question, or the summary.
        setTimeout(function () {
            var s = getState();
            if (answeredCount(s) >= TOTAL_STEPS) {
                lsSet(KEY_SEEN, 'true');
                buildModal(true);
                attachHandlers();
            } else {
                stepIdx = Math.min(QUESTIONS.length - 1, firstUnansweredIndex(s));
                buildModal(false);
                attachHandlers();
            }
            applyDisplayBonus();
        }, 220);
    }

    function attachHandlers() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;

        var closeBtn = root.querySelector('#onbClose');
        if (closeBtn) closeBtn.addEventListener('click', close);

        var skipBtn = root.querySelector('#onbSkip');
        if (skipBtn) skipBtn.addEventListener('click', close);

        var finishBtn = root.querySelector('#onbFinish');
        if (finishBtn) finishBtn.addEventListener('click', close);

        var backBtn = root.querySelector('#onbBack');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                stepIdx = Math.max(0, stepIdx - 1);
                buildModal(false);
                attachHandlers();
            });
        }

        var opts = root.querySelectorAll('[data-opt]');
        Array.prototype.forEach.call(opts, function (btn) {
            btn.addEventListener('click', function () {
                Array.prototype.forEach.call(opts, function (b) {
                    b.classList.toggle('is-selected', b === btn);
                    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
                });
                chooseOption(btn.getAttribute('data-opt'));
            });
        });

        root.addEventListener('keydown', onKeydown);
    }

    function onKeydown(ev) {
        if (ev.key === 'Escape') { close(); }
    }

    /* ------------------------------------------------------ open / close */

    function open() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;
        var state = getState();
        var complete = answeredCount(state) >= TOTAL_STEPS;
        stepIdx = complete ? 0 : firstUnansweredIndex(state);
        buildModal(complete);
        attachHandlers();
        root.hidden = false;
        document.body.style.overflow = 'hidden';
        setTimeout(function () {
            var c = root.querySelector('#onbClose');
            if (c) c.focus();
        }, 60);
    }

    function close() {
        var root = document.getElementById('onbOverlay');
        if (!root) return;
        lsSet(KEY_SEEN, 'true');
        root.hidden = true;
        root.removeEventListener('keydown', onKeydown);
        document.body.style.overflow = '';
    }

    /* --------------------------------- hero progress bonus (unchanged) */
    /**
     * Add the bonus % to the DISPLAYED lesson-progress numbers in:
     *   #heroProgressPct / #heroProgressFill, #headerProgressPct /
     *   #headerProgressFill, #sidePct / #sideFill.
     * Real lesson progress (bwc_completed) is NEVER touched. Display is
     * capped at 100 and a small chip explains the boost.
     */
    function applyDisplayBonus() {
        var bonus = getBonusPct();
        if (bonus <= 0) { removeBonusChip(); return; }

        var ids = [
            { pct: 'heroProgressPct',   fill: 'heroProgressFill'   },
            { pct: 'headerProgressPct', fill: 'headerProgressFill' },
            { pct: 'sidePct',           fill: 'sideFill'           }
        ];

        ids.forEach(function (pair) {
            var pctEl = document.getElementById(pair.pct);
            var fillEl = document.getElementById(pair.fill);
            if (!pctEl || !fillEl) return;

            var raw = (pctEl.textContent || '0').replace('%', '').trim();
            var basePct = parseFloat(raw);
            if (!isFinite(basePct)) basePct = 0;
            var boosted = Math.min(100, +(basePct + bonus).toFixed(1));

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
        var label = 'כולל ' + bonus.toFixed(2).replace(/0$/, '') + '% בונוס פתיחה';
        var existing = row.querySelector('.onb-bonus-tip');
        if (existing) {
            existing.setAttribute('title', label);
            existing.querySelector('.onb-bonus-tip__val').textContent = '+' + bonus.toFixed(2).replace(/0$/, '') + '%';
            return;
        }
        var chip = document.createElement('span');
        chip.className = 'onb-bonus-tip';
        chip.setAttribute('title', label);
        chip.setAttribute('aria-label', label);
        chip.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>'
            + '<span class="onb-bonus-tip__val">+' + bonus.toFixed(2).replace(/0$/, '') + '%</span>';
        var pctSpan = row.querySelector('.v1-hero__progress-pct');
        if (pctSpan && pctSpan.parentNode) pctSpan.parentNode.insertBefore(chip, pctSpan);
        else row.appendChild(chip);
    }

    function removeBonusChip() {
        var existing = document.querySelector('.v1-hero__progress-row .onb-bonus-tip');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function hookRenderHero() {
        var orig = window.renderHero;
        if (typeof orig !== 'function') return;
        if (orig.__onbWrapped) return;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            try { applyDisplayBonus(); } catch (e) {}
            return r;
        };
        wrapped.__onbWrapped = true;
        window.renderHero = wrapped;
    }

    /* ------------------------------------------------------------- boot */

    function boot() {
        hookRenderHero();
        applyDisplayBonus();

        // Learners who went through the OLD 3-step flow still get asked the
        // real questions once — that data is the whole point of this change.
        // Their earned bonus is preserved (saveState never lowers it).
        if (!hasBeenSeen() && answeredCount(getState()) < TOTAL_STEPS) {
            setTimeout(function () { open(); lsSet(KEY_SEEN, 'true'); }, 350);
        }

        // Reconcile with the server the moment a session exists (and again on
        // any later login from this tab).
        if (window.bwcAuth) {
            window.bwcAuth.ready().then(function () {
                if (currentUser()) reconcileOnLogin();
            });
            window.bwcAuth.onChange(function (user) {
                if (user) reconcileOnLogin();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* ------------------------------------------------------- public API */

    window.Onboarding = {
        getBonusPct: getBonusPct,
        applyDisplayBonus: applyDisplayBonus,
        getAnswers: function () { return getState().answers; },
        open: open,
        close: close,
        isLegacyUser: isLegacyUser,
        reset: function () {
            lsDel(KEY_DATA);
            lsDel(KEY_SEEN);
            lsDel(KEY_BONUS);
            lsDel(LEGACY_SEEN);
            lsDel(LEGACY_DONE);
            lsDel('bwc_onboarding_steps');
            removeBonusChip();
        }
    };
})();
