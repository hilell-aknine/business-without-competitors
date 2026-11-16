/* ==========================================================================
   game.js — practice game engine for "עסק ללא מתחרים" (pages/game.html).

   Reads window.GAME_MODULES (built by js/game-data.js) and runs the whole
   loop: map, reading screen, seven exercise types, feedback, XP, levels,
   hearts, streak, achievements, stats.

   Storage
     localStorage  bwc_game_v1          the save (written at once, always)
     Supabase      public.game_players  cross-device copy for signed-in
                                        learners (migration 013)
   Guests play fully on localStorage. The cloud is never written before a
   successful pull + merge in this page session, so an empty device cannot
   overwrite a row that already holds progress. If the table does not exist
   the engine goes local-only without telling the learner anything.

   No AI and no network calls other than Supabase.
   ========================================================================== */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    const HEART_RECOVERY_MINUTES = 20;
    const MAX_HEARTS = 5;
    const SAVE_KEY = 'bwc_game_v1';
    const FIXTURE_SAVE_KEY = 'bwc_game_v1_fixture';
    const PRACTICE_KEY = 'bwc_practice_v1';       // read-only: one-time seed + league week
    const SOUND_KEY = 'bwc_game_sound';
    const TIP_KEY = 'bwc_game_first_tip';
    const CLOUD_TABLE = 'game_players';
    const CLOUD_MISSING_KEY = 'bwc_game_cloud_missing';
    const ASSET = '../assets/game/';
    const XP_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
    const LEVEL_NAMES = ['מתחילים', 'לומדים', 'מתרגלים', 'מיישמים', 'מובילים', 'חדשנים', 'משפיעים', 'אטומיים'];
    const LETTERS = ['א', 'ב', 'ג', 'ד'];
    const MATCH_CHANNELS = ['--brand2-rgb', '--brand-rgb', '--accent-rgb', '--brand2-hi-rgb', '--brand-hi-rgb'];

    const EXERCISE_META = {
        'multiple-choice': { label: 'שאלת בחירה', icon: 'fa-list-check', tip: 'קראו את כל האפשרויות לפני שבוחרים.' },
        'scenario':        { label: 'תרחיש', icon: 'fa-people-arrows', tip: 'דמיינו את המצב אצלכם בעסק. מה הייתם עושים?' },
        'improve':         { label: 'שפרו את הניסוח', icon: 'fa-wand-magic-sparkles', tip: 'חפשו את הניסוח המדויק והספציפי ביותר.' },
        'fill-blank':      { label: 'השלמת משפט', icon: 'fa-pen', tip: 'בחרו את המילה שמשלימה את המשפט בצורה הטבעית ביותר.' },
        'compare':         { label: 'מה חזק יותר?', icon: 'fa-scale-balanced', tip: 'השוו בין השניים. מה היה משכנע אתכם יותר כלקוחות?' },
        'order':           { label: 'סידור לפי סדר', icon: 'fa-arrow-down-1-9', tip: 'סדרו לפי ההיגיון. מה בא קודם ומה אחר כך?' },
        'match':           { label: 'התאמה', icon: 'fa-link', tip: 'חפשו את הקשר בין שתי הקבוצות. טעיתם? הקישו על זוג כדי לשחרר אותו.' }
    };

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icon(name, extra) {
        return `<i class="fa-solid ${name}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
    }

    function byId(id) { return document.getElementById(id); }

    function readJSON(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    // ═══════════════════════════════════════
    // Sound Manager (Web Audio API)
    // ═══════════════════════════════════════
    class SoundManager {
        constructor() {
            let stored = null;
            try { stored = localStorage.getItem(SOUND_KEY); } catch (e) { /* storage blocked */ }
            this.enabled = stored !== 'off';
            this.ctx = null;
        }

        getContext() {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            return this.ctx;
        }

        play(type) {
            if (!this.enabled) return;
            try {
                const ctx = this.getContext();
                if (ctx.state === 'suspended') ctx.resume();
                switch (type) {
                    case 'correct': this._playCorrect(ctx); break;
                    case 'wrong': this._playWrong(ctx); break;
                    case 'levelUp': this._playLevelUp(ctx); break;
                    case 'achievement': this._playAchievement(ctx); break;
                    case 'click': this._playClick(ctx); break;
                }
            } catch (e) { /* audio not supported */ }
        }

        _playTone(ctx, freq, duration, type = 'sine', gain = 0.3) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            g.gain.value = gain;
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        }

        _playCorrect(ctx) {
            this._playTone(ctx, 523, 0.15, 'sine', 0.2);
            setTimeout(() => this._playTone(ctx, 659, 0.15, 'sine', 0.2), 100);
            setTimeout(() => this._playTone(ctx, 784, 0.2, 'sine', 0.25), 200);
        }

        _playWrong(ctx) {
            this._playTone(ctx, 200, 0.3, 'triangle', 0.2);
        }

        _playLevelUp(ctx) {
            [523, 587, 659, 784, 880].forEach((f, i) => {
                setTimeout(() => this._playTone(ctx, f, 0.2, 'sine', 0.2), i * 100);
            });
        }

        _playAchievement(ctx) {
            [784, 988, 1175].forEach((f, i) => {
                setTimeout(() => this._playTone(ctx, f, 0.25, 'sine', 0.15), i * 150);
            });
        }

        _playClick(ctx) {
            this._playTone(ctx, 600, 0.05, 'sine', 0.1);
        }

        toggle() {
            this.enabled = !this.enabled;
            try { localStorage.setItem(SOUND_KEY, this.enabled ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
            return this.enabled;
        }
    }

    // ═══════════════════════════════════════
    // Game engine
    // ═══════════════════════════════════════
    class BwcGame {
        constructor() {
            this.modules = [];
            this.lessonIndex = {};          // lessonKey -> { module, lesson }
            this.isFixture = false;
            this.isEmbed = document.documentElement.classList.contains('bwc-embed');

            this.currentScreen = 'home';
            this.currentModule = null;
            this.currentLesson = null;
            this.currentExerciseIndex = 0;
            this.selectedAnswer = null;
            this.exerciseAnswered = false;
            this.lessonMistakes = 0;
            this.lessonXP = 0;
            this.inLesson = false;
            this.onboardingStep = 0;
            this.heartTimerInterval = null;

            // Combo & speed
            this.comboCount = 0;
            this.maxCombo = 0;
            this.exerciseStartTime = null;
            this.secondChanceUsed = false;

            this.sound = new SoundManager();
            this.user = null;
            this.isGuest = true;
            this.missingArt = new Set();

            // Cloud sync state. `ready` flips to true only after a successful
            // pull + merge for the current user in this page session.
            this.cloud = { ready: false, disabled: false, pulling: false, timer: null, lastPullTry: 0, profileEnsured: false };

            this.playerData = this.getDefaultPlayerData();

            this.achievements = [
                { id: 'first_lesson', title: 'צעד ראשון', desc: 'השלמתם שיעור ראשון', icon: 'fa-shoe-prints', target: 1, unit: 'שיעורים', value: (d) => this.completedCount(d), condition: (d) => this.completedCount(d) >= 1 },
                { id: 'five_lessons', title: 'נכנסים לקצב', desc: 'השלמתם 5 שיעורים', icon: 'fa-book', target: 5, unit: 'שיעורים', value: (d) => this.completedCount(d), condition: (d) => this.completedCount(d) >= 5 },
                { id: 'ten_lessons', title: 'בדרך הנכונה', desc: 'השלמתם 10 שיעורים', icon: 'fa-book-open', target: 10, unit: 'שיעורים', value: (d) => this.completedCount(d), condition: (d) => this.completedCount(d) >= 10 },
                { id: 'twenty_lessons', title: 'לומדים ברצינות', desc: 'השלמתם 20 שיעורים', icon: 'fa-graduation-cap', target: 20, unit: 'שיעורים', value: (d) => this.completedCount(d), condition: (d) => this.completedCount(d) >= 20 },
                { id: 'module_done', title: 'מודול שלם', desc: 'השלמתם מודול שלם', icon: 'fa-flag-checkered', target: 1, unit: 'מודולים', value: () => this.completedModulesCount(), condition: () => this.completedModulesCount() >= 1 },
                { id: 'streak_3', title: 'התמדה', desc: '3 ימים ברצף', icon: 'fa-fire', target: 3, unit: 'ימים', value: (d) => d.streak || 0, condition: (d) => (d.streak || 0) >= 3 },
                { id: 'perfect_lesson', title: 'שיעור מושלם', desc: 'שיעור שלם בלי אף טעות', icon: 'fa-star', target: 1, unit: 'שיעורים מושלמים', value: (d) => d.perfectLessons || 0, condition: (d) => (d.perfectLessons || 0) >= 1 },
                { id: 'xp_500', title: 'צוברים ניסיון', desc: 'צברתם 500 XP', icon: 'fa-medal', target: 500, unit: 'XP', value: (d) => d.xp || 0, condition: (d) => (d.xp || 0) >= 500 },
                { id: 'streak_7', title: 'שבוע מלא', desc: '7 ימים ברצף', icon: 'fa-calendar-week', target: 7, unit: 'ימים', value: (d) => d.streak || 0, condition: (d) => (d.streak || 0) >= 7 },
                { id: 'streak_30', title: 'מחויבות', desc: '30 ימים ברצף', icon: 'fa-gem', target: 30, unit: 'ימים', value: (d) => d.streak || 0, condition: (d) => (d.streak || 0) >= 30 },
                { id: 'xp_1000', title: 'אלף ראשון', desc: 'צברתם 1000 XP', icon: 'fa-trophy', target: 1000, unit: 'XP', value: (d) => d.xp || 0, condition: (d) => (d.xp || 0) >= 1000 },
                { id: 'accuracy_80', title: 'דיוק גבוה', desc: 'דיוק של 80% ומעלה אחרי 20 תשובות', icon: 'fa-bullseye', target: 80, unit: '%', value: (d) => this.accuracyPct(d), condition: (d) => this.answersCount(d) >= 20 && this.accuracyPct(d) >= 80 },
                // Only awarded once every module of the course has its data file,
                // so finishing module 1 while 2-8 are unwritten is not "the whole course".
                { id: 'all_lessons', title: 'עסק ללא מתחרים', desc: 'השלמתם את כל השיעורים', icon: 'fa-crown', target: 0, unit: 'שיעורים', value: (d) => this.completedCount(d), condition: (d) => this.courseIsComplete() && this.totalLessons() > 0 && this.completedInData(d) >= this.totalLessons() }
            ];

            this.initRipple();
            this.initSwipeDismiss();
            this.initKeyboardDismiss();
            this.initBeforeUnload();
        }

        // ═══════════════════════════════════════
        // Boot
        // ═══════════════════════════════════════
        async boot() {
            const loading = byId('loading-screen');
            if (loading) loading.style.display = 'flex';

            try {
                if (window.GAME_DATA_READY && typeof window.GAME_DATA_READY.then === 'function') {
                    await window.GAME_DATA_READY;
                }
            } catch (e) {
                console.error('[game] course data load failed', e);
            }
            this.modules = Array.isArray(window.GAME_MODULES) ? window.GAME_MODULES : [];
            this.isFixture = !!window.GAME_DATA_IS_FIXTURE;

            // Fail-safe: a syntax error in a data file leaves the list empty. Say so
            // instead of letting every render call crash on missing data.
            if (!this.validateModules()) {
                if (loading) {
                    loading.style.display = 'flex';
                    loading.innerHTML = '<div class="load-failed">'
                        + icon('fa-triangle-exclamation', 'load-failed-icon')
                        + '<p class="load-failed-title">התוכן לא נטען כמו שצריך.</p>'
                        + '<p class="load-failed-text">נסו לרענן את הדף. אם זה חוזר, כתבו לנו.</p>'
                        + '<button class="btn btn-primary" onclick="window.location.reload()">רענון</button></div>';
                }
                return;
            }

            this.modules.forEach(mod => mod.lessons.forEach(lesson => {
                this.lessonIndex[this.lk(mod, lesson)] = { module: mod, lesson };
            }));

            this.playerData = this.loadLocal();

            if (loading) loading.style.display = 'none';
            byId('app-header').style.display = 'block';
            byId('main-content').style.display = 'block';
            byId('progress-wrapper').style.display = 'block';

            // The bar ships with an inline display:none so it stays hidden before
            // boot. An inline style beats a class rule, so remove it first.
            const navEl = byId('bottom-nav');
            navEl.style.removeProperty('display');
            navEl.classList.add('nav-visible');

            this.updateSoundToggle();

            try {
                this.playerData.level = this.calculateLevel();
                this.recomputeStreak();   // derived from real answers, never bumped on open
                this.recoverHearts();
                this.updateStatsDisplay();
                this.startHeartTimer();
            } catch (e) { console.error('[game] init warning', e); }

            // A deep link from a lesson page opens that lesson and skips the intro.
            if (!this.tryDeepLink()) {
                if (!this.playerData.onboardingComplete) this.showOnboarding();
                this.renderHomeScreen();
            }

            this.initCloud();
        }

        // Returns false when there is no usable data. Individual bad rows are
        // logged and do not stop the game.
        validateModules() {
            if (!Array.isArray(this.modules) || this.modules.length === 0) {
                console.error('[game] GAME_MODULES is missing or empty. A course data file likely failed to load.');
                return false;
            }
            try {
                this.modules = this.modules.filter((mod, mi) => {
                    if (!mod || !Array.isArray(mod.lessons) || mod.lessons.length === 0) {
                        console.error(`[game] module #${mi} (${mod && mod.id}) has no lessons array and was skipped.`);
                        return false;
                    }
                    mod.lessons.forEach((lesson, li) => {
                        if (!lesson || !Array.isArray(lesson.exercises)) {
                            console.error(`[game] module ${mod.id} / lesson #${li} has no exercises array.`);
                            return;
                        }
                        lesson.exercises.forEach((ex, ei) => {
                            if (!ex || !EXERCISE_META[ex.type]) {
                                console.error(`[game] module ${mod.id} / lesson #${li} / exercise #${ei}: unknown type ${ex && ex.type}.`);
                            }
                        });
                    });
                    return true;
                });
            } catch (e) {
                console.error('[game] validateModules scan error', e);
            }
            return this.modules.length > 0;
        }

        // game.html?lesson=<lessonKey> opens that lesson's reading screen, even if
        // the path has not unlocked it yet: the learner came straight from watching
        // that lesson. Returns true if it navigated.
        tryDeepLink() {
            try {
                const key = new URLSearchParams(window.location.search).get('lesson');
                if (!key) return false;
                const hit = this.lessonIndex[key];
                if (!hit) {
                    console.warn('[game] deep link: no practice for lesson', key);
                    return false;
                }
                this.openModule(hit.module.id);
                this.startLesson(hit.lesson.id);
                return true;
            } catch (e) {
                console.error('[game] deep link failed', e);
                return false;
            }
        }

        // ═══════════════════════════════════════
        // Global listeners
        // ═══════════════════════════════════════
        initBeforeUnload() {
            window.addEventListener('beforeunload', () => {
                // localStorage is already current. Fire the pending cloud save now so
                // a quick tab close does not lose it. Best effort.
                if (this.cloud.timer) {
                    clearTimeout(this.cloud.timer);
                    this.cloud.timer = null;
                    this.saveToCloud();
                }
            });
        }

        showToast(message, duration) {
            try {
                const toast = byId('toast');
                if (!toast) return;
                toast.textContent = message;
                toast.classList.add('show');
                clearTimeout(this._toastTimer);
                this._toastTimer = setTimeout(() => toast.classList.remove('show'), duration || 4000);
            } catch (e) {
                console.error('[game] showToast failed', e, message);
            }
        }

        // A failure the learner must see. Never a silent no-op: it is logged too.
        showError(message, err) {
            console.error('[game]', message, err || '');
            this.showToast(message, 5000);
        }

        showLockedHint(type, id) {
            // A locked node must explain itself, otherwise "locked" reads as "broken".
            let message;
            if (type === 'module') {
                const idx = this.modules.findIndex(m => m.id === id);
                const mod = idx >= 0 ? this.modules[idx] : null;
                const prev = idx > 0 ? this.modules[idx - 1] : null;
                message = prev
                    ? `כדי לפתוח את "${mod ? mod.title : 'המודול הזה'}" סיימו קודם את "${prev.title}".`
                    : 'המודול הזה עדיין נעול.';
            } else {
                message = 'כדי לפתוח את השיעור הזה סיימו קודם את השיעור שלפניו.';
            }
            this.showToast(message);
        }

        initRipple() {
            document.addEventListener('click', (e) => {
                const target = e.target.closest && e.target.closest('.btn, .option-btn, .word-chip, .compare-card, .path-node:not(.locked), .home-path-node:not(.locked):not(.goal), .resume-cta');
                if (!target) return;
                const ripple = document.createElement('span');
                ripple.className = 'ripple-effect';
                const rect = target.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
                ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
                target.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });
        }

        initSwipeDismiss() {
            const el = byId('feedback-panel');
            if (!el) return;
            let startY = 0;
            let startedAtTop = true;
            el.addEventListener('touchstart', (e) => {
                startY = e.touches[0].clientY;
                // A long explanation scrolls inside the sheet. Only a swipe that
                // starts at the top counts as "dismiss".
                startedAtTop = el.scrollTop <= 0;
            }, { passive: true });
            el.addEventListener('touchend', (e) => {
                const dy = e.changedTouches[0].clientY - startY;
                if (dy > 80 && startedAtTop && el.classList.contains('show')) this.continueToNext();
            }, { passive: true });
        }

        initKeyboardDismiss() {
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                const modal = byId('modal-overlay');
                const feedback = byId('feedback-panel');
                if (modal && modal.classList.contains('show')) {
                    // ESC dismisses. It is never a silent "yes, quit".
                    if (this._reinforceContinue) {
                        this.dismissReinforcement();
                    } else {
                        this.closeModalAndStay();
                    }
                } else if (feedback && feedback.classList.contains('show')) {
                    this.continueToNext();
                }
            });
        }

        // ═══════════════════════════════════════
        // Artwork (generated later; every image degrades to an icon)
        // ═══════════════════════════════════════
        art(path, cls, fallbackIcon) {
            if (this.missingArt.has(path)) {
                return fallbackIcon ? icon(fallbackIcon, 'art-fallback ' + cls + '-fallback') : '';
            }
            return `<img class="${cls}" src="${ASSET}${path}" alt="" aria-hidden="true" decoding="async"`
                + ` data-art="${path}" data-fb="${fallbackIcon || ''}" data-fb-class="${cls}-fallback" onerror="game.imgFallback(this)">`;
        }

        imgFallback(img) {
            try {
                if (img.dataset.art) this.missingArt.add(img.dataset.art);
                const fb = img.dataset.fb;
                if (!fb) { img.remove(); return; }
                const i = document.createElement('i');
                i.className = 'fa-solid ' + fb + ' art-fallback ' + (img.dataset.fbClass || '');
                i.setAttribute('aria-hidden', 'true');
                img.replaceWith(i);
            } catch (e) {
                console.error('[game] imgFallback failed', e);
            }
        }

        // ═══════════════════════════════════════
        // Data helpers
        // ═══════════════════════════════════════
        lk(mod, lesson) {
            return lesson.lessonKey || `g${mod.id}-${lesson.id}`;
        }

        isLessonDone(mod, lesson) {
            return !!this.playerData.completedLessons[this.lk(mod, lesson)];
        }

        totalLessons() {
            return this.modules.reduce((n, m) => n + m.lessons.length, 0);
        }

        totalExercises() {
            return this.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + (l.exercises ? l.exercises.length : 0), 0), 0);
        }

        // Completed lessons, all of them (also lessons whose data is not loaded).
        completedCount(d) {
            return Object.keys((d || this.playerData).completedLessons || {}).length;
        }

        // Completed lessons that exist in the data currently loaded.
        completedInData(d) {
            const done = (d || this.playerData).completedLessons || {};
            return Object.keys(this.lessonIndex).filter(k => done[k]).length;
        }

        completedModulesCount() {
            return this.modules.filter(m => this.getModuleProgress(m.id) >= 100).length;
        }

        courseIsComplete() {
            const total = window.GAME_TOTAL_MODULES || 0;
            return !this.isFixture && total > 0 && this.modules.length >= total;
        }

        answersCount(d) {
            return (d.totalCorrectAnswers || 0) + (d.totalWrongAnswers || 0);
        }

        accuracyPct(d) {
            const total = this.answersCount(d);
            return total > 0 ? Math.round(((d.totalCorrectAnswers || 0) / total) * 100) : 0;
        }

        // ═══════════════════════════════════════
        // Persistence: localStorage
        // ═══════════════════════════════════════
        getDefaultPlayerData() {
            return {
                xp: 0,
                level: 1,
                hearts: MAX_HEARTS,
                maxHearts: MAX_HEARTS,
                streak: 0,
                lastPlayDate: null,
                lastHeartLost: null,
                completedLessons: {},
                achievements: [],
                totalCorrectAnswers: 0,
                totalWrongAnswers: 0,
                perfectLessons: 0,
                perfectLessonsList: [],
                onboardingComplete: false,
                longestStreak: 0,
                weeklyActivity: {},
                moduleAccuracy: {},
                // Local-only fields (not columns of game_players):
                streakBase: null,     // { count, lastDate } carried from before the ledger
                weekly: null,         // game XP of the current league week
                ownerId: null,        // user id this save was merged with, null for a guest
                // Exercises answered wrong at least once, { lessonKey: [exerciseIndex] }.
                // Read by the sandbox (js/sandbox.js) to start from the learner's
                // own gaps. Local only, added 2026-11-16.
                missed: {},
                savedAt: null
            };
        }

        saveKey() {
            return this.isFixture ? FIXTURE_SAVE_KEY : SAVE_KEY;
        }

        normalize(data) {
            const d = Object.assign(this.getDefaultPlayerData(), data || {});
            d.xp = Math.max(0, Number(d.xp) || 0);
            d.maxHearts = MAX_HEARTS;
            d.hearts = Number.isFinite(d.hearts) ? Math.max(0, Math.min(MAX_HEARTS, d.hearts)) : MAX_HEARTS;
            if (!d.completedLessons || typeof d.completedLessons !== 'object' || Array.isArray(d.completedLessons)) d.completedLessons = {};
            if (!Array.isArray(d.achievements)) d.achievements = [];
            if (!Array.isArray(d.perfectLessonsList)) d.perfectLessonsList = [];
            if (!d.weeklyActivity || typeof d.weeklyActivity !== 'object') d.weeklyActivity = {};
            if (!d.moduleAccuracy || typeof d.moduleAccuracy !== 'object') d.moduleAccuracy = {};
            if (!d.missed || typeof d.missed !== 'object' || Array.isArray(d.missed)) d.missed = {};
            return d;
        }

        loadLocal() {
            let raw = null;
            try { raw = localStorage.getItem(this.saveKey()); } catch (e) { /* storage blocked */ }
            if (raw) {
                try { return this.normalize(JSON.parse(raw)); }
                catch (e) { console.error('[game] saved data is corrupt, starting fresh', e); }
                return this.getDefaultPlayerData();
            }

            const data = this.getDefaultPlayerData();
            if (this.isFixture) return data;

            // One-time seed. A learner who already practised in the old game keeps
            // the XP and the streak. bwc_practice_v1 is only ever read here.
            const old = readJSON(PRACTICE_KEY);
            if (old && typeof old === 'object') {
                const xp = Math.max(0, Math.round(Number(old.xp) || 0));
                const streak = Math.max(0, Math.round(Number(old.streak) || 0));
                if (xp > 0) data.xp = xp;
                if (streak > 0 && typeof old.lastDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(old.lastDate)) {
                    data.streakBase = { count: streak, lastDate: old.lastDate };
                    data.lastPlayDate = old.lastDate;
                    data.longestStreak = streak;
                }
                data.seededFromPractice = xp > 0 || streak > 0;
            }
            // Writing the key now is what makes the seed one-time.
            try { localStorage.setItem(this.saveKey(), JSON.stringify(data)); } catch (e) { /* storage blocked */ }
            return data;
        }

        saveLocal() {
            this.playerData.savedAt = new Date().toISOString();
            try {
                localStorage.setItem(this.saveKey(), JSON.stringify(this.playerData));
            } catch (e) {
                console.error('[game] could not write the save to localStorage', e);
            }
        }

        savePlayerData() {
            this.saveLocal();           // local at once
            this.queueCloudSave();      // cloud debounced, only after a merge
        }

        // ═══════════════════════════════════════
        // Persistence: Supabase (signed-in learners only)
        // ═══════════════════════════════════════
        initCloud() {
            if (this.isFixture) return;     // test data never leaves the device
            try {
                if (sessionStorage.getItem(CLOUD_MISSING_KEY)) this.cloud.disabled = true;
            } catch (e) { /* storage blocked */ }
            const auth = window.bwcAuth;
            if (!auth || typeof auth.onChange !== 'function') return;   // Supabase did not load: guest mode
            try {
                auth.onChange((user) => this.onAuthChange(user));
            } catch (e) {
                console.warn('[game] auth listener failed, staying in guest mode', e);
            }
        }

        onAuthChange(user) {
            const prevId = this.user ? this.user.id : null;
            const nextId = user ? user.id : null;
            if (prevId === nextId) return;      // token refresh
            this.user = user || null;
            this.isGuest = !user;
            this.cloud.ready = false;
            this.cloud.profileEnsured = false;
            if (this.cloud.timer) { clearTimeout(this.cloud.timer); this.cloud.timer = null; }
            if (user) this.pullAndMerge();
            if (this.currentScreen === 'profile') this.renderProfileScreen();
        }

        isMissingTable(error) {
            if (!error) return false;
            const code = String(error.code || '');
            const msg = String(error.message || '') + ' ' + String(error.hint || '') + ' ' + String(error.details || '');
            return code === '42P01' || code === 'PGRST205' || code === 'PGRST204'
                || /does not exist|schema cache|not find the table|could not find/i.test(msg);
        }

        disableCloud(reason) {
            this.cloud.disabled = true;
            this.cloud.ready = false;
            if (this.cloud.timer) { clearTimeout(this.cloud.timer); this.cloud.timer = null; }
            try { sessionStorage.setItem(CLOUD_MISSING_KEY, '1'); } catch (e) { /* storage blocked */ }
            console.info('[game] cloud save is off for this session (' + reason + '). Playing on local storage.');
        }

        async pullAndMerge() {
            const sb = window.bwcSupabase;
            const user = this.user;
            if (!sb || !user || this.cloud.disabled || this.cloud.pulling || this.isFixture) return;
            this.cloud.pulling = true;
            this.cloud.lastPullTry = Date.now();
            try {
                const query = sb.from(CLOUD_TABLE).select('*').eq('user_id', user.id).maybeSingle();
                // A hung request must not block anything: local play continues and
                // the pull is retried on a later save.
                const { data, error } = await Promise.race([
                    query,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('cloud load timeout')), 6000))
                ]);
                if (error) throw error;
                if (!this.user || this.user.id !== user.id) return;     // signed out meanwhile

                const hadRemote = !!data;
                const before = JSON.stringify(this.cloudRow());
                this.mergeRemote(data, user.id);
                this.cloud.ready = true;        // from here on this device may push

                this.playerData.level = this.calculateLevel();
                this.recomputeStreak({ silent: true });
                this.saveLocal();
                this.afterMergeRefresh();

                const after = JSON.stringify(this.cloudRow());
                const pristine = !hadRemote && this.isPristine();
                if (!pristine && (!hadRemote || after !== before || this.remoteDiffers(data))) this.queueCloudSave();
            } catch (e) {
                if (this.isMissingTable(e)) this.disableCloud('table not found');
                else console.warn('[game] cloud load failed, staying on local storage for now', e && (e.message || e));
            } finally {
                this.cloud.pulling = false;
            }
        }

        isPristine() {
            const d = this.playerData;
            return !d.xp && this.completedCount(d) === 0 && this.answersCount(d) === 0;
        }

        remoteDiffers(remote) {
            if (!remote) return true;
            const d = this.playerData;
            return (remote.xp || 0) !== d.xp
                || Object.keys(remote.completed_lessons || {}).length !== this.completedCount(d)
                || (remote.achievements || []).length !== d.achievements.length
                || (remote.total_correct || 0) !== d.totalCorrectAnswers
                || (remote.total_wrong || 0) !== d.totalWrongAnswers;
        }

        fromRow(row) {
            return {
                xp: row.xp || 0,
                // Number.isFinite so a legitimate 0 stays 0.
                hearts: Number.isFinite(row.hearts) ? row.hearts : MAX_HEARTS,
                streak: row.streak || 0,
                longestStreak: row.longest_streak || 0,
                totalCorrectAnswers: row.total_correct || 0,
                totalWrongAnswers: row.total_wrong || 0,
                completedLessons: (row.completed_lessons && typeof row.completed_lessons === 'object' && !Array.isArray(row.completed_lessons)) ? row.completed_lessons : {},
                achievements: Array.isArray(row.achievements) ? row.achievements : [],
                perfectLessons: row.perfect_lessons || 0,
                perfectLessonsList: Array.isArray(row.perfect_lessons_list) ? row.perfect_lessons_list : [],
                weeklyActivity: (row.weekly_activity && typeof row.weekly_activity === 'object') ? row.weekly_activity : {},
                moduleAccuracy: (row.module_accuracy && typeof row.module_accuracy === 'object') ? row.module_accuracy : {},
                lastPlayDate: row.last_play_date || null,
                lastHeartLost: row.last_heart_lost || null,
                updatedAt: row.updated_at || null
            };
        }

        // Merge rule: max xp, union of completed lessons and achievements, the
        // newer last_play_date wins for the streak. Nothing is ever lost.
        mergeRemote(row, userId) {
            let local = this.playerData;
            // A save that belongs to another account is not merged into this one.
            if (local.ownerId && local.ownerId !== userId) {
                const fresh = this.getDefaultPlayerData();
                fresh.onboardingComplete = local.onboardingComplete;
                local = fresh;
            }
            if (row) {
                const r = this.fromRow(row);
                const m = local;

                m.xp = Math.max(m.xp || 0, r.xp);
                m.totalCorrectAnswers = Math.max(m.totalCorrectAnswers || 0, r.totalCorrectAnswers);
                m.totalWrongAnswers = Math.max(m.totalWrongAnswers || 0, r.totalWrongAnswers);
                m.longestStreak = Math.max(m.longestStreak || 0, r.longestStreak);

                m.completedLessons = Object.assign({}, r.completedLessons, m.completedLessons);
                m.achievements = Array.from(new Set([...(m.achievements || []), ...r.achievements]));
                m.perfectLessonsList = Array.from(new Set([...(m.perfectLessonsList || []), ...r.perfectLessonsList]));
                m.perfectLessons = Math.max(m.perfectLessons || 0, r.perfectLessons, m.perfectLessonsList.length);

                const days = Object.assign({}, m.weeklyActivity);
                Object.keys(r.weeklyActivity).forEach(k => { days[k] = Math.max(days[k] || 0, Number(r.weeklyActivity[k]) || 0); });
                m.weeklyActivity = days;

                const acc = Object.assign({}, m.moduleAccuracy);
                Object.keys(r.moduleAccuracy).forEach(k => {
                    const a = acc[k], b = r.moduleAccuracy[k];
                    if (b && (!a || (b.total || 0) > (a.total || 0))) acc[k] = b;
                });
                m.moduleAccuracy = acc;

                // Streak: the side that played more recently wins.
                if (r.lastPlayDate && (!m.lastPlayDate || r.lastPlayDate > m.lastPlayDate)) {
                    m.streak = r.streak;
                    m.lastPlayDate = r.lastPlayDate;
                    m.streakBase = r.streak > 0 ? { count: r.streak, lastDate: r.lastPlayDate } : m.streakBase;
                } else if (r.lastPlayDate && r.lastPlayDate === m.lastPlayDate && r.streak > (m.streak || 0)) {
                    m.streak = r.streak;
                    m.streakBase = { count: r.streak, lastDate: r.lastPlayDate };
                }

                // Hearts: the more recent save wins.
                const localTime = m.savedAt ? Date.parse(m.savedAt) : 0;
                const remoteTime = r.updatedAt ? Date.parse(r.updatedAt) : 0;
                if (remoteTime > localTime) {
                    m.hearts = Math.max(0, Math.min(MAX_HEARTS, r.hearts));
                    m.lastHeartLost = r.lastHeartLost;
                }
                m.onboardingComplete = true;    // they have played before
                local = m;
            }
            local.ownerId = userId;
            this.playerData = this.normalize(local);
        }

        afterMergeRefresh() {
            try {
                this.recoverHearts();
                this.updateStatsDisplay();
                if (this.inLesson) return;      // never redraw under a learner mid-lesson
                if (this.currentScreen === 'home') {
                    const ob = byId('onboarding-overlay');
                    if (ob && this.playerData.onboardingComplete) ob.style.display = 'none';
                    this.renderHomeScreen();
                } else if (this.currentScreen === 'stats') this.renderStatsScreen();
                else if (this.currentScreen === 'profile') this.renderProfileScreen();
                else if (this.currentScreen === 'module' && this.currentModule) this.openModule(this.currentModule.id);
            } catch (e) {
                console.error('[game] refresh after cloud merge failed', e);
            }
        }

        cloudRow() {
            const d = this.playerData;
            return {
                xp: d.xp || 0,
                level: d.level || 1,
                hearts: d.hearts,
                max_hearts: d.maxHearts || MAX_HEARTS,
                streak: d.streak || 0,
                longest_streak: d.longestStreak || 0,
                total_correct: d.totalCorrectAnswers || 0,
                total_wrong: d.totalWrongAnswers || 0,
                completed_lessons: d.completedLessons || {},
                achievements: d.achievements || [],
                perfect_lessons: d.perfectLessons || 0,
                perfect_lessons_list: d.perfectLessonsList || [],
                weekly_activity: d.weeklyActivity || {},
                module_accuracy: d.moduleAccuracy || {},
                last_play_date: d.lastPlayDate || null,
                last_heart_lost: d.lastHeartLost || null
            };
        }

        queueCloudSave() {
            if (!this.user || this.cloud.disabled || this.isFixture) return;
            if (!this.cloud.ready) {
                // Not merged yet (the pull failed or is still running). Pushing now
                // could overwrite the server, so retry the pull instead.
                if (!this.cloud.pulling && Date.now() - this.cloud.lastPullTry > 30000) this.pullAndMerge();
                return;
            }
            clearTimeout(this.cloud.timer);
            this.cloud.timer = setTimeout(() => {
                this.cloud.timer = null;
                this.saveToCloud();
            }, 1500);
        }

        async saveToCloud() {
            const sb = window.bwcSupabase;
            const user = this.user;
            if (!sb || !user || !this.cloud.ready || this.cloud.disabled || this.isFixture) return;

            const attempt = async () => {
                const row = Object.assign({ user_id: user.id }, this.cloudRow(), { updated_at: new Date().toISOString() });
                const { error } = await sb.from(CLOUD_TABLE).upsert(row, { onConflict: 'user_id' });
                if (error) throw error;
            };
            // game_players references profiles(id). An account without a profiles
            // row (OAuth, legacy) fails with FK 23503. ensure_profile() heals it.
            const ensureProfile = async () => {
                if (this.cloud.profileEnsured) return;
                this.cloud.profileEnsured = true;
                try { await sb.rpc('ensure_profile'); } catch (e) { /* optional helper */ }
            };

            try {
                await attempt();
            } catch (e1) {
                if (this.isMissingTable(e1)) { this.disableCloud('table not found'); return; }
                if (String(e1 && e1.code) === '23503') await ensureProfile();
                else await new Promise(r => setTimeout(r, 2000));
                try {
                    await attempt();
                } catch (e2) {
                    if (this.isMissingTable(e2)) { this.disableCloud('table not found'); return; }
                    // localStorage holds the latest state. This only delays the
                    // cross-device copy until the next save.
                    console.warn('[game] cloud save failed', e2 && (e2.code || ''), e2 && (e2.message || e2));
                }
            }
        }

        // ═══════════════════════════════════════
        // Hearts
        // ═══════════════════════════════════════
        recoverHearts() {
            if (this.playerData.hearts >= this.playerData.maxHearts) {
                this.playerData.lastHeartLost = null;
                return;
            }
            if (!this.playerData.lastHeartLost) return;

            const lostTime = new Date(this.playerData.lastHeartLost).getTime();
            const elapsed = Date.now() - lostTime;
            const recovered = Math.floor(elapsed / (HEART_RECOVERY_MINUTES * 60 * 1000));

            if (recovered > 0) {
                this.playerData.hearts = Math.min(this.playerData.maxHearts, this.playerData.hearts + recovered);
                if (this.playerData.hearts >= this.playerData.maxHearts) {
                    this.playerData.lastHeartLost = null;
                } else {
                    const newTime = lostTime + recovered * HEART_RECOVERY_MINUTES * 60 * 1000;
                    this.playerData.lastHeartLost = new Date(newTime).toISOString();
                }
                this.savePlayerData();
            }
        }

        startHeartTimer() {
            if (this.heartTimerInterval) clearInterval(this.heartTimerInterval);
            this.heartTimerInterval = setInterval(() => this.updateHeartTimer(), 1000);
            this.updateHeartTimer();
        }

        updateHeartTimer() {
            const bar = byId('heart-timer-bar');
            if (!bar) return;
            if (this.playerData.hearts >= this.playerData.maxHearts || !this.playerData.lastHeartLost) {
                bar.style.display = 'none';
                return;
            }

            bar.style.display = 'block';
            const lostTime = new Date(this.playerData.lastHeartLost).getTime();
            const elapsed = Date.now() - lostTime;
            const totalMs = HEART_RECOVERY_MINUTES * 60 * 1000;
            const remaining = totalMs - (elapsed % totalMs);
            const progress = ((totalMs - remaining) / totalMs) * 100;
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);

            byId('heart-timer-time').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            byId('heart-timer-fill').style.width = progress + '%';

            if (elapsed >= totalMs) {
                this.recoverHearts();
                this.updateStatsDisplay();
            }
        }

        // ═══════════════════════════════════════
        // Onboarding
        // ═══════════════════════════════════════
        onboardingSteps() {
            return [
                { icon: 'fa-dumbbell', art: 'onboarding/step-1.webp', title: 'ברוכים הבאים לתרגול', text: 'כאן מתרגלים את מה שנלמד בשיעורים. שיעור קצר בכל פעם.' },
                { icon: 'fa-book-open', art: 'onboarding/step-2.webp', title: 'קוראים ואז עונים', text: 'כל שיעור נפתח בקטע קריאה קצר. אחריו באים התרגילים. טעיתם? מקבלים הסבר וממשיכים.' },
                { icon: 'fa-fire', art: 'onboarding/step-3.webp', title: 'צוברים XP ושומרים על רצף', text: 'כל תשובה נכונה שווה XP. יש חמישה לבבות, והם מתמלאים מחדש עם הזמן.' }
            ];
        }

        showOnboarding() {
            this.onboardingStep = 0;
            byId('onboarding-overlay').style.display = 'flex';
            this.renderOnboardingStep();
        }

        renderOnboardingStep() {
            const steps = this.onboardingSteps();
            const step = steps[this.onboardingStep];
            byId('onboarding-step-content').innerHTML = `
                <div class="onboarding-art-wrap">${this.art(step.art, 'onboarding-art', step.icon)}</div>
                <h2>${esc(step.title)}</h2>
                <p>${esc(step.text)}</p>
            `;
            byId('onboarding-dots').innerHTML = steps.map((_, i) => {
                let cls = 'onboarding-dot';
                if (i < this.onboardingStep) cls += ' done';
                if (i === this.onboardingStep) cls += ' active';
                return `<div class="${cls}"></div>`;
            }).join('');
            byId('onboarding-btn').textContent = this.onboardingStep === steps.length - 1 ? 'מתחילים' : 'הבא';
        }

        nextOnboardingStep() {
            this.sound.play('click');
            this.onboardingStep++;
            if (this.onboardingStep >= this.onboardingSteps().length) {
                this.finishOnboarding();
            } else {
                this.renderOnboardingStep();
            }
        }

        skipOnboarding() {
            this.finishOnboarding();
        }

        finishOnboarding() {
            byId('onboarding-overlay').style.display = 'none';
            this.playerData.onboardingComplete = true;
            this.savePlayerData();
        }

        // ═══════════════════════════════════════
        // Screen transitions, sound, bottom nav
        // ═══════════════════════════════════════
        transitionTo(renderFn) {
            const container = byId('game-container');
            container.classList.add('fade-out');
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'instant' });
                try {
                    renderFn.call(this);
                } catch (e) {
                    this.renderCrash('המסך לא נטען.', e);
                }
                container.classList.remove('fade-out');
            }, 200);
        }

        // Last line of defence for a render that threw: say it on screen, log it,
        // and give a way out. Never a blank screen.
        renderCrash(message, err) {
            console.error('[game] render failed:', message, err);
            this.inLesson = false;
            document.body.classList.remove('game-fullscreen');
            this.hideProgressBar();
            this.hideFooter();
            const fb = byId('feedback-panel');
            if (fb) fb.classList.remove('show');
            byId('game-container').innerHTML = `
                <div class="render-error" role="alert">
                    ${icon('fa-triangle-exclamation', 'render-error-icon')}
                    <div class="render-error-title">${esc(message)}</div>
                    <div class="render-error-text">נסו שוב. אם זה חוזר, רעננו את הדף.</div>
                    <button class="btn btn-primary" onclick="game.transitionTo(function() { game.renderHomeScreen() })">חזרה למסלול</button>
                </div>`;
            this.showToast(message, 5000);
        }

        updateSoundToggle() {
            const btn = byId('sound-toggle');
            if (!btn) return;
            btn.innerHTML = icon(this.sound.enabled ? 'fa-volume-high' : 'fa-volume-xmark');
            btn.setAttribute('aria-pressed', String(this.sound.enabled));
            btn.setAttribute('aria-label', this.sound.enabled ? 'כיבוי צלילים' : 'הפעלת צלילים');
        }

        toggleSound() {
            const enabled = this.sound.toggle();
            this.updateSoundToggle();
            if (enabled) this.sound.play('click');
            if (this.currentScreen === 'profile') this.renderProfileScreen();
        }

        navTo(tab) {
            switch (tab) {
                case 'home': this.transitionTo(() => this.renderHomeScreen()); break;
                case 'stats': this.transitionTo(() => this.renderStatsScreen()); break;
                case 'profile': this.transitionTo(() => this.renderProfileScreen()); break;
            }
        }

        updateBottomNav(screen) {
            document.querySelectorAll('.bottom-nav-item').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('aria-current');
            });
            const map = { home: 'nav-home', module: 'nav-home', stats: 'nav-stats', profile: 'nav-profile' };
            const el = byId(map[screen]);
            if (el) {
                el.classList.add('active');
                el.setAttribute('aria-current', 'page');
            }
        }

        // ═══════════════════════════════════════
        // Profile screen
        // ═══════════════════════════════════════
        renderProfileScreen() {
            this.currentScreen = 'profile';
            this.inLesson = false;
            document.body.classList.remove('game-fullscreen');
            this.updateBottomNav('profile');
            this.hideProgressBar();
            this.hideFooter();

            const level = this.playerData.level || 1;
            const who = this.user ? (this.user.email || 'משתמש רשום') : 'מצב אורח';
            const top = this.isEmbed ? ' target="_top"' : '';
            const achievementsHtml = this.achievements.map(a => this.achievementItemHtml(a)).join('');

            byId('game-container').innerHTML = `
                <div class="profile-screen">
                    <div class="profile-card">
                        <div class="profile-avatar">${this.art(`levels/level-${level}.webp`, 'profile-level-art', 'fa-user')}</div>
                        <div class="profile-email" dir="auto">${esc(who)}</div>
                        <div class="profile-role">${esc(this.getLevelName(level))} · רמה ${level}</div>
                        ${this.isGuest ? '<div class="profile-note">ההתקדמות נשמרת במכשיר הזה בלבד. התחברו כדי לשמור אותה גם בחשבון.</div>' : ''}
                    </div>

                    <div class="profile-actions">
                        <button class="profile-action-btn" onclick="game.navTo('stats')">
                            ${icon('fa-chart-simple')} <span>הסטטיסטיקות שלי</span>
                        </button>
                        <button class="profile-action-btn" onclick="game.toggleSound()">
                            ${icon(this.sound.enabled ? 'fa-volume-high' : 'fa-volume-xmark')} <span>צלילים: ${this.sound.enabled ? 'פעילים' : 'כבויים'}</span>
                        </button>
                        <a class="profile-action-btn" href="../index.html"${top}>
                            ${icon('fa-circle-play')} <span>חזרה לשיעורים</span>
                        </a>
                        ${this.isGuest ? `
                        <button class="profile-action-btn" onclick="game.openLogin()">
                            ${icon('fa-right-to-bracket')} <span>התחברות</span>
                        </button>` : `
                        <button class="profile-action-btn danger" onclick="game.logout()">
                            ${icon('fa-right-from-bracket')} <span>התנתקות</span>
                        </button>`}
                    </div>

                    <div class="achievements-section">
                        <div class="achievements-title">${icon('fa-trophy')} כל ההישגים</div>
                        <div class="achievements-grid">${achievementsHtml}</div>
                    </div>
                </div>
            `;
        }

        openLogin() {
            if (window.bwcAuthModal && typeof window.bwcAuthModal.open === 'function') {
                window.bwcAuthModal.open('login');
            } else {
                this.showToast('ההתחברות לא זמינה כרגע. נסו לרענן את הדף.');
            }
        }

        async logout() {
            try {
                if (window.bwcAuth && typeof window.bwcAuth.signOut === 'function') await window.bwcAuth.signOut();
            } catch (e) {
                console.warn('[game] sign out failed', e);
            }
        }

        // ═══════════════════════════════════════
        // Streak (Israel days, derived from real answers)
        // ═══════════════════════════════════════
        ilDay(date) {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(date || new Date());
        }

        // Calendar arithmetic on 'YYYY-MM-DD'. Built at 12:00 local so a DST jump
        // in the player's own timezone can never skip or duplicate a day.
        shiftDay(ymd, delta) {
            const [y, m, d] = ymd.split('-').map(Number);
            const t = new Date(y, m - 1, d + delta, 12);
            return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        }

        dayDiff(a, b) {
            const [ay, am, ad] = a.split('-').map(Number);
            const [by, bm, bd] = b.split('-').map(Number);
            return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
        }

        // The streak is DERIVED, never incremented. A streak day is a day on which
        // the player actually answered an exercise (weeklyActivity is that ledger).
        // Opening the game does not count, and a stale streak expires on its own.
        // A streak that ended yesterday stays alive until midnight.
        //
        // streakBase carries a streak that the ledger cannot see: the one-time seed
        // from the old practice game, or a streak merged from another device. It
        // only counts while it connects to today's chain without a gap.
        recomputeStreak(opts) {
            const d = this.playerData;
            const activity = d.weeklyActivity || {};
            const days = new Set(Object.keys(activity).filter(k => (activity[k] || 0) > 0));
            const today = this.ilDay();
            const yesterday = this.shiftDay(today, -1);
            const base = (d.streakBase && d.streakBase.count > 0 && d.streakBase.lastDate) ? d.streakBase : null;

            let streak = 0;
            const newest = days.has(today) ? today : (days.has(yesterday) ? yesterday : null);
            if (newest) {
                let cursor = newest;
                while (days.has(cursor)) { streak++; cursor = this.shiftDay(cursor, -1); }
                // cursor is now the first day without practice before the chain.
                if (base && base.lastDate >= cursor && base.lastDate <= newest) {
                    streak = Math.max(streak, this.dayDiff(base.lastDate, newest) + base.count);
                }
            } else if (base && (base.lastDate === today || base.lastDate === yesterday)) {
                streak = base.count;
            }

            let lastPlayDate = days.size ? Array.from(days).sort().pop() : null;
            if (d.lastPlayDate && (!lastPlayDate || d.lastPlayDate > lastPlayDate)) lastPlayDate = d.lastPlayDate;
            const longest = Math.max(streak, d.longestStreak || 0);

            const changed = streak !== d.streak || lastPlayDate !== d.lastPlayDate || longest !== (d.longestStreak || 0);
            d.streak = streak;
            d.lastPlayDate = lastPlayDate;
            d.longestStreak = longest;

            if (changed && !(opts && opts.silent)) this.savePlayerData();
            return streak;
        }

        // Every day the player ever practised. Only grows.
        practiceDays() {
            const activity = this.playerData.weeklyActivity || {};
            return Object.keys(activity).filter(k => (activity[k] || 0) > 0).length;
        }

        // ═══════════════════════════════════════
        // Header stats
        // ═══════════════════════════════════════
        updateStatsDisplay() {
            byId('xp-value').textContent = this.playerData.xp;
            byId('streak-value').textContent = this.practiceDays();
            this.renderHearts();
        }

        renderHearts() {
            const container = byId('hearts-container');
            if (!container) return;
            const isMobile = window.innerWidth <= 480;
            let html = '';
            if (isMobile) {
                html = `<span class="hearts-compact">${icon('fa-heart', 'heart')} <span class="hearts-count">${this.playerData.hearts}</span></span>`;
            } else {
                for (let i = 0; i < this.playerData.maxHearts; i++) {
                    html += icon('fa-heart', 'heart' + (i >= this.playerData.hearts ? ' empty' : ''));
                }
            }
            container.innerHTML = html;
            container.setAttribute('aria-label', `לבבות: ${this.playerData.hearts} מתוך ${this.playerData.maxHearts}`);
        }

        // ═══════════════════════════════════════
        // Levels
        // ═══════════════════════════════════════
        calculateLevel() {
            for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
                if (this.playerData.xp >= XP_THRESHOLDS[i]) return i + 1;
            }
            return 1;
        }

        getLevelName(level) {
            return LEVEL_NAMES[level - 1] || LEVEL_NAMES[LEVEL_NAMES.length - 1];
        }

        getLevelProgressInfo() {
            const currentLevel = this.playerData.level || 1;
            const currentXP = this.playerData.xp;
            const isMax = currentLevel >= XP_THRESHOLDS.length;
            const currentThreshold = XP_THRESHOLDS[currentLevel - 1] || 0;
            const nextThreshold = isMax ? currentThreshold : XP_THRESHOLDS[currentLevel];
            const xpNeeded = Math.max(1, nextThreshold - currentThreshold);
            const progress = isMax ? 100 : Math.min(100, ((currentXP - currentThreshold) / xpNeeded) * 100);
            return { progress, xpToNext: isMax ? 0 : Math.max(0, nextThreshold - currentXP), currentXP, nextThreshold, isMax };
        }

        // ═══════════════════════════════════════
        // Achievements
        // ═══════════════════════════════════════
        getAchievementProgress(a) {
            if (a.id === 'accuracy_80') return `דיוק: ${this.accuracyPct(this.playerData)}%`;
            if (a.id === 'all_lessons') return `${this.completedInData()}/${this.totalLessons()} שיעורים`;
            const value = Math.min(a.value(this.playerData), a.target);
            return `${value}/${a.target} ${a.unit}`;
        }

        achievementItemHtml(a) {
            const isUnlocked = this.playerData.achievements.includes(a.id);
            const progress = isUnlocked ? `${icon('fa-check')} הושג` : esc(this.getAchievementProgress(a));
            return `
                <button type="button" class="achievement-item ${isUnlocked ? 'unlocked' : 'locked'}" onclick="game.showAchievementTooltip(this, '${a.id}')">
                    <div class="achievement-icon">${this.art(`badges/${a.id}.webp`, 'achievement-badge-img', a.icon)}</div>
                    <div class="achievement-name">${esc(a.title)}</div>
                    <div class="achievement-progress">${progress}</div>
                </button>
            `;
        }

        renderAchievementsGrid() {
            return this.achievements.slice(0, 8).map(a => this.achievementItemHtml(a)).join('');
        }

        showAchievementTooltip(el, id) {
            const a = this.achievements.find(x => x.id === id);
            if (!a) return;
            document.querySelectorAll('.achievement-tooltip').forEach(t => t.remove());
            const isUnlocked = this.playerData.achievements.includes(a.id);
            const tooltip = document.createElement('div');
            tooltip.className = 'achievement-tooltip';
            tooltip.innerHTML = `<strong>${esc(a.title)}</strong><br>${esc(a.desc)}<br><small>${isUnlocked ? 'הושג' : esc(this.getAchievementProgress(a))}</small>`;
            el.style.position = 'relative';
            el.appendChild(tooltip);
            setTimeout(() => tooltip.classList.add('show'), 10);
            setTimeout(() => tooltip.remove(), 3000);
        }

        checkAchievements() {
            const fresh = [];
            this.achievements.forEach(a => {
                let earned = false;
                try { earned = a.condition(this.playerData); } catch (e) { console.error('[game] achievement check failed', a.id, e); }
                if (!this.playerData.achievements.includes(a.id) && earned) {
                    this.playerData.achievements.push(a.id);
                    fresh.push(a);
                }
            });
            if (fresh.length > 0) {
                this.savePlayerData();
                this.showAchievementPopup(fresh[0]);
            }
        }

        showAchievementPopup(a) {
            this.sound.play('achievement');
            const popup = document.createElement('div');
            popup.className = 'achievement-popup';
            popup.setAttribute('role', 'status');
            popup.innerHTML = `
                <div class="achievement-popup-icon">${this.art(`badges/${a.id}.webp`, 'achievement-popup-img', a.icon)}</div>
                <div class="achievement-popup-content">
                    <div class="achievement-popup-title">הישג חדש</div>
                    <div class="achievement-popup-name">${esc(a.title)}</div>
                    <div class="achievement-popup-desc">${esc(a.desc)}</div>
                </div>
            `;
            document.body.appendChild(popup);
            setTimeout(() => popup.classList.add('show'), 100);
            setTimeout(() => {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 500);
            }, 3000);
        }

        // ═══════════════════════════════════════
        // Home screen (map)
        // ═══════════════════════════════════════
        renderHomeScreen() {
            this.currentScreen = 'home';
            this.inLesson = false;
            document.body.classList.remove('game-fullscreen');
            this.updateBottomNav('home');
            const container = byId('game-container');
            const levelInfo = this.getLevelProgressInfo();
            const level = this.playerData.level || 1;

            // Next recommended module (first unlocked + unfinished)
            let nextModuleId = null;
            for (let i = 0; i < this.modules.length; i++) {
                if (!this.isModuleLocked(i) && this.getModuleProgress(this.modules[i].id) < 100) { nextModuleId = this.modules[i].id; break; }
            }

            const previousLocked = this._previousLockedModules || [];
            const currentLocked = [];
            let pathNodesHtml = '';

            this.modules.forEach((module, index) => {
                const progress = this.getModuleProgress(module.id);
                const isCompleted = progress === 100;
                const isLocked = this.isModuleLocked(index);
                const isPerfect = module.lessons.every(l => (this.playerData.perfectLessonsList || []).includes(this.lk(module, l)));

                if (isLocked) currentLocked.push(module.id);
                const justUnlocked = previousLocked.includes(module.id) && !isLocked;

                let stateClass = 'available';
                let stateBadge = '';
                let stateLabel = '';
                if (isLocked) { stateClass = 'locked'; stateBadge = 'fa-lock'; stateLabel = 'נעול'; }
                else if (isPerfect) { stateClass = 'completed'; stateBadge = 'fa-star'; stateLabel = 'הושלם בלי טעויות'; }
                else if (isCompleted) { stateClass = 'completed'; stateBadge = 'fa-check'; stateLabel = 'הושלם'; }

                // The cover is always shown. The state sits on it as a corner badge.
                const cover = module.image
                    ? this.art(String(module.image).replace(/^assets\/game\//, ''), 'home-path-img', module.icon || 'fa-layer-group')
                    : icon(module.icon || 'fa-layer-group', 'art-fallback home-path-img-fallback');
                const badge = stateBadge ? `<span class="home-path-state" title="${stateLabel}">${icon(stateBadge)}</span>` : '';

                if (justUnlocked) stateClass += ' just-unlocked';
                if (module.id === nextModuleId) stateClass += ' next-action';

                const action = isLocked
                    ? `game.showLockedHint('module', ${module.id})`
                    : `game.transitionTo(function() { game.openModule(${module.id}) })`;

                pathNodesHtml += `
                    <button type="button" class="home-path-node ${stateClass}" onclick="${action}"
                            aria-label="מודול ${module.id}: ${esc(module.title)}${stateLabel ? ', ' + stateLabel : ''}">
                        <div class="home-path-icon">${cover}${badge}</div>
                        <div class="home-path-info">
                            <div class="home-path-label">מודול ${module.id}</div>
                            <div class="home-path-title">${esc(module.title)}</div>
                            <div class="home-path-desc">${esc(module.description || '')}</div>
                            <div class="home-path-progress">
                                <div class="home-path-progress-bar">
                                    <div class="home-path-progress-fill" style="width: ${progress}%"></div>
                                </div>
                                <span class="home-path-progress-text">${progress}%</span>
                            </div>
                        </div>
                        <div class="home-path-arrow">${isLocked ? '' : icon('fa-chevron-left')}</div>
                    </button>
                `;
            });

            // Goal card
            const total = this.totalLessons();
            const overallProgress = total > 0 ? Math.round((this.completedInData() / total) * 100) : 0;
            pathNodesHtml += `
                <div class="home-path-node goal">
                    <div class="home-path-icon">${icon('fa-trophy', 'art-fallback')}</div>
                    <div class="home-path-info">
                        <div class="home-path-label">היעד</div>
                        <div class="home-path-title">עסק ללא מתחרים</div>
                        <div class="home-path-desc">השלימו את כל המודולים</div>
                        <div class="home-path-progress">
                            <div class="home-path-progress-bar">
                                <div class="home-path-progress-fill" style="width: ${overallProgress}%"></div>
                            </div>
                            <span class="home-path-progress-text">${overallProgress}%</span>
                        </div>
                    </div>
                </div>
            `;

            // Main call to action: continue where you left off.
            const resume = this.getResumeTarget();
            let resumeCtaHtml = '';
            if (resume.allDone) {
                resumeCtaHtml = `
                    <div class="resume-cta resume-cta--done">
                        <div class="resume-cta-icon">${icon('fa-trophy')}</div>
                        <div class="resume-cta-body">
                            <div class="resume-cta-label">כל הכבוד</div>
                            <div class="resume-cta-title">השלמתם את כל השיעורים הזמינים</div>
                        </div>
                    </div>`;
            } else {
                resumeCtaHtml = `
                    <button type="button" class="resume-cta" id="resume-cta" onclick="game.resumeLearning()">
                        <div class="resume-cta-icon">${icon('fa-play')}</div>
                        <div class="resume-cta-body">
                            <div class="resume-cta-label">${resume.started ? 'ממשיכים מאיפה שעצרתם' : 'מתחילים לתרגל'}</div>
                            <div class="resume-cta-title">${esc(resume.module.title)} · ${esc(resume.lesson.title)}</div>
                        </div>
                        <div class="resume-cta-arrow">${icon('fa-arrow-left')}</div>
                    </button>`;
            }

            container.innerHTML = `
                <div class="home-hero">
                    <h1 class="home-hero-title">תרגול</h1>
                    <p class="home-hero-sub">קוראים קטע קצר, עונים על התרגילים וצוברים XP.</p>
                    <div class="home-hero-counts">
                        <span>${icon('fa-layer-group')} ${this.modules.length} מודולים</span>
                        <span>${icon('fa-book-open')} ${total} שיעורים</span>
                        <span>${icon('fa-pen-to-square')} ${this.totalExercises()} תרגילים</span>
                    </div>
                </div>

                ${resumeCtaHtml}

                <div class="level-progress-container">
                    <div class="level-info">
                        <div class="level-current">
                            <span class="level-art-wrap">${this.art(`levels/level-${level}.webp`, 'level-art', 'fa-ranking-star')}</span>
                            <span class="level-badge">רמה ${level}</span>
                            <span class="level-name">${esc(this.getLevelName(level))}</span>
                        </div>
                        <span class="level-next">${levelInfo.isMax ? 'הרמה הגבוהה ביותר' : `עוד ${levelInfo.xpToNext} XP לרמה הבאה`}</span>
                    </div>
                    <div class="level-progress-bar">
                        <div class="level-progress-fill" style="width: ${levelInfo.progress}%"></div>
                    </div>
                    <div class="level-xp-text">
                        <span>${levelInfo.currentXP} XP</span>
                        <span>${levelInfo.isMax ? '' : levelInfo.nextThreshold + ' XP'}</span>
                    </div>
                </div>

                <div class="home-journey">
                    <div class="home-path-container">
                        <div class="home-path-line"></div>
                        ${pathNodesHtml}
                    </div>
                </div>

                <div class="achievements-section">
                    <div class="achievements-title">${icon('fa-trophy')} הישגים</div>
                    <div class="achievements-grid">
                        ${this.renderAchievementsGrid()}
                    </div>
                </div>
            `;

            this._previousLockedModules = currentLocked;
            this.hideProgressBar();
            this.hideFooter();
        }

        getModuleProgress(moduleId) {
            const module = this.modules.find(m => m.id === moduleId);
            if (!module || !module.lessons.length) return 0;
            const done = module.lessons.filter(l => this.isLessonDone(module, l)).length;
            return Math.round((done / module.lessons.length) * 100);
        }

        // Single source of truth for module locking. A module is open when it is
        // the first one, when the previous module is 100% done, or when the
        // learner already completed a lesson in it (for example through a deep
        // link from a lesson page).
        isModuleLocked(index) {
            if (index <= 0) return false;
            const mod = this.modules[index];
            if (!mod) return true;
            if (this.getModuleProgress(this.modules[index - 1].id) >= 100) return false;
            return !mod.lessons.some(l => this.isLessonDone(mod, l));
        }

        isLessonLocked(mod, index) {
            return index > 0 && !this.isLessonDone(mod, mod.lessons[index - 1]);
        }

        getResumeTarget() {
            const started = this.completedCount() > 0;
            for (let i = 0; i < this.modules.length; i++) {
                if (this.isModuleLocked(i)) continue;
                const module = this.modules[i];
                for (let j = 0; j < module.lessons.length; j++) {
                    const lesson = module.lessons[j];
                    if (!this.isLessonDone(module, lesson)) {
                        return { module, lesson, moduleIndex: i, lessonIndex: j, started, allDone: false };
                    }
                }
            }
            return { module: null, lesson: null, allDone: true, started: true };
        }

        resumeLearning() {
            const t = this.getResumeTarget();
            if (t.allDone || !t.module || !t.lesson) {
                this.transitionTo(() => this.renderHomeScreen());
                return;
            }
            this.transitionTo(() => {
                this.openModule(t.module.id);
                this.startLesson(t.lesson.id);
            });
        }

        // ═══════════════════════════════════════
        // Module screen
        // ═══════════════════════════════════════
        openModule(moduleId) {
            const mod = this.modules.find(m => m.id === moduleId);
            if (!mod) {
                this.showError('המודול לא נמצא.');
                return;
            }
            this.currentModule = mod;
            this.currentScreen = 'module';
            this.inLesson = false;
            document.body.classList.add('game-fullscreen');
            const perfectList = this.playerData.perfectLessonsList || [];

            const completedCount = mod.lessons.filter(l => this.isLessonDone(mod, l)).length;
            const totalCount = mod.lessons.length;
            const progressPct = Math.round((completedCount / totalCount) * 100);

            const pathHtml = mod.lessons.map((lesson, index) => {
                const key = this.lk(mod, lesson);
                const isCompleted = this.isLessonDone(mod, lesson);
                const isPerfect = perfectList.includes(key);
                const isLocked = this.isLessonLocked(mod, index) && !isCompleted;

                let stateClass = 'locked';
                let nodeIcon = 'fa-lock';
                let stateLabel = 'נעול';
                let onclick = `game.showLockedHint('lesson')`;

                if (isPerfect) { stateClass = 'perfect'; nodeIcon = 'fa-star'; stateLabel = 'הושלם בלי טעויות'; onclick = `game.startLesson(${lesson.id})`; }
                else if (isCompleted) { stateClass = 'completed'; nodeIcon = 'fa-check'; stateLabel = 'הושלם'; onclick = `game.startLesson(${lesson.id})`; }
                else if (!isLocked) { stateClass = 'available'; nodeIcon = 'fa-play'; stateLabel = 'זמין'; onclick = `game.startLesson(${lesson.id})`; }

                return `
                    <div class="path-node-row">
                        ${index < mod.lessons.length - 1 ? '<div class="path-connector"></div>' : ''}
                        <button type="button" class="path-node ${stateClass}" data-lesson-key="${esc(key)}" onclick="${onclick}"
                                aria-label="שיעור ${index + 1}: ${esc(lesson.title)}, ${stateLabel}">
                            <div class="path-node-icon">${icon(nodeIcon)}</div>
                            <div class="path-node-info">
                                <div class="path-node-number">שיעור ${index + 1}</div>
                                <div class="path-node-title">${esc(lesson.title)}</div>
                            </div>
                        </button>
                    </div>
                `;
            }).join('');

            // The banner is a CSS background, so a missing file simply shows the
            // gradient underneath. No broken-image icon is possible.
            byId('game-container').innerHTML = `
                <button class="back-btn" onclick="game.transitionTo(function() { game.renderHomeScreen() })">
                    ${icon('fa-arrow-right')} חזרה
                </button>
                <div class="learning-path-header has-banner is-always-dark"
                     style="--banner: url('${ASSET}banners/module-${mod.id}.webp')">
                    <div class="learning-path-kicker">${icon(mod.icon || 'fa-layer-group')} מודול ${mod.id}</div>
                    <h2>${esc(mod.title)}</h2>
                    <div class="learning-path-progress">
                        <span>${completedCount}/${totalCount} שיעורים</span>
                        <div class="learning-path-progress-bar">
                            <div class="learning-path-progress-fill" style="width: ${progressPct}%"></div>
                        </div>
                    </div>
                </div>
                ${mod.description ? `<p class="module-intro">${esc(mod.description)}</p>` : ''}
                <div class="learning-path">
                    ${pathHtml}
                </div>
            `;

            this.hideProgressBar();
            this.hideFooter();
        }

        // ═══════════════════════════════════════
        // Lesson
        // ═══════════════════════════════════════
        startLesson(lessonId) {
            if (!this.currentModule || !this.currentModule.lessons) {
                this.showError('שגיאה בטעינת המודול. נסו לרענן את הדף.');
                return;
            }
            const lesson = this.currentModule.lessons.find(l => l.id === lessonId);
            if (!lesson) {
                this.showError('השיעור לא נמצא.');
                return;
            }
            this.currentLesson = lesson;
            document.body.classList.add('game-fullscreen');
            this._reinforceCount = 0;

            if (this.playerData.hearts <= 0) {
                this._pendingLessonId = lessonId;
                this.showNoHeartsModal();
                return;
            }
            this._pendingLessonId = null;

            this.currentExerciseIndex = 0;
            this.lessonMistakes = 0;
            this.lessonXP = 0;
            this.comboCount = 0;
            this.maxCombo = 0;
            this.inLesson = true;
            this.showProgressBar();

            // A malformed lesson must never be a silent dead click: show the
            // failure, log it, and fall back to the module screen.
            try {
                if (lesson.reading && Array.isArray(lesson.reading.paragraphs) && lesson.reading.paragraphs.length) {
                    this.currentScreen = 'reading';
                    this.updateProgressBar();
                    this.renderReading();
                } else {
                    this.currentScreen = 'exercise';
                    this.renderExercise();
                }
            } catch (e) {
                this.showError('שגיאה בטעינת השיעור. חוזרים למסך המודול.', e);
                this.inLesson = false;
                this.transitionTo(() => this.openModule(this.currentModule.id));
            }
        }

        // ═══════════════════════════════════════
        // Reading screen
        // ═══════════════════════════════════════
        renderReading() {
            const lesson = this.currentLesson;
            const reading = lesson.reading;
            const container = byId('game-container');
            const terms = Array.isArray(reading.keyTerms) ? reading.keyTerms.filter(k => k && k.term) : [];
            this._readingTerms = terms;

            // Key terms become tappable. One pass with a single alternation regex
            // (longest term first) so a term is never replaced inside the markup
            // of another term.
            const renderParagraph = (text) => {
                const safe = esc(text);
                if (!terms.length) return safe;
                const sorted = terms.map((k, i) => ({ text: esc(k.term), i })).sort((a, b) => b.text.length - a.text.length);
                const pattern = new RegExp(sorted.map(s => s.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
                return safe.replace(pattern, (match) => {
                    const hit = sorted.find(s => s.text === match);
                    return `<button type="button" class="key-term" onclick="game.explainTerm(${hit.i})">${match}</button>`;
                });
            };

            const paragraphsHTML = reading.paragraphs
                .map(p => `<p class="reading-paragraph">${renderParagraph(p)}</p>`)
                .join('');

            // ~200 Hebrew words per minute
            const wordCount = reading.paragraphs.join(' ').split(/\s+/).length;
            const readingMinutes = Math.max(1, Math.round(wordCount / 200));

            container.innerHTML = `
                <button class="back-btn" onclick="game.exitLesson()" aria-label="יציאה מהשיעור">${icon('fa-xmark')}</button>
                <div class="reading-section">
                    <div class="reading-header">
                        <span class="reading-icon">${icon('fa-book-open')}</span>
                        <h2 class="reading-title">${esc(lesson.title)}</h2>
                        <div class="reading-time">${icon('fa-clock')} קריאה של כ-${readingMinutes} דקות</div>
                    </div>
                    <div class="reading-content">
                        ${paragraphsHTML}
                    </div>
                    ${terms.length ? `
                    <div class="key-terms">
                        <div class="key-terms-title">${icon('fa-key')} מונחי מפתח</div>
                        <div class="key-terms-list">
                            ${terms.map((k, i) => `<button type="button" class="key-term-chip" onclick="game.explainTerm(${i})">${esc(k.term)}</button>`).join('')}
                        </div>
                        <div class="reading-hint">הקישו על מונח כדי לראות את ההגדרה שלו.</div>
                    </div>` : ''}
                    <div class="reading-cta-wrapper">
                        <button class="btn btn-primary btn-full reading-cta" id="reading-cta" onclick="game.startExercises()">
                            מתחילים לתרגל ${icon('fa-arrow-left')}
                        </button>
                    </div>
                </div>
            `;

            this.hideFooter();

            const readingEl = container.querySelector('.reading-section');
            if (readingEl) {
                const bar = document.createElement('div');
                bar.className = 'reading-scroll-progress';
                bar.innerHTML = '<div class="reading-scroll-fill"></div>';
                readingEl.prepend(bar);
                const fill = bar.querySelector('.reading-scroll-fill');
                this.clearReadingScroll();
                const onScroll = () => {
                    const scrollTop = window.scrollY || document.documentElement.scrollTop;
                    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                    const pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 100;
                    fill.style.width = pct + '%';
                };
                window.addEventListener('scroll', onScroll, { passive: true });
                this._readingScrollHandler = onScroll;
            }
        }

        clearReadingScroll() {
            if (this._readingScrollHandler) {
                window.removeEventListener('scroll', this._readingScrollHandler);
                this._readingScrollHandler = null;
            }
        }

        // A key term tap shows its definition from the data. No network call.
        explainTerm(index) {
            const entry = (this._readingTerms || [])[index];
            if (!entry) return;
            document.querySelectorAll('.term-tooltip').forEach(t => t.remove());
            const tooltip = document.createElement('div');
            tooltip.className = 'term-tooltip';
            tooltip.setAttribute('role', 'status');
            tooltip.innerHTML = `<strong>${esc(entry.term)}</strong><span>${esc(entry.definition || '')}</span>`;
            document.body.appendChild(tooltip);
            // The tooltip never takes a tap itself (it can sit over the "start"
            // button). The next tap anywhere closes it and still does its own job.
            const close = () => {
                document.removeEventListener('click', close, true);
                tooltip.classList.remove('show');
                setTimeout(() => tooltip.remove(), 300);
            };
            setTimeout(() => {
                tooltip.classList.add('show');
                document.addEventListener('click', close, true);
            }, 10);
            setTimeout(close, 8000);
        }

        startExercises() {
            this.clearReadingScroll();
            document.querySelectorAll('.term-tooltip').forEach(t => t.remove());
            this.currentScreen = 'exercise';
            this.transitionTo(() => this.renderExercise());
        }

        // ═══════════════════════════════════════
        // Exercises
        // ═══════════════════════════════════════
        renderExercise() {
            if (!this.currentLesson || !Array.isArray(this.currentLesson.exercises)) {
                this.renderCrash('שגיאה בטעינת התרגיל.', new Error('renderExercise without currentLesson.exercises'));
                return;
            }
            const exercise = this.currentLesson.exercises[this.currentExerciseIndex];
            if (!exercise) {
                this.completeLesson();
                return;
            }

            this.selectedAnswer = null;
            this.exerciseAnswered = false;
            this.secondChanceUsed = false;
            this._advancing = false;    // the previous exercise finished advancing
            this.exerciseStartTime = Date.now();
            this.updateProgressBar();

            const container = byId('game-container');
            const total = this.currentLesson.exercises.length;

            try {
                switch (exercise.type) {
                    case 'multiple-choice': this.renderMultipleChoice(container, exercise); break;
                    case 'scenario': this.renderScenario(container, exercise); break;
                    case 'improve': this.renderImprove(container, exercise); break;
                    case 'fill-blank': this.renderFillBlank(container, exercise); break;
                    case 'compare': this.renderCompare(container, exercise); break;
                    case 'order': this.renderOrder(container, exercise); break;
                    case 'match': this.renderMatch(container, exercise); break;
                    default: throw new Error('unknown exercise type: ' + exercise.type);
                }
            } catch (e) {
                // One bad exercise must not trap the learner. Say it on screen,
                // log it, and let them move past it without losing a heart.
                console.error('[game] exercise render failed', e, exercise);
                this.showToast('התרגיל הזה לא נטען. אפשר לדלג עליו.', 5000);
                container.innerHTML = `
                    <button class="back-btn" onclick="game.exitLesson()" aria-label="יציאה מהשיעור">${icon('fa-xmark')}</button>
                    <div class="render-error" role="alert">
                        ${icon('fa-triangle-exclamation', 'render-error-icon')}
                        <div class="render-error-title">התרגיל הזה לא נטען.</div>
                        <div class="render-error-text">אפשר לדלג עליו ולהמשיך בשיעור.</div>
                        <button class="btn btn-primary" onclick="game.skipBrokenExercise()">דלגו לתרגיל הבא</button>
                    </div>`;
                this.hideFooter();
                return;
            }

            const backBtn = container.querySelector('.back-btn');
            if (backBtn) {
                backBtn.insertAdjacentHTML('afterend',
                    `<div class="exercise-breadcrumb">${esc(this.currentModule.title)} · שיעור ${this.currentLesson.id} · תרגיל ${this.currentExerciseIndex + 1}/${total}</div>`);
            }

            this.showFooter();
            this.maybeShowFirstExerciseTip();
        }

        skipBrokenExercise() {
            this.currentExerciseIndex++;
            this.transitionTo(() => this.renderExercise());
        }

        // One mechanics tip the first time a player ever reaches an exercise.
        maybeShowFirstExerciseTip() {
            try {
                if (localStorage.getItem(TIP_KEY)) return;
                if (this.completedCount() > 0) return;
                localStorage.setItem(TIP_KEY, '1');
                this.showToast('בחרו תשובה ואז לחצו "בדיקה". מותר לטעות, ככה לומדים.', 6000);
            } catch (e) { /* storage blocked, skip the tip */ }
        }

        exerciseHeader(type) {
            const meta = EXERCISE_META[type];
            return `<div class="exercise-type">${this.art(`exercises/${type}.webp`, 'exercise-type-icon', meta.icon)} ${meta.label}</div>`;
        }

        exerciseTip(type) {
            return `<div class="exercise-tip">${icon('fa-lightbulb', 'exercise-tip-icon')}<span class="exercise-tip-text">${EXERCISE_META[type].tip}</span></div>`;
        }

        exitButton() {
            return `<button class="back-btn" onclick="game.exitLesson()" aria-label="יציאה מהשיעור">${icon('fa-xmark')}</button>`;
        }

        optionsHtml(exercise) {
            return exercise.options.map((option, index) => `
                <button type="button" class="option-btn" onclick="game.selectOption(${index})">
                    <span class="option-letter">${LETTERS[index] || index + 1}</span>
                    <span class="option-text">${esc(option)}</span>
                </button>
            `).join('');
        }

        renderMultipleChoice(container, exercise) {
            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('multiple-choice')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="options-list" role="group" aria-label="אפשרויות תשובה">
                        ${this.optionsHtml(exercise)}
                    </div>
                    ${this.exerciseTip('multiple-choice')}
                </div>
            `;
        }

        selectOption(index) {
            if (this.exerciseAnswered) return;
            this.sound.play('click');
            this.selectedAnswer = index;
            document.querySelectorAll('.option-btn').forEach((btn, i) => {
                btn.classList.toggle('selected', i === index);
            });
            this.enableCheckButton();
        }

        renderScenario(container, exercise) {
            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('scenario')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    ${exercise.context ? `<div class="scenario-context"><div class="scenario-context-label">${icon('fa-clipboard-list')} המצב:</div><div class="scenario-context-text">${esc(exercise.context)}</div></div>` : ''}
                    <div class="options-list" role="group" aria-label="אפשרויות תשובה">
                        ${this.optionsHtml(exercise)}
                    </div>
                    ${this.exerciseTip('scenario')}
                </div>
            `;
        }

        renderImprove(container, exercise) {
            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('improve')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="improve-original">
                        <div class="improve-original-label">הניסוח המקורי:</div>
                        <div class="improve-original-text">${esc(exercise.original || '')}</div>
                    </div>
                    <div class="options-list" role="group" aria-label="אפשרויות תשובה">
                        ${this.optionsHtml(exercise)}
                    </div>
                    ${this.exerciseTip('improve')}
                </div>
            `;
        }

        renderFillBlank(container, exercise) {
            const parts = String(exercise.template).split('___');
            const templateHtml = esc(parts[0]) + '<span class="blank-slot" id="blank-slot">___</span>' + esc(parts.slice(1).join('___'));

            const words = this.shuffleArray(exercise.options.map((word, index) => ({ word, index })));
            const wordsHtml = words.map(w => `
                <button type="button" class="word-chip" data-word-index="${w.index}" onclick="game.selectWord(this)">${esc(w.word)}</button>
            `).join('');

            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('fill-blank')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="fill-blank-container">
                        <div class="template-text">${templateHtml}</div>
                        <div class="word-bank">${wordsHtml}</div>
                    </div>
                    ${this.exerciseTip('fill-blank')}
                </div>
            `;
        }

        selectWord(el) {
            if (this.exerciseAnswered) return;
            this.sound.play('click');
            this.selectedAnswer = parseInt(el.dataset.wordIndex, 10);
            const slot = byId('blank-slot');
            slot.textContent = el.textContent;
            slot.classList.add('filled');
            document.querySelectorAll('.word-chip').forEach(chip => chip.classList.toggle('selected', chip === el));
            this.enableCheckButton();
        }

        // Reordering is done with explicit up/down buttons, which work the same
        // with a thumb and with a mouse. HTML5 drag is kept for mouse users.
        renderOrder(container, exercise) {
            let shuffled = this.shuffleArray(exercise.items.map((item, i) => ({ item, originalIndex: i })));
            // A shuffle that lands on the correct order would let "check" pass
            // with zero thought (the button only enables after a move).
            if (exercise.items.length > 1 && shuffled.every((o, i) => o.originalIndex === exercise.correctOrder[i])) {
                shuffled = shuffled.slice(1).concat(shuffled[0]);
            }
            const lastIndex = shuffled.length - 1;

            const itemsHtml = shuffled.map((obj, index) => `
                <div class="order-item" draggable="true" data-index="${index}" data-original="${obj.originalIndex}"
                     ondragstart="game.dragStart(event)" ondragover="game.dragOver(event)"
                     ondrop="game.drop(event)" ondragend="game.dragEnd(event)">
                    <span class="order-number">${index + 1}</span>
                    <span class="order-text">${esc(obj.item)}</span>
                    <div class="order-controls">
                        <button type="button" class="order-move-btn" aria-label="העבירו שלב אחד למעלה"
                                onclick="game.moveOrderItem(this, -1)"${index === 0 ? ' disabled' : ''}>${icon('fa-chevron-up')}</button>
                        <button type="button" class="order-move-btn" aria-label="העבירו שלב אחד למטה"
                                onclick="game.moveOrderItem(this, 1)"${index === lastIndex ? ' disabled' : ''}>${icon('fa-chevron-down')}</button>
                    </div>
                </div>
            `).join('');

            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('order')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="order-container" id="order-container">
                        ${itemsHtml}
                    </div>
                    ${this.exerciseTip('order')}
                </div>
            `;
            // The check button stays disabled until the player moves an item.
        }

        moveOrderItem(button, direction) {
            if (this.exerciseAnswered) return;
            const item = button.closest('.order-item');
            const container = byId('order-container');
            if (!item || !container) return;

            const neighbour = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
            if (!neighbour) return;

            if (direction < 0) container.insertBefore(item, neighbour);
            else container.insertBefore(neighbour, item);

            this.sound.play('click');
            this.updateOrderNumbers();

            // Keep focus on a live control.
            if (button.disabled) {
                const fallback = [...item.querySelectorAll('.order-move-btn')].find(b => !b.disabled);
                if (fallback) fallback.focus();
            } else {
                button.focus();
            }
        }

        dragStart(e) {
            if (this.exerciseAnswered) { e.preventDefault(); return; }
            const item = e.target.closest('.order-item');
            if (!item) return;
            item.classList.add('dragging');
            e.dataTransfer.setData('text/plain', item.dataset.index);
        }

        dragOver(e) {
            e.preventDefault();
            const item = e.target.closest('.order-item');
            if (item && !item.classList.contains('dragging')) item.classList.add('drag-over');
        }

        drop(e) {
            e.preventDefault();
            const container = byId('order-container');
            const dragging = container.querySelector('.dragging');
            const target = e.target.closest('.order-item');

            if (target && dragging && target !== dragging) {
                const items = [...container.children];
                if (items.indexOf(dragging) < items.indexOf(target)) target.after(dragging);
                else target.before(dragging);
                this.updateOrderNumbers();
            }
            document.querySelectorAll('.order-item').forEach(item => item.classList.remove('drag-over'));
        }

        dragEnd() {
            document.querySelectorAll('.order-item').forEach(item => item.classList.remove('dragging', 'drag-over'));
        }

        updateOrderNumbers() {
            const items = [...document.querySelectorAll('.order-item')];
            items.forEach((item, index) => {
                item.querySelector('.order-number').textContent = index + 1;
                const [up, down] = item.querySelectorAll('.order-move-btn');
                if (up) up.disabled = index === 0;
                if (down) down.disabled = index === items.length - 1;
            });
            this.enableCheckButton();   // the player has interacted
        }

        renderCompare(container, exercise) {
            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('compare')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="compare-cards" role="group" aria-label="שתי אפשרויות">
                        <button type="button" class="compare-card" onclick="game.selectCompare(0)">
                            <div class="compare-label">${esc(exercise.optionA.label)}</div>
                            <div class="compare-text">${esc(exercise.optionA.text)}</div>
                        </button>
                        <div class="compare-vs" aria-hidden="true">מול</div>
                        <button type="button" class="compare-card" onclick="game.selectCompare(1)">
                            <div class="compare-label">${esc(exercise.optionB.label)}</div>
                            <div class="compare-text">${esc(exercise.optionB.text)}</div>
                        </button>
                    </div>
                    ${this.exerciseTip('compare')}
                </div>
            `;
        }

        selectCompare(index) {
            if (this.exerciseAnswered) return;
            this.sound.play('click');
            this.selectedAnswer = index;
            document.querySelectorAll('.compare-card').forEach((card, i) => card.classList.toggle('selected', i === index));
            this.enableCheckButton();
        }

        showCompareFeedback(isCorrect, exercise) {
            document.querySelectorAll('.compare-card').forEach((card, i) => {
                if (i === exercise.correct) card.classList.add('correct');
                else if (i === this.selectedAnswer && !isCorrect) card.classList.add('incorrect');
            });
        }

        renderMatch(container, exercise) {
            this.matchState = { selectedLeft: null, selectedRight: null, matches: [], pairs: exercise.pairs };

            const shuffledRight = this.shuffleArray(exercise.pairs.map((p, i) => ({ text: p.right, originalIndex: i })));
            const leftHtml = exercise.pairs.map((p, i) => `
                <button type="button" class="match-item match-left" data-index="${i}" onclick="game.selectMatchItem('left', ${i})">${esc(p.left)}</button>
            `).join('');
            const rightHtml = shuffledRight.map(item => `
                <button type="button" class="match-item match-right" data-index="${item.originalIndex}" onclick="game.selectMatchItem('right', ${item.originalIndex})">${esc(item.text)}</button>
            `).join('');

            container.innerHTML = `
                ${this.exitButton()}
                <div class="exercise-container">
                    ${this.exerciseHeader('match')}
                    <div class="exercise-question">${esc(exercise.question)}</div>
                    <div class="match-instructions">הקישו על פריט מהעמודה הראשונה ואז על הפריט שמתאים לו בעמודה השנייה.</div>
                    <div class="match-container">
                        <div class="match-column">${leftHtml}</div>
                        <div class="match-column">${rightHtml}</div>
                    </div>
                    ${this.exerciseTip('match')}
                </div>
            `;
        }

        selectMatchItem(side, index) {
            if (this.exerciseAnswered) return;
            // Tapping an already-matched item releases that pair, so a wrong
            // pairing is never a dead end.
            const slot = side === 'left' ? 0 : 1;
            if (this.matchState.matches.some(m => m[slot] === index)) {
                this.unmatchPair(side, index);
                return;
            }

            this.sound.play('click');

            if (side === 'left') {
                document.querySelectorAll('.match-left').forEach(el => el.classList.remove('selected'));
                this.matchState.selectedLeft = index;
                document.querySelector(`.match-left[data-index="${index}"]`).classList.add('selected');
            } else {
                document.querySelectorAll('.match-right').forEach(el => el.classList.remove('selected'));
                this.matchState.selectedRight = index;
                document.querySelector(`.match-right[data-index="${index}"]`).classList.add('selected');
            }

            if (this.matchState.selectedLeft !== null && this.matchState.selectedRight !== null) {
                const channel = MATCH_CHANNELS[this.matchState.matches.length % MATCH_CHANNELS.length];
                this.matchState.matches.push([this.matchState.selectedLeft, this.matchState.selectedRight]);

                const leftEl = document.querySelector(`.match-left[data-index="${this.matchState.selectedLeft}"]`);
                const rightEl = document.querySelector(`.match-right[data-index="${this.matchState.selectedRight}"]`);
                [leftEl, rightEl].forEach(el => {
                    el.classList.remove('selected');
                    el.classList.add('matched');
                    el.style.borderColor = `rgb(var(${channel}))`;
                    el.style.background = `rgba(var(${channel}), 0.12)`;
                });

                this.matchState.selectedLeft = null;
                this.matchState.selectedRight = null;

                if (this.matchState.matches.length === this.matchState.pairs.length) this.enableCheckButton();
            }
        }

        unmatchPair(side, index) {
            const slot = side === 'left' ? 0 : 1;
            const pairIdx = this.matchState.matches.findIndex(m => m[slot] === index);
            if (pairIdx === -1) return;
            this.sound.play('click');
            const [leftIdx, rightIdx] = this.matchState.matches[pairIdx];
            this.matchState.matches.splice(pairIdx, 1);

            [['.match-left', leftIdx], ['.match-right', rightIdx]].forEach(([sel, idx]) => {
                const el = document.querySelector(`${sel}[data-index="${idx}"]`);
                if (!el) return;
                el.classList.remove('matched', 'selected');
                el.style.borderColor = '';
                el.style.background = '';
            });
            this.disableCheckButton();
        }

        checkMatchAnswer() {
            return this.matchState.matches.length === this.matchState.pairs.length
                && this.matchState.matches.every(([left, right]) => left === right);
        }

        showMatchFeedback(isCorrect) {
            document.querySelectorAll('.match-item').forEach(item => {
                item.style.borderColor = '';
                item.style.background = '';
                item.classList.add(isCorrect ? 'correct' : 'incorrect');
            });
        }

        // ═══════════════════════════════════════
        // Combo, speed bonus, second chance
        // ═══════════════════════════════════════
        getComboBonus(count) {
            if (count < 2) return 0;
            if (count === 2) return 2;
            if (count === 3) return 5;
            if (count === 4) return 8;
            return 12;  // 5+
        }

        getComboLabel(count) {
            if (count >= 5) return 'רצף של חמש';
            if (count === 4) return 'רצף של ארבע';
            if (count === 3) return 'רצף של שלוש';
            if (count === 2) return 'רצף';
            return '';
        }

        showComboPopup(count, bonus) {
            const popup = document.createElement('div');
            popup.className = 'combo-popup';
            const comboArt = count >= 5 ? 'combo-5' : (count >= 3 ? 'combo-3' : null);
            const mark = comboArt ? this.art(`feedback/${comboArt}.webp`, 'combo-art', 'fa-fire') : icon('fa-fire');
            popup.innerHTML = `<div class="combo-label">${this.getComboLabel(count)}</div><div class="combo-count"><span dir="ltr">x${count}</span> ${mark} <span dir="ltr">+${bonus} XP</span></div>`;
            document.body.appendChild(popup);
            setTimeout(() => popup.classList.add('show'), 50);
            setTimeout(() => {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 400);
            }, 1800);
        }

        showSpeedBonusPopup() {
            const popup = document.createElement('div');
            popup.className = 'speed-bonus-popup';
            popup.innerHTML = `${icon('fa-bolt')} <span dir="ltr">+5 XP</span> על מהירות`;
            document.body.appendChild(popup);
            setTimeout(() => popup.classList.add('show'), 50);
            setTimeout(() => {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 400);
            }, 1500);
        }

        showSecondChanceUI(exercise) {
            // Cross out the wrong pick
            const nodes = document.querySelectorAll(exercise.type === 'compare' ? '.compare-card' : '.option-btn');
            const picked = nodes[this.selectedAnswer];
            if (picked) {
                picked.classList.add('eliminated');
                picked.disabled = true;
            }

            this.selectedAnswer = null;
            document.querySelectorAll('.option-btn, .compare-card').forEach(el => el.classList.remove('selected'));
            this.disableCheckButton();

            const toast = document.createElement('div');
            toast.className = 'second-chance-toast';
            toast.setAttribute('role', 'status');
            toast.innerHTML = `${icon('fa-rotate-left')} ניסיון שני. נסו שוב`;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 50);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 400);
            }, 2000);

            this.sound.play('click');
        }

        // ═══════════════════════════════════════
        // Answer checking
        // ═══════════════════════════════════════
        checkAnswer() {
            if (this.exerciseAnswered) return;
            const exercise = this.currentLesson.exercises[this.currentExerciseIndex];
            if (!exercise) return;
            let isCorrect = false;

            // Step 1: correctness
            switch (exercise.type) {
                case 'multiple-choice':
                case 'scenario':
                case 'improve':
                case 'fill-blank':
                case 'compare':
                    if (this.selectedAnswer === null) return;
                    isCorrect = this.selectedAnswer === exercise.correct;
                    break;
                case 'order':
                    isCorrect = this.checkOrderAnswer(exercise);
                    break;
                case 'match':
                    isCorrect = this.checkMatchAnswer(exercise);
                    break;
            }

            // Step 2: second chance (choice-type questions only, first wrong attempt)
            const secondChanceTypes = ['multiple-choice', 'scenario', 'improve', 'compare'];
            if (!isCorrect && !this.secondChanceUsed && secondChanceTypes.includes(exercise.type)) {
                this.secondChanceUsed = true;
                this.comboCount = 0;    // a combo breaks on any mistake
                // A second chance forgives the heart, not the record: the miss
                // still counts for accuracy and rules out a "perfect lesson".
                this.playerData.totalWrongAnswers = (this.playerData.totalWrongAnswers || 0) + 1;
                this.lessonMistakes++;
                this.recordMiss();
                this.updateExerciseStats(false, this.currentModule.id);
                this.savePlayerData();
                this.showSecondChanceUI(exercise);
                return;
            }

            // Step 3: visual feedback on the exercise itself
            switch (exercise.type) {
                case 'multiple-choice':
                case 'scenario':
                case 'improve':
                    this.showMultipleChoiceFeedback(isCorrect, exercise);
                    break;
                case 'fill-blank': this.showFillBlankFeedback(isCorrect, exercise); break;
                case 'compare': this.showCompareFeedback(isCorrect, exercise); break;
                case 'order': this.showOrderFeedback(isCorrect); break;
                case 'match': this.showMatchFeedback(isCorrect); break;
            }

            this.exerciseAnswered = true;

            // Step 4: XP, combo, speed bonus, hearts
            if (isCorrect) {
                this.sound.play('correct');
                this.playerData.totalCorrectAnswers = (this.playerData.totalCorrectAnswers || 0) + 1;

                this.comboCount++;
                if (this.comboCount > this.maxCombo) this.maxCombo = this.comboCount;
                const comboBonus = this.getComboBonus(this.comboCount);

                const elapsed = (Date.now() - this.exerciseStartTime) / 1000;
                const speedBonus = elapsed < 10 ? 5 : 0;

                this.addXP(10 + comboBonus + speedBonus);
                this.createStarBurst();

                if (this.comboCount >= 2) this.showComboPopup(this.comboCount, comboBonus);
                if (speedBonus > 0) this.showSpeedBonusPopup();
                if (navigator.vibrate) navigator.vibrate(50);
            } else {
                this.sound.play('wrong');
                this.playerData.totalWrongAnswers = (this.playerData.totalWrongAnswers || 0) + 1;
                this.comboCount = 0;
                this.lessonMistakes++;
                this.recordMiss();
                this.loseHeart();
                if (navigator.vibrate) navigator.vibrate([100, 30, 100]);
            }

            this.updateExerciseStats(isCorrect, this.currentModule.id);
            this.showFeedback(isCorrect, exercise);
            this.savePlayerData();
        }

        // Remember which exercise was missed, for the sandbox. Bounded so the
        // save cannot grow without limit.
        recordMiss() {
            try {
                if (this.isFixture || !this.currentModule || !this.currentLesson) return;
                const key = this.lk(this.currentModule, this.currentLesson);
                const m = this.playerData.missed || (this.playerData.missed = {});
                const list = Array.isArray(m[key]) ? m[key] : [];
                if (!list.includes(this.currentExerciseIndex)) list.push(this.currentExerciseIndex);
                m[key] = list.slice(-10);
            } catch (e) { console.error('[game] recordMiss failed', e); }
        }

        checkOrderAnswer(exercise) {
            const currentOrder = [...document.querySelectorAll('.order-item')].map(item => parseInt(item.dataset.original, 10));
            return JSON.stringify(currentOrder) === JSON.stringify(exercise.correctOrder);
        }

        showMultipleChoiceFeedback(isCorrect, exercise) {
            document.querySelectorAll('.option-btn').forEach((btn, index) => {
                if (index === exercise.correct) btn.classList.add('correct');
                else if (index === this.selectedAnswer && !isCorrect) btn.classList.add('incorrect');
            });
        }

        showFillBlankFeedback(isCorrect, exercise) {
            const blankSlot = byId('blank-slot');
            if (blankSlot) blankSlot.classList.add(isCorrect ? 'correct' : 'incorrect');
            document.querySelectorAll('.word-chip').forEach(chip => {
                if (parseInt(chip.dataset.wordIndex, 10) === exercise.correct) chip.classList.add('correct');
                else if (chip.classList.contains('selected') && !isCorrect) chip.classList.add('incorrect');
            });
            // Show the correct word in the blank after a wrong pick. The timer id
            // is kept so continueToNext() can cancel it before the next exercise
            // mounts its own blank.
            if (!isCorrect && blankSlot) {
                this.fillBlankFeedbackTimeout = setTimeout(() => {
                    this.fillBlankFeedbackTimeout = null;
                    if (!document.body.contains(blankSlot)) return;
                    blankSlot.textContent = exercise.options[exercise.correct];
                    blankSlot.classList.remove('incorrect');
                    blankSlot.classList.add('correct');
                }, 800);
            }
        }

        showOrderFeedback(isCorrect) {
            document.querySelectorAll('.order-item').forEach(item => item.classList.add(isCorrect ? 'correct' : 'incorrect'));
        }

        // The link back to the video lesson an exercise is based on.
        lessonHref(lessonKey) {
            return `../index.html#lesson=${encodeURIComponent(lessonKey)}`;
        }

        sourceHtml(exercise) {
            const src = exercise && exercise.src;
            if (!src || !src.quote) return '';
            const key = src.lessonKey || (this.currentLesson && this.currentLesson.lessonKey) || '';
            // Inside the lesson page's practice tab (embed) the link must leave the frame.
            const target = this.isEmbed ? ' target="_top"' : '';
            const link = key ? `<a class="feedback-source-link" href="${this.lessonHref(key)}"${target}>לשיעור ${icon('fa-arrow-left')}</a>` : '';
            return `<div class="feedback-source">${icon('fa-quote-right', 'feedback-source-icon')}<div class="feedback-source-body"><span class="feedback-source-quote">מהשיעור: ״${esc(src.quote)}״</span>${link}</div></div>`;
        }

        showFeedback(isCorrect, exercise) {
            const panel = byId('feedback-panel');
            panel.className = `feedback-panel show ${isCorrect ? 'correct' : 'incorrect'}`;
            panel.scrollTop = 0;

            const titles = isCorrect
                ? ['נכון.', 'בדיוק כך.', 'יפה מאוד.', 'תשובה נכונה.']
                : ['לא מדויק.', 'עוד לא.', 'כמעט.'];
            byId('feedback-icon').innerHTML = this.art(`feedback/${isCorrect ? 'correct' : 'wrong'}.webp`, 'feedback-art', isCorrect ? 'fa-circle-check' : 'fa-circle-xmark');
            byId('feedback-title').textContent = titles[Math.floor(Math.random() * titles.length)];

            const explanation = exercise.explanation ? esc(exercise.explanation) : '';
            let html = '';

            // A wrong pick gets its own explanation, next to the correct answer.
            if (!isCorrect && Array.isArray(exercise.wrongExplanations) && this.selectedAnswer !== null) {
                const wrongExp = exercise.wrongExplanations[this.selectedAnswer];
                html += `<div class="wrong-answer-detail">`
                    + `<div class="feedback-answer-label">${icon('fa-xmark')} בחרתם:</div>`
                    + `<div class="feedback-answer-text">${esc(this.getSelectedAnswerText(exercise))}</div>`
                    + (wrongExp ? `<div class="feedback-answer-reason">${esc(wrongExp)}</div>` : '')
                    + `</div>`;
                html += `<div class="correct-answer-detail">`
                    + `<div class="feedback-answer-label">${icon('fa-check')} התשובה הנכונה:</div>`
                    + `<div class="feedback-answer-text">${esc(this.getCorrectAnswerText(exercise))}</div>`
                    + `</div>`;
                if (explanation) html += `<div class="feedback-general">${explanation}</div>`;
            } else {
                html = explanation ? `<div class="feedback-general">${explanation}</div>` : '';
            }
            html += this.sourceHtml(exercise);

            byId('feedback-explanation').innerHTML = html;
            byId('feedback-btn').textContent = 'המשך';

            if (isCorrect) {
                const streakEl = document.querySelector('.stat-item.streak');
                if (streakEl) {
                    streakEl.classList.add('streak-fire-pulse');
                    setTimeout(() => streakEl.classList.remove('streak-fire-pulse'), 500);
                }
            }

            this.hideFooter();
        }

        getSelectedAnswerText(exercise) {
            if (exercise.type === 'compare') return this.selectedAnswer === 0 ? exercise.optionA.text : exercise.optionB.text;
            if (exercise.options) return exercise.options[this.selectedAnswer];
            return '';
        }

        getCorrectAnswerText(exercise) {
            if (exercise.type === 'compare') return exercise.correct === 0 ? exercise.optionA.text : exercise.optionB.text;
            if (exercise.options) return exercise.options[exercise.correct];
            return '';
        }

        continueToNext() {
            // The panel keeps taking taps for the 0.35s it spends sliding away, and
            // "continue" is reachable from the button, a swipe down and ESC. Two
            // hits inside that window used to advance twice and skip an exercise.
            // Only the first one through counts.
            if (this._advancing) return;
            if (!this.exerciseAnswered) return;
            this._advancing = true;

            byId('feedback-panel').classList.remove('show');

            if (this.fillBlankFeedbackTimeout) {
                clearTimeout(this.fillBlankFeedbackTimeout);
                this.fillBlankFeedbackTimeout = null;
            }

            if (this.playerData.hearts <= 0) {
                this._advancing = false;
                this.showNoHeartsModal();
                return;
            }

            this.currentExerciseIndex++;

            // Every 4 exercises: a short reinforcement popup built from real numbers.
            this._reinforceCount = (this._reinforceCount || 0) + 1;
            const moreExercises = this.currentLesson && this.currentExerciseIndex < this.currentLesson.exercises.length;
            if (moreExercises && this._reinforceCount % 4 === 0) {
                this.showReinforcementPopup(() => setTimeout(() => this.renderExerciseSafe(), 100));
            } else {
                setTimeout(() => this.renderExerciseSafe(), 300);
            }
        }

        renderExerciseSafe() {
            try {
                window.scrollTo({ top: 0, behavior: 'instant' });
                this.renderExercise();
            } catch (e) {
                this.renderCrash('התרגיל הבא לא נטען.', e);
            }
        }

        // Every message is derived from a real number of this player. A message
        // appears only when the number behind it is real and meaningful.
        buildReinforcementMessages() {
            const pd = this.playerData;
            const totalAns = this.answersCount(pd);
            const lessonsDone = this.completedCount(pd);
            const msgs = [];
            if (totalAns >= 5) msgs.push({ icon: 'fa-bullseye', title: 'דיוק', text: `דייקתם ב-${this.accuracyPct(pd)}% מהתשובות עד עכשיו.` });
            if ((pd.xp || 0) > 0) msgs.push({ icon: 'fa-star', title: 'צוברים נקודות', text: `כבר ${pd.xp} XP. כל תרגיל מקרב לרמה הבאה.` });
            if ((pd.streak || 0) >= 2) msgs.push({ icon: 'fa-fire', title: 'רצף פעיל', text: `${pd.streak} ימים ברצף.` });
            if (lessonsDone >= 1) msgs.push({ icon: 'fa-book-open', title: 'מתקדמים', text: `${lessonsDone} שיעורים כבר הושלמו.` });
            if ((pd.perfectLessons || 0) >= 1) msgs.push({ icon: 'fa-gem', title: 'שיעורים מושלמים', text: `${pd.perfectLessons} שיעורים בלי אף טעות.` });
            if ((pd.longestStreak || 0) > (pd.streak || 0) && (pd.longestStreak || 0) >= 3) msgs.push({ icon: 'fa-trophy', title: 'שיא אישי', text: `השיא שלכם: ${pd.longestStreak} ימים ברצף.` });
            if ((pd.level || 1) >= 2) msgs.push({ icon: 'fa-rocket', title: 'הרמה עולה', text: `רמה ${pd.level}, ${this.getLevelName(pd.level)}. ההתמדה משתלמת.` });
            if (msgs.length === 0) msgs.push({ icon: 'fa-dumbbell', title: 'ממשיכים', text: 'עוד תרגיל מאחוריכם.' });
            return msgs;
        }

        showReinforcementPopup(onContinue) {
            const msgs = this.buildReinforcementMessages();
            let idx = Math.floor(Math.random() * msgs.length);
            if (msgs.length > 1 && idx === this._lastReinforceIdx) idx = (idx + 1) % msgs.length;
            this._lastReinforceIdx = idx;
            const m = msgs[idx];
            byId('modal-icon').innerHTML = icon(m.icon);
            byId('modal-title').textContent = m.title;
            byId('modal-text').textContent = m.text;
            byId('modal-buttons').innerHTML =
                `<button class="btn btn-primary btn-full" onclick="game.dismissReinforcement()">המשך ${icon('fa-arrow-left')}</button>`;
            this._modalKind = 'reinforce';
            this._reinforceContinue = (typeof onContinue === 'function') ? onContinue : null;
            byId('modal-overlay').classList.add('show');
        }

        dismissReinforcement() {
            byId('modal-overlay').classList.remove('show');
            const cb = this._reinforceContinue;
            this._reinforceContinue = null;
            if (typeof cb === 'function') cb();
        }

        // ═══════════════════════════════════════
        // Lesson completion
        // ═══════════════════════════════════════
        completeLesson() {
            const key = this.lk(this.currentModule, this.currentLesson);
            const firstTime = !this.playerData.completedLessons[key];
            this.inLesson = false;

            if (firstTime) {
                this.playerData.completedLessons[key] = true;
                this.addXP(50);

                if (this.lessonMistakes === 0) {
                    this.playerData.perfectLessons = (this.playerData.perfectLessons || 0) + 1;
                    if (!this.playerData.perfectLessonsList.includes(key)) this.playerData.perfectLessonsList.push(key);
                }
            }

            // The portal has ONE streak (home page, progress page): keep it alive from here too.
            try { if (!this.isFixture && window.BwcProgress) window.BwcProgress.recordActivityToday(); }
            catch (e) { console.error('[game] streak update failed', e); }
            this.recordLeague(this.lessonXP);
            this.savePlayerData();
            this.checkAchievements();
            this.showCompletionScreen(firstTime);
        }

        // Weekly league: same call shape as js/practice.js commitSessionStats,
        // recordRound(data, xp) where data.weekly is the week's bucket. The game
        // keeps its own bucket in its own save and never writes bwc_practice_v1;
        // the old practice game's XP of the same week is read and added so the
        // pushed total covers both games.
        recordLeague(xp) {
            const league = window.bwcLeague;
            if (this.isFixture || !league || typeof league.recordRound !== 'function') return;
            try {
                const weekStart = typeof league.weekStartJerusalem === 'function' ? league.weekStartJerusalem() : null;
                const mine = (this.playerData.weekly && this.playerData.weekly.weekStart === weekStart)
                    ? this.playerData.weekly
                    : { weekStart, xp: 0, days: [] };
                const old = readJSON(PRACTICE_KEY);
                const oldWeekly = (old && old.weekly && old.weekly.weekStart === weekStart) ? old.weekly : null;

                const data = {
                    weekly: {
                        weekStart,
                        xp: (mine.xp || 0) + (oldWeekly ? (oldWeekly.xp || 0) : 0),
                        days: Array.from(new Set([...(mine.days || []), ...((oldWeekly && oldWeekly.days) || [])]))
                    }
                };
                const earned = Math.max(0, Math.round(xp || 0));
                league.recordRound(data, earned);

                const today = this.ilDay();
                mine.xp = (mine.xp || 0) + earned;
                if (!mine.days.includes(today)) mine.days.push(today);
                this.playerData.weekly = mine;
            } catch (e) {
                console.warn('[game] league update failed', e);
            }
        }

        showCompletionScreen(firstTime) {
            this.hideProgressBar();
            this.hideFooter();
            this.createConfetti();
            this.sound.play('levelUp');

            // Primary CTA: next unfinished lesson in this module, else the next
            // open module, else the end of the path.
            const nextLesson = this.findNextLessonInCurrentModule();
            const nextModule = nextLesson ? null : this.findNextModule();
            let primaryCta;
            if (nextLesson) {
                primaryCta = `<button class="btn btn-primary btn-full" id="completion-next" onclick="game.transitionTo(function() { game.startLesson(${nextLesson.id}) })">
                        השיעור הבא: ${esc(nextLesson.title)} ${icon('fa-arrow-left')}
                    </button>`;
            } else if (nextModule) {
                primaryCta = `<button class="btn btn-primary btn-full" id="completion-next" onclick="game.transitionTo(function() { game.openModule(${nextModule.id}) })">
                        המודול הבא: ${esc(nextModule.title)} ${icon('fa-arrow-left')}
                    </button>`;
            } else {
                primaryCta = `<button class="btn btn-primary btn-full" id="completion-next" onclick="game.transitionTo(function() { game.renderHomeScreen() })">
                        ${icon('fa-trophy')} השלמתם את כל השיעורים הזמינים
                    </button>`;
            }

            // Finishing a whole module is a bigger moment than finishing a lesson.
            const moduleDone = !nextLesson;
            const total = this.currentLesson.exercises.length;
            const completionArt = moduleDone
                ? this.art('screens/module-complete.webp', 'completion-icon-img', 'fa-trophy')
                : this.art('screens/lesson-complete.webp', 'completion-icon-img', 'fa-circle-check');
            const subtitle = moduleDone
                ? `השלמתם את המודול "${esc(this.currentModule.title)}"`
                : `השלמתם את השיעור "${esc(this.currentLesson.title)}"`;
            const top = this.isEmbed ? ' target="_top"' : '';
            const key = this.currentLesson.lessonKey;

            byId('game-container').innerHTML = `
                <div class="completion-screen">
                    <div class="completion-icon">${completionArt}</div>
                    <div class="completion-title">כל הכבוד</div>
                    <div class="completion-subtitle">${subtitle}</div>
                    ${this.lessonMistakes === 0 ? `<div class="completion-perfect">${icon('fa-star')} בלי אף טעות</div>` : ''}
                    <div class="completion-stats">
                        <div class="completion-stat">
                            <div class="completion-stat-value" dir="ltr">+${this.lessonXP}</div>
                            <div class="completion-stat-label">XP</div>
                        </div>
                        <div class="completion-stat">
                            <div class="completion-stat-value" dir="ltr">${Math.max(0, total - this.lessonMistakes)}/${total}</div>
                            <div class="completion-stat-label">בלי טעות</div>
                        </div>
                        <div class="completion-stat">
                            <div class="completion-stat-value">${this.playerData.streak}</div>
                            <div class="completion-stat-label">ימים ברצף</div>
                        </div>
                    </div>
                    ${firstTime ? '' : '<div class="completion-note">שיעור חוזר. הבונוס על השלמה ניתן פעם אחת.</div>'}
                    ${primaryCta}
                    <button class="btn btn-secondary btn-full completion-secondary" onclick="game.transitionTo(function() { game.renderHomeScreen() })">
                        חזרה למסלול
                    </button>
                    ${key && !this.isFixture ? `<a class="completion-lesson-link" href="${this.lessonHref(key)}"${top}>${icon('fa-circle-play')} לצפייה בשיעור</a>` : ''}
                </div>
            `;
        }

        findNextLessonInCurrentModule() {
            if (!this.currentModule || !this.currentModule.lessons) return null;
            return this.currentModule.lessons.find(l => !this.isLessonDone(this.currentModule, l)) || null;
        }

        findNextModule() {
            const startIdx = this.currentModule ? this.modules.findIndex(m => m.id === this.currentModule.id) + 1 : 0;
            for (let i = startIdx; i < this.modules.length; i++) {
                if (this.isModuleLocked(i)) continue;
                const mod = this.modules[i];
                if (mod.lessons.some(l => !this.isLessonDone(mod, l))) return mod;
            }
            return null;
        }

        // ═══════════════════════════════════════
        // Confetti
        // ═══════════════════════════════════════
        confettiColors() {
            return ['rgb(var(--brand-rgb))', 'rgb(var(--brand-hi-rgb))', 'rgb(var(--brand2-rgb))', 'rgb(var(--brand2-hi-rgb))', 'rgb(var(--accent-rgb))', 'rgb(var(--g-ok-rgb))'];
        }

        createConfetti() {
            const container = document.createElement('div');
            container.className = 'confetti-container';
            container.setAttribute('aria-hidden', 'true');
            document.body.appendChild(container);

            const colors = this.confettiColors();
            const shapes = ['square', 'circle', 'star'];

            for (let i = 0; i < 80; i++) {
                const confetti = document.createElement('div');
                const shape = shapes[Math.floor(Math.random() * shapes.length)];
                const size = 6 + Math.random() * 8;

                confetti.style.position = 'absolute';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.width = size + 'px';
                confetti.style.height = size + 'px';
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];

                if (shape === 'circle') {
                    confetti.className = 'confetti-circle';
                } else if (shape === 'star') {
                    confetti.className = 'confetti';
                    confetti.style.clipPath = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
                } else {
                    confetti.className = 'confetti';
                    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
                }

                confetti.style.animation = `confettiSway ${2 + Math.random() * 2}s ease-out forwards`;
                confetti.style.animationDelay = Math.random() * 1.5 + 's';
                container.appendChild(confetti);
            }

            setTimeout(() => container.remove(), 5000);
        }

        // ═══════════════════════════════════════
        // XP & hearts
        // ═══════════════════════════════════════
        addXP(amount) {
            const oldXP = this.playerData.xp;
            const oldLevel = this.playerData.level;
            this.playerData.xp += amount;
            this.lessonXP += amount;
            this.playerData.level = this.calculateLevel();
            this.savePlayerData();
            this.showXPPopup(amount);

            const xpEl = byId('xp-value');
            if (xpEl) this.animateCountUp(xpEl, oldXP, this.playerData.xp, 500);
            byId('streak-value').textContent = this.practiceDays();
            this.renderHearts();

            if (this.playerData.level > oldLevel) this.showLevelUpCelebration(this.playerData.level);
            this.checkAchievements();
        }

        showXPPopup(amount) {
            const xpStat = document.querySelector('.stat-item.xp');
            const popup = document.createElement('div');
            popup.setAttribute('dir', 'ltr');
            popup.textContent = `+${amount} XP`;
            if (xpStat) {
                const rect = xpStat.getBoundingClientRect();
                popup.className = 'xp-float';
                popup.style.left = rect.left + rect.width / 2 + 'px';
                popup.style.top = rect.bottom + 'px';
                document.body.appendChild(popup);
                setTimeout(() => popup.remove(), 1200);
            } else {
                popup.className = 'xp-popup';
                document.body.appendChild(popup);
                setTimeout(() => popup.remove(), 1000);
            }
        }

        loseHeart() {
            if (this.playerData.hearts <= 0) return;
            this.playerData.hearts--;
            if (!this.playerData.lastHeartLost || this.playerData.hearts === this.playerData.maxHearts - 1) {
                this.playerData.lastHeartLost = new Date().toISOString();
            }
            this.savePlayerData();
            this.updateStatsDisplay();

            const container = byId('hearts-container');
            if (container) {
                container.classList.add('losing');
                setTimeout(() => container.classList.remove('losing'), 500);
            }
        }

        // ═══════════════════════════════════════
        // Modals
        // ═══════════════════════════════════════
        showNoHeartsModal() {
            this._modalKind = 'no-hearts';
            byId('modal-icon').innerHTML = this.art('screens/no-hearts.webp', 'modal-art', 'fa-heart-crack');
            byId('modal-title').textContent = 'נגמרו הלבבות';
            byId('modal-text').textContent = 'טעויות הן חלק מהלמידה. אפשר לעצור ולחזור אחר כך, או למלא את הלבבות ולהמשיך לתרגל.';
            byId('modal-buttons').innerHTML = `
                <button class="btn btn-secondary" onclick="game.closeModal()">חזרה למסלול</button>
                <button class="btn btn-primary" id="refill-btn" onclick="game.refillHearts()">${icon('fa-heart')} מלאו והמשיכו</button>
            `;
            byId('modal-overlay').classList.add('show');
        }

        closeModal() {
            byId('modal-overlay').classList.remove('show');
            byId('feedback-panel').classList.remove('show');
            this._reinforceContinue = null;
            this._pendingLessonId = null;
            this.clearReadingScroll();
            this.transitionTo(() => this.renderHomeScreen());
        }

        // Free refill. The learner then carries on from exactly where the hearts
        // ran out: the next exercise, or the lesson they were about to open.
        refillHearts() {
            this.playerData.hearts = this.playerData.maxHearts;
            this.playerData.lastHeartLost = null;
            this.savePlayerData();
            this.updateStatsDisplay();
            byId('modal-overlay').classList.remove('show');

            if (this._pendingLessonId !== null && this._pendingLessonId !== undefined && this.currentModule) {
                const id = this._pendingLessonId;
                this._pendingLessonId = null;
                this.startLesson(id);
            } else if (this.inLesson && this.exerciseAnswered) {
                this.continueToNext();
            }
        }

        exitLesson() {
            this._modalKind = 'exit-confirm';
            byId('modal-icon').innerHTML = icon('fa-door-open');
            byId('modal-title').textContent = 'לצאת מהשיעור?';
            byId('modal-text').textContent = 'ההתקדמות בשיעור הזה לא תישמר. ה-XP שצברתם נשאר אצלכם.';
            byId('modal-buttons').innerHTML = `
                <button class="btn btn-secondary" onclick="game.closeModalAndStay()">נשארים</button>
                <button class="btn btn-danger" id="confirm-exit-btn" onclick="game.confirmExit()">יוצאים</button>
            `;
            byId('modal-overlay').classList.add('show');
        }

        closeModalAndStay() {
            byId('modal-overlay').classList.remove('show');
            // Dismissing the no-hearts dialog mid-lesson leaves the answered
            // exercise on screen. Bring the feedback back so "continue" is there.
            if (this._modalKind === 'no-hearts' && this.inLesson && this.exerciseAnswered) {
                byId('feedback-panel').classList.add('show');
            }
        }

        confirmExit() {
            byId('modal-overlay').classList.remove('show');
            byId('feedback-panel').classList.remove('show');
            this.clearReadingScroll();
            document.querySelectorAll('.term-tooltip').forEach(t => t.remove());
            this.inLesson = false;
            this.transitionTo(() => this.openModule(this.currentModule.id));
        }

        // ═══════════════════════════════════════
        // Stats tracking
        // ═══════════════════════════════════════
        updateExerciseStats(isCorrect, moduleId) {
            // weeklyActivity is the practice ledger the streak is derived from,
            // keyed by ISRAEL day.
            const today = this.ilDay();
            if (!this.playerData.weeklyActivity) this.playerData.weeklyActivity = {};
            this.playerData.weeklyActivity[today] = (this.playerData.weeklyActivity[today] || 0) + 1;

            // Answering is what earns the day.
            const before = this.playerData.streak;
            this.recomputeStreak({ silent: true });
            if (this.playerData.streak !== before) {
                try { this.updateStatsDisplay(); } catch (e) { console.error('[game] stats display update failed', e); }
            }

            if (!this.playerData.moduleAccuracy) this.playerData.moduleAccuracy = {};
            if (!this.playerData.moduleAccuracy[moduleId]) this.playerData.moduleAccuracy[moduleId] = { correct: 0, total: 0 };
            this.playerData.moduleAccuracy[moduleId].total++;
            if (isCorrect) this.playerData.moduleAccuracy[moduleId].correct++;
        }

        // ═══════════════════════════════════════
        // Stats screen
        // ═══════════════════════════════════════
        renderStatsScreen() {
            this.currentScreen = 'stats';
            this.inLesson = false;
            document.body.classList.remove('game-fullscreen');
            this.updateBottomNav('stats');
            const pd = this.playerData;

            const doneLessons = this.completedInData(pd);
            const totalLessons = this.totalLessons();
            const longestStreak = pd.longestStreak || pd.streak || 0;

            // Last 7 days, read with the same key the ledger is written with.
            const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
            const todayKey = this.ilDay();
            const weekData = [];
            let maxActivity = 1;
            for (let i = 6; i >= 0; i--) {
                const key = this.shiftDay(todayKey, -i);
                const [ky, km, kd] = key.split('-').map(Number);
                const count = (pd.weeklyActivity && pd.weeklyActivity[key]) || 0;
                if (count > maxActivity) maxActivity = count;
                weekData.push({ day: dayNames[new Date(ky, km - 1, kd, 12).getDay()], count, key });
            }

            const weeklyBarsHtml = weekData.map(w => {
                const height = Math.max(4, (w.count / maxActivity) * 100);
                return `
                    <div class="weekly-bar-wrapper">
                        <div class="weekly-bar ${w.key === todayKey ? 'today' : ''}" style="height: ${height}%">
                            <span class="weekly-bar-count">${w.count || ''}</span>
                        </div>
                        <div class="weekly-label">${w.day}</div>
                    </div>
                `;
            }).join('');

            const moduleAccuracyHtml = this.modules.map(m => {
                const acc = pd.moduleAccuracy && pd.moduleAccuracy[m.id];
                const name = `<span class="accuracy-module-name">${icon(m.icon || 'fa-layer-group')} ${esc(m.title)}</span>`;
                if (!acc || !acc.total) {
                    return `<div class="accuracy-row">${name}
                            <div class="accuracy-bar-wrapper"><div class="accuracy-bar" style="width: 0%"></div></div>
                            <span class="accuracy-percent">--</span></div>`;
                }
                const pct = Math.round((acc.correct / acc.total) * 100);
                const tone = pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low';
                return `<div class="accuracy-row">${name}
                        <div class="accuracy-bar-wrapper"><div class="accuracy-bar accuracy-bar--${tone}" style="width: ${pct}%"></div></div>
                        <span class="accuracy-percent">${pct}%</span></div>`;
            }).join('');

            const perfectList = pd.perfectLessonsList || [];
            const perfectItems = perfectList.map(key => {
                const hit = this.lessonIndex[key];
                return hit ? `<div class="perfect-lesson-item">${icon('fa-star')} ${esc(hit.lesson.title)}</div>` : '';
            }).join('');
            const perfectHtml = perfectItems || '<div class="perfect-lesson-empty">עדיין אין שיעורים מושלמים. סיימו שיעור בלי אף טעות.</div>';

            const accuracyPct = this.accuracyPct(pd);
            const levelInfo = this.getLevelProgressInfo();
            const xpHint = levelInfo.isMax ? 'הרמה הגבוהה ביותר' : `עוד ${levelInfo.xpToNext} XP לרמה ${(pd.level || 1) + 1}`;
            const practiceDays = this.practiceDays();
            const practiceHint = practiceDays === 0 ? 'התרגיל הראשון פותח את המונה'
                : practiceDays === 1 ? 'יום אחד על הלוח. השני הוא הקשה ביותר'
                : 'ימים שבהם באמת תרגלתם';
            const streakHint = pd.streak === 0
                ? (longestStreak > 0 ? `השיא שלכם: ${longestStreak} ימים ברצף` : 'תרגיל אחד היום פותח רצף')
                : (longestStreak > pd.streak ? `השיא שלכם: ${longestStreak} ימים ברצף` : 'זה השיא שלכם. תרגיל אחד מחר ישבור אותו');
            const lessonsHint = doneLessons === 0 ? 'השלימו שיעור ראשון כדי להתחיל' : `${doneLessons}/${totalLessons} שיעורים הושלמו`;

            byId('game-container').innerHTML = `
                <div class="stats-screen">
                    <button class="back-btn" onclick="game.navTo('home')">${icon('fa-arrow-right')} חזרה</button>
                    <h2 class="stats-title">${icon('fa-chart-simple')} הסטטיסטיקות שלי</h2>

                    <div class="stats-cards">
                        <div class="stats-card">
                            <div class="stats-card-value">${pd.xp}</div>
                            <div class="stats-card-label">${icon('fa-star')} סך הכול XP</div>
                            <div class="stats-card-hint">${xpHint}</div>
                        </div>
                        <div class="stats-card">
                            <div class="stats-card-value">${practiceDays}</div>
                            <div class="stats-card-label">${icon('fa-calendar-check')} ימי תרגול</div>
                            <div class="stats-card-hint">${practiceHint}</div>
                        </div>
                        <div class="stats-card">
                            <div class="stats-card-value">${pd.streak}</div>
                            <div class="stats-card-label">${icon('fa-fire')} רצף נוכחי</div>
                            <div class="stats-card-hint">${streakHint}</div>
                        </div>
                        <div class="stats-card">
                            <div class="stats-card-value">${doneLessons}</div>
                            <div class="stats-card-label">${icon('fa-book-open')} שיעורים</div>
                            <div class="stats-card-hint">${lessonsHint}</div>
                        </div>
                    </div>

                    <div class="stats-section">
                        <div class="stats-section-title">${icon('fa-calendar-week')} תשובות בשבוע האחרון</div>
                        <div class="weekly-chart">${weeklyBarsHtml}</div>
                    </div>

                    <div class="stats-section">
                        <div class="stats-section-title">${icon('fa-bullseye')} דיוק כללי: ${accuracyPct}%</div>
                        <div class="stats-section-sub">${pd.totalCorrectAnswers || 0} נכונות, ${pd.totalWrongAnswers || 0} שגויות</div>
                    </div>

                    <div class="stats-section">
                        <div class="stats-section-title">${icon('fa-layer-group')} דיוק לפי מודול</div>
                        <div class="module-accuracy">${moduleAccuracyHtml}</div>
                    </div>

                    <div class="stats-section">
                        <div class="stats-section-title">${icon('fa-star')} שיעורים מושלמים</div>
                        <div class="perfect-lessons">${perfectHtml}</div>
                    </div>
                </div>
            `;

            this.hideProgressBar();
            this.hideFooter();
        }

        // ═══════════════════════════════════════
        // Animations
        // ═══════════════════════════════════════
        createStarBurst() {
            const container = document.createElement('div');
            container.className = 'star-burst-container';
            container.setAttribute('aria-hidden', 'true');
            document.body.appendChild(container);

            for (let i = 0; i < 10; i++) {
                const star = document.createElement('div');
                star.className = 'star-particle';
                star.innerHTML = icon('fa-star');
                star.style.setProperty('--angle', (i / 10) * 360 + 'deg');
                star.style.setProperty('--distance', (60 + Math.random() * 80) + 'px');
                star.style.animationDelay = (Math.random() * 0.1) + 's';
                container.appendChild(star);
            }
            setTimeout(() => container.remove(), 800);
        }

        animateCountUp(el, from, to, duration = 500) {
            const start = performance.now();
            const diff = to - from;
            const token = (this._countToken = (this._countToken || 0) + 1);
            const animate = (now) => {
                if (token !== this._countToken) return;     // a newer count-up took over
                const progress = Math.min((now - start) / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                el.textContent = Math.round(from + diff * eased);
                if (progress < 1) requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        }

        showLevelUpCelebration(level) {
            const overlay = byId('level-up-overlay');
            const text = byId('level-up-text');
            if (!overlay || !text) return;
            text.innerHTML = `
                <div class="level-up-art-wrap">${this.art(`levels/level-${level}.webp`, 'level-up-img', 'fa-ranking-star')}</div>
                <div class="level-up-heading">עליתם לרמה ${level}</div>
                <div class="level-up-name">${esc(this.getLevelName(level))}</div>
            `;
            overlay.style.display = 'flex';
            overlay.classList.add('party-mode');

            document.body.classList.add('screen-shake');
            setTimeout(() => document.body.classList.remove('screen-shake'), 600);

            const confettiContainer = document.createElement('div');
            confettiContainer.className = 'confetti-container';
            confettiContainer.setAttribute('aria-hidden', 'true');
            overlay.appendChild(confettiContainer);
            const colors = this.confettiColors();
            for (let i = 0; i < 100; i++) {
                const c = document.createElement('div');
                c.className = 'confetti-particle';
                c.style.left = Math.random() * 100 + '%';
                c.style.background = colors[Math.floor(Math.random() * colors.length)];
                c.style.animationDelay = Math.random() * 1.5 + 's';
                c.style.animationDuration = (2 + Math.random() * 2) + 's';
                const size = 6 + Math.random() * 6;
                c.style.width = size + 'px';
                c.style.height = size + 'px';
                if (Math.random() > 0.5) c.style.borderRadius = '50%';
                confettiContainer.appendChild(c);
            }

            this.sound.play('levelUp');

            let done = false;
            const dismiss = () => {
                if (done) return;
                done = true;
                overlay.style.display = 'none';
                overlay.classList.remove('party-mode');
                confettiContainer.remove();
                overlay.removeEventListener('click', dismiss);
            };
            overlay.addEventListener('click', dismiss);
            setTimeout(dismiss, 3500);
        }

        // ═══════════════════════════════════════
        // Utilities & UI helpers
        // ═══════════════════════════════════════
        shuffleArray(array) {
            const a = [...array];
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }

        showProgressBar() { byId('progress-container').style.display = 'block'; }
        hideProgressBar() { byId('progress-container').style.display = 'none'; }

        updateProgressBar() {
            if (!this.currentLesson) return;
            const hasReading = this.currentLesson.reading ? 1 : 0;
            const total = this.currentLesson.exercises.length + hasReading;
            const current = this.currentExerciseIndex + (this.currentScreen !== 'reading' ? hasReading : 0);
            const pct = total > 0 ? (current / total) * 100 : 0;
            byId('progress-bar').style.width = pct + '%';
            const wrap = byId('progress-container');
            wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
        }

        showFooter() {
            byId('footer-actions').style.display = 'block';
            this.disableCheckButton();
        }

        hideFooter() { byId('footer-actions').style.display = 'none'; }
        enableCheckButton() { byId('check-btn').disabled = false; }
        disableCheckButton() { byId('check-btn').disabled = true; }
    }

    // ═══════════════════════════════════════
    // Start
    // ═══════════════════════════════════════
    function start() {
        if (window.game) return;
        const game = new BwcGame();
        window.game = game;
        game.boot().catch((e) => {
            console.error('[game] boot failed', e);
            const loading = byId('loading-screen');
            if (loading) {
                loading.style.display = 'flex';
                loading.innerHTML = '<div class="load-failed"><p class="load-failed-title">המשחק לא נטען.</p>'
                    + '<p class="load-failed-text">נסו לרענן את הדף.</p>'
                    + '<button class="btn btn-primary" onclick="window.location.reload()">רענון</button></div>';
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
