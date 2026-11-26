/* ==========================================================================
   game-joker.js — the Joker: the AI part of the practice game.

     * level 3 ("שליטה"): three open tasks per lesson, judged by the Joker
         explain   one answer, scored against the lesson
         roleplay  a short conversation, the Joker plays a character
         apply     one answer about the learner's own business
     * a hint on any level 1 / level 2 exercise (never the answer itself)
     * a "surprise round": six fresh exercises built from the lesson's own
       verified quotes

   Server: POST /api/game-coach (see the header of that file for the
   contract). The server owns the rubric, the pass rule, the turn limit and
   the daily cap; this file only shows what comes back. Signed-in learners
   only. The GitHub Pages mirror has no /api, so the Joker is hidden there.

   Loaded AFTER js/game.js. The engine calls window.BwcJoker and works
   without it (levels 1 and 2 only). Styles: css/game-joker.css.
   ========================================================================== */
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.BwcJoker) return;

    var XP_PER_TASK = 20;
    var MIN_WORDS = 15;
    var ROLEPLAY_TURNS = 4;
    var KINDS = {
        explain: { label: 'הסבירו במילים שלכם', icon: 'fa-comment-dots', placeholder: 'כתבו כאן את ההסבר שלכם, עם דוגמה אחת...' },
        roleplay: { label: 'שיחה מול דמות', icon: 'fa-masks-theater', placeholder: 'מה אתם עונים?' },
        apply: { label: 'על העסק שלכם', icon: 'fa-briefcase', placeholder: 'כתבו כאן איך זה נראה אצלכם בעסק...' }
    };
    var REASONS = {
        answer_too_short: 'התשובה קצרה מדי. כתבו לפחות כמה משפטים.',
        answer_too_long: 'התשובה ארוכה מדי. קצרו אותה ונסו שוב.',
        daily_cap: 'הגעתם למכסה היומית של הג\'וקר. היא מתחדשת מחר.',
        game_ai_disabled: 'הג\'וקר עוד לא הופעל בפורטל.',
        judge_parse_failed: 'הג\'וקר לא הצליח לנסח משוב. נסו לשלוח שוב.',
        surprise_failed: 'הג\'וקר לא הצליח להרכיב סיבוב מהשיעור הזה. נסו שוב.',
        all_providers_failed: 'הג\'וקר לא זמין כרגע. נסו שוב בעוד רגע.',
        exercise_over: 'השיחה הזאת כבר הסתיימה.',
        unauthorized: 'צריך להתחבר כדי לשחק מול הג\'וקר.',
        network: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.'
    };

    var hintCache = {};     // "<key>|<level>|<index>" -> hint text, this page session
    var room = null;        // level 3 state

    function g() { return window.game; }
    function esc(s) { return g().ui.esc(s); }
    function icon(n, x) { return g().ui.icon(n, x); }
    function byId(id) { return document.getElementById(id); }
    function words(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

    // No serverless functions on the static mirror.
    function available() {
        try { return !/\.github\.io$/i.test(window.location.hostname); } catch (e) { return true; }
    }

    function apiBase() { return typeof window.BWC_GAME_API === 'string' ? window.BWC_GAME_API : ''; }

    async function token() {
        try {
            var r = await window.bwcSupabase.auth.getSession();
            return r.data.session.access_token;
        } catch (e) { return null; }
    }

    // Always resolves: { ok, ...data } or { ok:false, reason }.
    async function call(body) {
        try {
            var t = await token();
            if (!t) return { ok: false, reason: 'unauthorized' };
            var res = await fetch(apiBase() + '/api/game-coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
                body: JSON.stringify(body)
            });
            var data = null;
            try { data = await res.json(); } catch (e) { /* not JSON */ }
            if (data && data.ok) return data;
            if (res.status === 401) return { ok: false, reason: 'unauthorized' };
            return { ok: false, reason: (data && data.reason) || 'all_providers_failed' };
        } catch (e) {
            return { ok: false, reason: 'network' };
        }
    }

    function say(reason) { return REASONS[reason] || 'משהו השתבש. נסו שוב.'; }

    function needLogin() {
        var game = g();
        if (!game.isGuest) return false;
        game.showToast('צריך להתחבר כדי לשחק מול הג\'וקר.', 3500);
        game.openLogin();
        return true;
    }

    // ───────────────────────── hint ─────────────────────────
    function hintButton(game, lessonKey, level, index) {
        if (!available()) return '';
        var id = lessonKey + '|' + level + '|' + index;
        var have = hintCache[id];
        return '<div class="joker-hint" data-hint="' + esc(id) + '">'
            + '<button type="button" class="joker-hint-btn" onclick="BwcJoker.hint(this)"' + (have ? ' hidden' : '') + '>'
            + icon('fa-hat-wizard') + ' רמז מהג\'וקר</button>'
            + '<div class="joker-hint-text" role="status"' + (have ? '' : ' hidden') + '>' + (have ? icon('fa-hat-wizard') + ' ' + esc(have) : '') + '</div>'
            + '</div>';
    }

    async function hint(btn) {
        var game = g();
        var box = btn && btn.closest('.joker-hint');
        if (!box || game.exerciseAnswered) return;
        if (needLogin()) return;
        var id = box.getAttribute('data-hint');
        var p = id.split('|');
        var out = box.querySelector('.joker-hint-text');
        btn.disabled = true;
        btn.innerHTML = icon('fa-spinner', 'fa-spin') + ' הג\'וקר חושב...';
        var r = await call({ mode: 'hint', lessonKey: p[0], level: Number(p[1]), index: Number(p[2]) });
        // Keep a paid-for hint even if the exercise was redrawn meanwhile: the
        // redraw reads it from the cache.
        if (r.ok) hintCache[id] = String(r.hint || '');
        if (!document.body.contains(box)) {
            var fresh = document.querySelector('.joker-hint[data-hint="' + id + '"]');
            if (r.ok && fresh) {
                fresh.querySelector('.joker-hint-btn').hidden = true;
                var ft = fresh.querySelector('.joker-hint-text');
                ft.hidden = false;
                ft.innerHTML = icon('fa-hat-wizard') + ' ' + esc(hintCache[id]);
            }
            return;
        }
        if (!r.ok) {
            btn.disabled = false;
            btn.innerHTML = icon('fa-hat-wizard') + ' רמז מהג\'וקר';
            game.showToast(say(r.reason), 4000);
            if (r.reason === 'daily_cap') btn.hidden = true;
            return;
        }
        btn.hidden = true;
        out.hidden = false;
        out.innerHTML = icon('fa-hat-wizard') + ' ' + esc(hintCache[id])
            + (typeof r.remaining === 'number' ? '<span class="joker-hint-left">נשארו היום ' + r.remaining + ' רמזים</span>' : '');
    }

    // ─────────────────────── surprise round ───────────────────────
    async function startSurprise(game) {
        if (!available()) { game.showToast('הג\'וקר לא זמין בכתובת הזאת.', 3500); return; }
        if (needLogin()) return;
        var mod = game.currentModule, lesson = game.currentLesson;
        if (!mod || !lesson) return;
        byId('game-container').innerHTML =
            '<div class="joker-wait" role="status">' + icon('fa-hat-wizard', 'joker-wait-icon')
            + '<div class="joker-wait-title">הג\'וקר מרכיב סיבוב הפתעה</div>'
            + '<div class="joker-wait-text">שישה תרגילים חדשים מתוך "' + esc(lesson.title) + '". זה לוקח כמה שניות.</div></div>';
        var r = await call({ mode: 'surprise', lessonKey: game.lk(mod, lesson) });
        if (game.currentLesson !== lesson || game.inLesson) return;
        if (!r.ok || !Array.isArray(r.exercises) || !game.playSurpriseRound(r.exercises)) {
            game.showToast(say(r.ok ? 'surprise_failed' : r.reason), 4500);
            game.currentScreen = 'levels';
            game.renderLevelScreen();
        }
    }

    // ───────────────────────── level 3 ─────────────────────────
    function storeKey() {
        var owner = (g().playerData && g().playerData.ownerId) || 'guest';
        return 'bwc_game_l3_' + owner + '_' + room.key;
    }

    function loadPassed() {
        try {
            var v = JSON.parse(localStorage.getItem(storeKey()) || 'null');
            if (Array.isArray(v) && v.length === 3) return v.map(Boolean);
        } catch (e) { /* storage blocked */ }
        return [false, false, false];
    }

    function savePassed() {
        try { localStorage.setItem(storeKey(), JSON.stringify(room.passed)); } catch (e) { /* storage blocked */ }
    }

    function startLevel3(game, mod, lesson, tasks) {
        game.currentScreen = 'joker';
        game.inLesson = false;
        game.hideProgressBar();
        game.hideFooter();
        room = { game: game, mod: mod, lesson: lesson, key: game.lk(mod, lesson), tasks: tasks || [], i: 0, passed: [false, false, false], history: [], result: null, busy: false, finished: false };
        room.passed = loadPassed();
        // Level already earned: every task is open for replay from the first.
        var firstOpen = room.passed.indexOf(false);
        room.i = firstOpen === -1 ? 0 : firstOpen;
        game.transitionTo(render);
    }

    function leave() {
        var game = g();
        var lesson = room && room.lesson;
        room = null;
        if (!lesson) { game.transitionTo(function () { game.renderHomeScreen(); }); return; }
        game.currentLesson = lesson;
        game.currentScreen = 'levels';
        game.transitionTo(function () { game.renderLevelScreen(); });
    }

    function stepsHtml() {
        return '<div class="joker-steps" role="list">' + room.tasks.map(function (t, i) {
            var k = KINDS[t.kind] || KINDS.explain;
            var state = room.passed[i] ? 'done' : (i === room.i ? 'now' : '');
            return '<button type="button" role="listitem" class="joker-step ' + state + '" onclick="BwcJoker.go(' + i + ')"'
                + ' aria-label="משימה ' + (i + 1) + ': ' + esc(k.label) + (room.passed[i] ? ', הושלמה' : '') + '">'
                + '<span class="joker-step-num">' + (room.passed[i] ? icon('fa-check') : (i + 1)) + '</span>'
                + '<span class="joker-step-name">' + esc(k.label) + '</span></button>';
        }).join('') + '</div>';
    }

    function resultHtml(r) {
        var rows = (r.criteria || []).map(function (c) {
            var mark = c.score >= 2 ? ['fa-circle-check', 'full'] : (c.score === 1 ? ['fa-circle-half-stroke', 'half'] : ['fa-circle-xmark', 'none']);
            return '<li class="joker-crit ' + mark[1] + '">' + icon(mark[0]) + '<span>' + esc(c.text) + '</span></li>';
        }).join('');
        return '<div class="joker-result ' + (r.passed ? 'pass' : 'fail') + '" role="status">'
            + '<div class="joker-result-head">' + icon(r.passed ? 'fa-circle-check' : 'fa-rotate-left')
            + '<span>' + (r.passed ? 'עברתם את המשימה' : 'עוד לא. נסו שוב') + '</span>'
            + '<span class="joker-result-score" dir="ltr">' + Number(r.score || 0) + '/' + Number(r.max || 6) + '</span></div>'
            + (rows ? '<ul class="joker-crits">' + rows + '</ul>' : '')
            + (r.good ? '<div class="joker-note good"><strong>מה עבד:</strong> ' + esc(r.good) + '</div>' : '')
            + (r.fix ? '<div class="joker-note fix"><strong>מה לחזק:</strong> ' + esc(r.fix) + '</div>' : '')
            + '</div>';
    }

    function render() {
        var game = g();
        if (!room) return;
        var c = byId('game-container');
        var head = '<button class="back-btn" onclick="BwcJoker.leave()">' + icon('fa-arrow-right') + ' חזרה</button>';

        if (!room.tasks.length) {
            c.innerHTML = head + '<div class="joker-room"><div class="joker-gate">' + icon('fa-hat-wizard', 'joker-gate-icon')
                + '<div class="joker-gate-title">רמה 3 עוד לא מוכנה לשיעור הזה</div></div></div>';
            return;
        }
        if (!available() || game.isGuest) {
            c.innerHTML = head + '<div class="joker-room"><div class="joker-gate">' + icon('fa-hat-wizard', 'joker-gate-icon')
                + '<div class="joker-gate-title">' + (game.isGuest ? 'רמה 3 משחקים מול הג\'וקר' : 'הג\'וקר לא זמין בכתובת הזאת') + '</div>'
                + '<div class="joker-gate-text">' + (game.isGuest
                    ? 'הג\'וקר קורא את התשובות שלכם ונותן משוב אישי, ולכן צריך להתחבר. ההתקדמות ברמות 1 ו-2 נשמרת.'
                    : 'פתחו את התרגול באתר הראשי כדי לשחק ברמה 3.') + '</div>'
                + (game.isGuest ? '<button class="btn btn-primary" onclick="game.openLogin()">התחברות</button>' : '') + '</div></div>';
            return;
        }

        if (room.finished) {
            c.innerHTML = '<div class="joker-room"><div class="completion-screen">'
                + '<div class="completion-icon">' + icon('fa-crown', 'art-fallback') + '</div>'
                + '<div class="completion-title">שליטה</div>'
                + '<div class="completion-subtitle">השלמתם את שלוש הרמות בשיעור "' + esc(room.lesson.title) + '"</div>'
                + '<div class="levels-stars">' + icon('fa-star', 'on') + icon('fa-star', 'on') + icon('fa-star', 'on') + '</div>'
                + '<div class="completion-stats"><div class="completion-stat"><div class="completion-stat-value" dir="ltr">+' + room.xp + '</div><div class="completion-stat-label">XP</div></div></div>'
                + '<button class="btn btn-primary btn-full" onclick="game.transitionTo(function(){ game.openModule(' + room.mod.id + ') })">חזרה למודול ' + icon('fa-arrow-left') + '</button>'
                + '<button class="btn btn-secondary btn-full completion-secondary" onclick="BwcJoker.leave()">חזרה לרמות של השיעור</button>'
                + '</div></div>';
            return;
        }

        var t = room.tasks[room.i];
        var k = KINDS[t.kind] || KINDS.explain;
        var isRole = t.kind === 'roleplay';
        var userTurns = room.history.filter(function (m) { return m.role === 'user'; }).length;
        var over = !!room.result;

        var chat = '';
        if (isRole) {
            chat = '<div class="joker-persona">' + icon('fa-user') + '<span><strong>הדמות:</strong> ' + esc(t.persona) + '</span></div>'
                + '<div class="joker-chat" id="joker-chat" aria-live="polite">'
                + '<div class="joker-bubble them">' + esc(t.opening) + '</div>'
                + room.history.map(function (m) { return '<div class="joker-bubble ' + (m.role === 'user' ? 'me' : 'them') + '">' + esc(m.content) + '</div>'; }).join('')
                + (room.busy ? '<div class="joker-bubble them typing">' + icon('fa-ellipsis', 'fa-fade') + '</div>' : '')
                + '</div>';
        } else if (room.history.length) {
            chat = '<div class="joker-answer"><div class="joker-answer-label">התשובה ששלחתם</div>' + esc(room.history[room.history.length - 1].content) + '</div>';
        }

        var composer = over ? '' :
            '<div class="joker-compose">'
            + (isRole ? '<div class="joker-turns">תור <span dir="ltr">' + Math.min(userTurns + 1, ROLEPLAY_TURNS) + '/' + ROLEPLAY_TURNS + '</span></div>' : '')
            + '<div class="joker-compose-row"><textarea id="joker-input" class="joker-input" rows="' + (isRole ? 2 : 5) + '" maxlength="2500"'
            + ' placeholder="' + esc(k.placeholder) + '" aria-label="' + esc(k.label) + '"' + (room.busy ? ' disabled' : '') + '></textarea></div>'
            + '<div class="joker-compose-foot"><span class="joker-compose-hint">' + (isRole ? '' : 'לפחות ' + MIN_WORDS + ' מילים') + '</span>'
            + '<button type="button" class="btn btn-primary" id="joker-send" onclick="BwcJoker.send()"' + (room.busy ? ' disabled' : '') + '>'
            + (room.busy ? icon('fa-spinner', 'fa-spin') + ' הג\'וקר קורא...' : 'שליחה ' + icon('fa-paper-plane')) + '</button></div>'
            + '</div>';

        var after = '';
        if (over) {
            var last = room.i === room.tasks.length - 1;
            var allPassed = room.passed.every(Boolean);
            after = resultHtml(room.result) + '<div class="joker-after">'
                + '<button class="btn btn-secondary" onclick="BwcJoker.retry()">' + icon('fa-rotate-left') + ' ' + (room.result.passed ? 'לנסות שוב' : 'ניסיון נוסף') + '</button>'
                + (room.result.passed && !allPassed ? '<button class="btn btn-primary" onclick="BwcJoker.next()">' + (last ? 'למשימה שנשארה' : 'למשימה הבאה') + ' ' + icon('fa-arrow-left') + '</button>' : '')
                + (allPassed ? '<button class="btn btn-primary" onclick="BwcJoker.finish()">סיום הרמה ' + icon('fa-crown') + '</button>' : '')
                + '</div>';
        }

        c.innerHTML = head
            + '<div class="joker-room">'
            + '<div class="joker-head"><div class="levels-kicker">' + esc(room.mod.title) + ' · שיעור ' + room.lesson.id + ' · רמה 3: שליטה</div>'
            + '<h2 class="joker-title">' + esc(room.lesson.title) + '</h2></div>'
            + stepsHtml()
            + '<div class="joker-task"><div class="joker-task-kind">' + icon(k.icon) + ' ' + esc(k.label) + '</div>'
            + '<h3 class="joker-task-title">' + esc(t.title) + '</h3>'
            + '<p class="joker-task-prompt">' + esc(t.prompt) + '</p></div>'
            + chat + composer + after
            + '</div>';

        var ta = byId('joker-input');
        if (ta && window.bwcComposer && typeof window.bwcComposer.enhance === 'function') {
            try {
                window.bwcComposer.enhance(ta, {
                    onSend: function () { send(); },
                    max: 2500,
                    draftKey: function () { return room ? 'bwc_game_l3_draft_' + room.key + '_' + room.i : null; }
                });
            } catch (e) { console.error('[joker] composer failed', e); }
        }
        var chatEl = byId('joker-chat');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
        if (ta && !room.busy && room.history.length) { try { ta.focus({ preventScroll: true }); } catch (e) { /* old browser */ } }
    }

    function go(i) {
        if (!room || room.busy || i === room.i || !room.tasks[i]) return;
        room.i = i;
        room.history = [];
        room.result = null;
        render();
    }

    function retry() {
        if (!room || room.busy) return;
        room.history = [];
        room.result = null;
        render();
    }

    function next() {
        if (!room || room.busy) return;
        var open = room.passed.indexOf(false);
        go(open === -1 ? Math.min(room.i + 1, room.tasks.length - 1) : open);
    }

    async function send() {
        if (!room || room.busy || room.result) return;
        var game = g();
        var ta = byId('joker-input');
        var text = ta ? ta.value.trim() : '';
        var t = room.tasks[room.i];
        var isRole = t.kind === 'roleplay';
        if (!text) return;
        if (!isRole && words(text) < MIN_WORDS) { game.showToast(say('answer_too_short'), 3500); return; }

        var idx = room.i;
        if (isRole) room.history.push({ role: 'user', content: text });
        else room.history = [{ role: 'user', content: text }];
        room.busy = true;
        if (ta && ta._bwcComposer && ta._bwcComposer.clearDraft) ta._bwcComposer.clearDraft();
        render();

        var r = await call({ mode: 'judge', lessonKey: room.key, task: idx, history: room.history });
        if (!room || room.i !== idx) return;        // the learner left the task
        room.busy = false;

        if (!r.ok) {
            if (isRole) room.history.pop(); else room.history = [];
            render();
            var again = byId('joker-input');
            if (again) again.value = text;          // never lose what they wrote
            game.showToast(say(r.reason), 4500);
            if (r.reason === 'unauthorized') game.openLogin();
            return;
        }

        if (isRole) {
            if (r.reply) room.history.push({ role: 'assistant', content: String(r.reply) });
            if (!r.done) { render(); return; }
        }
        room.result = { passed: !!r.passed, score: r.score, max: r.max, good: r.good, fix: r.fix, criteria: r.criteria };
        if (r.passed && !room.passed[idx]) { room.passed[idx] = true; savePassed(); }
        try { game.sound.play(r.passed ? 'correct' : 'wrong'); } catch (e) { /* no audio */ }
        render();
    }

    function finish() {
        if (!room || !room.passed.every(Boolean)) return;
        var game = g();
        var before = game.playerData.xp || 0;
        game.completeLevel3(room.key, XP_PER_TASK * room.tasks.length);
        room.xp = (game.playerData.xp || 0) - before;
        room.finished = true;
        try { game.createConfetti(); game.sound.play('levelUp'); } catch (e) { /* cosmetic */ }
        game.updateStatsDisplay();
        render();
    }

    window.BwcJoker = {
        available: available,
        hintButton: hintButton,
        hint: hint,
        startSurprise: startSurprise,
        startLevel3: startLevel3,
        go: go, retry: retry, next: next, send: send, finish: finish, leave: leave
    };

    // Signing in while a gate is on screen opens the room.
    try {
        if (window.bwcAuth && typeof window.bwcAuth.onChange === 'function') {
            window.bwcAuth.onChange(function () {
                setTimeout(function () {
                    if (room && g() && g().currentScreen === 'joker') { room.passed = loadPassed(); render(); }
                    else if (g() && g().currentScreen === 'levels') g().renderLevelScreen();
                }, 50);
            });
        }
    } catch (e) { /* guest mode */ }
})();
