/* ==========================================================================
   game-types-l2.js — the six exercise types of level 2 ("יישום").

   Loaded BEFORE js/game.js. Each type is one entry in window.BwcGameTypes;
   the engine picks them up into its registry (see the TYPES block at the top
   of game.js for the contract). `g` is the BwcGame instance; g.ui carries
   esc / icon / byId.

   Data shapes are documented and enforced by tools/check-game-levels.mjs.
   Styles: css/game-l2.css. No network calls.
   ========================================================================== */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    const T = window.BwcGameTypes = window.BwcGameTypes || {};
    const MEMORY_MAX_TRIES = 10;

    function shell(g, type, ex, inner, extraQuestion) {
        return `
            ${g.exitButton()}
            <div class="exercise-container l2 l2-${type}">
                ${g.exerciseHeader(type)}
                ${extraQuestion || ''}
                <div class="exercise-question">${g.ui.esc(ex.question)}</div>
                ${inner}
                ${g.exerciseTip(type)}
            </div>`;
    }

    function shuffled(g, list) {
        return g.shuffleArray(list.map((item, index) => ({ item, index })));
    }

    function detailList(g, title, rows) {
        if (!rows.length) return '';
        return `<div class="l2-detail"><div class="feedback-answer-label">${title}</div>`
            + rows.map(r => `<div class="l2-detail-row"><span class="l2-detail-main">${g.ui.esc(r.main)}</span>`
                + (r.note ? `<span class="l2-detail-note">${g.ui.esc(r.note)}</span>` : '') + `</div>`).join('')
            + `</div>`;
    }

    // ───────────────────────── sort ─────────────────────────
    T['sort'] = {
        meta: { label: 'מיון', icon: 'fa-table-columns', tip: 'קבעו לכל פריט לאיזו קבוצה הוא שייך. אפשר לשנות בחירה לפני הבדיקה.' },
        render(g, c, ex) {
            const esc = g.ui.esc;
            const order = shuffled(g, ex.items);
            g._l2 = { picks: {}, total: ex.items.length };
            const rows = order.map(({ item, index }) => `
                <div class="l2-sort-row" data-i="${index}">
                    <div class="l2-sort-text">${esc(item.text)}</div>
                    <div class="l2-sort-btns" role="group" aria-label="לאיזו קבוצה שייך הפריט">
                        <button type="button" class="l2-pill" data-b="0" onclick="BwcL2.sortPick(${index}, 0)">${esc(ex.buckets[0])}</button>
                        <button type="button" class="l2-pill" data-b="1" onclick="BwcL2.sortPick(${index}, 1)">${esc(ex.buckets[1])}</button>
                    </div>
                </div>`).join('');
            c.innerHTML = shell(g, 'sort', ex, `<div class="l2-sort">${rows}</div>`);
        },
        check(g, ex) {
            const s = g._l2;
            if (!s || Object.keys(s.picks).length < ex.items.length) return null;
            return ex.items.every((it, i) => s.picks[i] === it.bucket);
        },
        feedback(g, ok, ex) {
            document.querySelectorAll('.l2-sort-row').forEach((row) => {
                const i = +row.dataset.i;
                const right = g._l2.picks[i] === ex.items[i].bucket;
                row.classList.add(right ? 'correct' : 'incorrect');
                row.querySelectorAll('.l2-pill').forEach((b) => {
                    b.disabled = true;
                    if (+b.dataset.b === ex.items[i].bucket) b.classList.add('answer');
                });
            });
        },
        detail(g, ex, ok) {
            if (ok) return '';
            const wrong = ex.items.filter((it, i) => g._l2.picks[i] !== it.bucket);
            return detailList(g, `${g.ui.icon('fa-check')} המיון הנכון:`, wrong.map(it => ({ main: it.text, note: ex.buckets[it.bucket] })));
        },
    };

    // ─────────────────────── true-false ───────────────────────
    T['true-false'] = {
        meta: { label: 'נכון או לא', icon: 'fa-circle-half-stroke', tip: 'חשבו על מה שנאמר בשיעור, לא על מה שנשמע הגיוני באופן כללי.' },
        render(g, c, ex) {
            const esc = g.ui.esc;
            g._l2 = { picks: {} };
            const rows = ex.statements.map((s, i) => `
                <div class="l2-tf-row" data-i="${i}">
                    <div class="l2-tf-text">${esc(s.text)}</div>
                    <div class="l2-tf-btns" role="group" aria-label="נכון או לא נכון">
                        <button type="button" class="l2-pill l2-pill-yes" data-v="1" onclick="BwcL2.tfPick(${i}, true)">${g.ui.icon('fa-check')} נכון</button>
                        <button type="button" class="l2-pill l2-pill-no" data-v="0" onclick="BwcL2.tfPick(${i}, false)">${g.ui.icon('fa-xmark')} לא נכון</button>
                    </div>
                </div>`).join('');
            c.innerHTML = shell(g, 'true-false', ex, `<div class="l2-tf">${rows}</div>`);
        },
        check(g, ex) {
            const s = g._l2;
            if (!s || Object.keys(s.picks).length < ex.statements.length) return null;
            return ex.statements.every((st, i) => s.picks[i] === st.answer);
        },
        feedback(g, ok, ex) {
            document.querySelectorAll('.l2-tf-row').forEach((row) => {
                const i = +row.dataset.i;
                row.classList.add(g._l2.picks[i] === ex.statements[i].answer ? 'correct' : 'incorrect');
                row.querySelectorAll('.l2-pill').forEach((b) => {
                    b.disabled = true;
                    if ((b.dataset.v === '1') === ex.statements[i].answer) b.classList.add('answer');
                });
            });
        },
        detail(g, ex, ok) {
            const rows = ex.statements
                .filter((st, i) => ok || g._l2.picks[i] !== st.answer)
                .map(st => ({ main: `${st.answer ? 'נכון' : 'לא נכון'}: ${st.text}`, note: st.why }));
            return detailList(g, ok ? `${g.ui.icon('fa-circle-info')} למה:` : `${g.ui.icon('fa-xmark')} איפה טעיתם:`, ok ? rows.slice(0, 2) : rows);
        },
    };

    // ─────────────────────── quote-cloze ───────────────────────
    // Same mechanics as fill-blank, on a sentence taken word for word from the lesson.
    T['quote-cloze'] = {
        meta: { label: 'השלימו את דברי המרצה', icon: 'fa-quote-right', tip: 'זה משפט שנאמר בשיעור מילה במילה. איזו מילה חסרה?' },
        render(g, c, ex) {
            g.renderFillBlank(c, ex);
            const head = c.querySelector('.exercise-type');
            if (head) head.outerHTML = g.exerciseHeader('quote-cloze');
            const tip = c.querySelector('.exercise-tip');
            if (tip) tip.outerHTML = g.exerciseTip('quote-cloze');
            const box = c.querySelector('.exercise-container');
            if (box) box.classList.add('l2', 'l2-quote-cloze');
        },
        check(g, ex) { return g.selectedAnswer === null ? null : g.selectedAnswer === ex.correct; },
        feedback(g, ok, ex) { g.showFillBlankFeedback(ok, ex); },
    };

    // ─────────────────────── spot-error ───────────────────────
    T['spot-error'] = {
        meta: { label: 'מצאו את הטעות', icon: 'fa-magnifying-glass', tip: 'שלושה משפטים נכונים לפי השיעור ואחד לא. הקישו על המשפט השגוי.' },
        secondChance: true,
        render(g, c, ex) {
            const esc = g.ui.esc;
            const rows = ex.sentences.map((s, i) => `
                <button type="button" class="option-btn l2-spot" onclick="game.selectOption(${i})">
                    <span class="option-letter">${i + 1}</span>
                    <span class="option-text">${esc(s)}</span>
                </button>`).join('');
            c.innerHTML = shell(g, 'spot-error', ex, `<div class="options-list" role="group" aria-label="משפטים">${rows}</div>`);
        },
        check(g, ex) { return g.selectedAnswer === null ? null : g.selectedAnswer === ex.wrong; },
        feedback(g, ok, ex) {
            document.querySelectorAll('.option-btn').forEach((btn, i) => {
                if (i === ex.wrong) btn.classList.add('correct');
                else if (i === g.selectedAnswer && !ok) btn.classList.add('incorrect');
            });
        },
        detail(g, ex) {
            return detailList(g, `${g.ui.icon('fa-magnifying-glass')} המשפט השגוי:`, [{ main: ex.sentences[ex.wrong], note: 'הנכון: ' + ex.fix }]);
        },
    };

    // ───────────────────────── memory ─────────────────────────
    T['memory'] = {
        meta: { label: 'זיכרון', icon: 'fa-clone', tip: 'הפכו שני קלפים בכל פעם והתאימו מושג להסבר שלו.' },
        render(g, c, ex) {
            const esc = g.ui.esc;
            const cards = [];
            ex.pairs.forEach((p, i) => { cards.push({ pair: i, side: 'term', text: p.left }); cards.push({ pair: i, side: 'def', text: p.right }); });
            const deck = g.shuffleArray(cards);
            g._l2 = { deck, open: [], matched: 0, tries: 0, busy: false, failed: false, pairs: ex.pairs.length };
            const html = deck.map((card, i) => `
                <button type="button" class="l2-mem-card ${card.side}" data-i="${i}" onclick="BwcL2.memFlip(${i})" aria-label="קלף ${i + 1}">
                    <span class="l2-mem-back">${g.ui.icon('fa-question')}</span>
                    <span class="l2-mem-front">${esc(card.text)}</span>
                </button>`).join('');
            c.innerHTML = shell(g, 'memory', ex,
                `<div class="l2-mem-status" id="l2-mem-status" aria-live="polite">ניסיונות: <span dir="ltr">0/${MEMORY_MAX_TRIES}</span></div>
                 <div class="l2-mem-grid">${html}</div>`);
        },
        check(g) {
            const s = g._l2;
            if (!s) return null;
            if (s.failed) return false;
            return s.matched === s.pairs ? true : null;
        },
        feedback(g, ok) {
            document.querySelectorAll('.l2-mem-card').forEach((el) => {
                el.disabled = true;
                el.classList.add('open');
                if (!ok && !el.classList.contains('matched')) el.classList.add('incorrect');
            });
        },
        detail(g, ex, ok) {
            return detailList(g, ok ? `${g.ui.icon('fa-clone')} הזוגות:` : `${g.ui.icon('fa-xmark')} נגמרו הניסיונות. אלה הזוגות:`,
                ex.pairs.map(p => ({ main: p.left, note: p.right })));
        },
    };

    // ───────────────────────── decision ─────────────────────────
    T['decision'] = {
        meta: { label: 'מסלול החלטות', icon: 'fa-route', tip: 'כל החלטה מובילה לצעד הבא. ההסבר מופיע מיד אחרי כל בחירה.' },
        render(g, c, ex) {
            const esc = g.ui.esc;
            g._l2 = { step: 0, right: 0, done: false, total: ex.steps.length, ex };
            c.innerHTML = shell(g, 'decision', ex,
                `<div class="l2-dec-progress" id="l2-dec-progress"></div><div class="l2-dec-steps" id="l2-dec-steps"></div>`,
                `<div class="exercise-context l2-dec-context">${esc(ex.context)}</div>`);
            window.BwcL2.decRender();
        },
        check(g) {
            const s = g._l2;
            if (!s || !s.done) return null;
            return s.right === s.total;
        },
        feedback() { /* each step already showed its own result */ },
        detail(g, ex, ok) {
            const s = g._l2;
            return `<div class="l2-detail"><div class="feedback-answer-label">${g.ui.icon('fa-route')} `
                + `<span dir="ltr">${s.right}/${s.total}</span> החלטות נכונות</div>`
                + (ok ? '' : `<div class="l2-detail-row"><span class="l2-detail-note">המסלול הנכון: ${ex.steps.map(st => g.ui.esc(st.options[st.correct])).join(' ← ')}</span></div>`)
                + `</div>`;
        },
    };

    // ───────────────────────── handlers ─────────────────────────
    const game = () => window.game;

    window.BwcL2 = {
        sortPick(i, bucket) {
            const g = game();
            if (!g || g.exerciseAnswered || !g._l2) return;
            g.sound.play('click');
            g._l2.picks[i] = bucket;
            const row = document.querySelector(`.l2-sort-row[data-i="${i}"]`);
            if (row) row.querySelectorAll('.l2-pill').forEach(b => b.classList.toggle('selected', +b.dataset.b === bucket));
            if (Object.keys(g._l2.picks).length === g._l2.total) g.enableCheckButton();
        },

        tfPick(i, value) {
            const g = game();
            if (!g || g.exerciseAnswered || !g._l2) return;
            g.sound.play('click');
            g._l2.picks[i] = value;
            const row = document.querySelector(`.l2-tf-row[data-i="${i}"]`);
            if (row) row.querySelectorAll('.l2-pill').forEach(b => b.classList.toggle('selected', (b.dataset.v === '1') === value));
            if (Object.keys(g._l2.picks).length === document.querySelectorAll('.l2-tf-row').length) g.enableCheckButton();
        },

        memFlip(i) {
            const g = game();
            const s = g && g._l2;
            if (!s || g.exerciseAnswered || s.busy || s.failed) return;
            const el = document.querySelector(`.l2-mem-card[data-i="${i}"]`);
            if (!el || el.classList.contains('open')) return;
            g.sound.play('click');
            el.classList.add('open');
            s.open.push(i);
            if (s.open.length < 2) return;

            s.tries++;
            const status = document.getElementById('l2-mem-status');
            if (status) status.innerHTML = `ניסיונות: <span dir="ltr">${s.tries}/${MEMORY_MAX_TRIES}</span>`;
            const [a, b] = s.open;
            const ca = s.deck[a], cb = s.deck[b];
            const els = [a, b].map(n => document.querySelector(`.l2-mem-card[data-i="${n}"]`));
            if (ca.pair === cb.pair && ca.side !== cb.side) {
                els.forEach(e => e.classList.add('matched'));
                s.open = [];
                s.matched++;
                if (s.matched === s.pairs) { g.enableCheckButton(); g.checkAnswer(); }
                return;
            }
            s.busy = true;
            els.forEach(e => e.classList.add('miss'));
            setTimeout(() => {
                els.forEach(e => { if (e) e.classList.remove('open', 'miss'); });
                s.open = [];
                s.busy = false;
                if (s.tries >= MEMORY_MAX_TRIES && s.matched < s.pairs) {
                    s.failed = true;
                    g.enableCheckButton();
                    g.checkAnswer();
                }
            }, 1100);
        },

        decRender() {
            const g = game();
            const s = g && g._l2;
            if (!s) return;
            const esc = g.ui.esc;
            const st = s.ex.steps[s.step];
            const prog = document.getElementById('l2-dec-progress');
            if (prog) prog.innerHTML = s.ex.steps.map((_, i) => `<span class="l2-dec-dot${i < s.step ? ' done' : (i === s.step ? ' now' : '')}"></span>`).join('')
                + `<span class="l2-dec-count">צעד <span dir="ltr">${s.step + 1}/${s.total}</span></span>`;
            const box = document.getElementById('l2-dec-steps');
            if (!box) return;
            const html = `
                <div class="l2-dec-step" data-step="${s.step}">
                    <div class="l2-dec-prompt">${esc(st.prompt)}</div>
                    <div class="l2-dec-options">
                        ${st.options.map((o, i) => `<button type="button" class="option-btn l2-dec-opt" data-o="${i}" onclick="BwcL2.decPick(${i})"><span class="option-text">${esc(o)}</span></button>`).join('')}
                    </div>
                    <div class="l2-dec-why" hidden></div>
                </div>`;
            box.insertAdjacentHTML('beforeend', html);
            const el = box.lastElementChild;
            if (s.step > 0 && el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        decPick(o) {
            const g = game();
            const s = g && g._l2;
            if (!s || g.exerciseAnswered || s.done) return;
            const st = s.ex.steps[s.step];
            const stepEl = document.querySelector(`.l2-dec-step[data-step="${s.step}"]`);
            if (!stepEl || stepEl.classList.contains('locked')) return;
            const ok = o === st.correct;
            g.sound.play('click');
            stepEl.classList.add('locked');
            stepEl.querySelectorAll('.l2-dec-opt').forEach((b) => {
                const n = +b.dataset.o;
                b.disabled = true;
                if (n === st.correct) b.classList.add('correct');
                else if (n === o) b.classList.add('incorrect');
            });
            const why = stepEl.querySelector('.l2-dec-why');
            if (why) {
                why.hidden = false;
                why.className = 'l2-dec-why ' + (ok ? 'ok' : 'bad');
                why.innerHTML = g.ui.icon(ok ? 'fa-circle-check' : 'fa-circle-xmark') + ' ' + g.ui.esc(st.why[o])
                    + (ok ? '' : `<span class="l2-dec-why-fix">${g.ui.esc(st.why[st.correct])}</span>`);
            }
            if (ok) s.right++;
            s.step++;
            if (s.step >= s.total) {
                s.done = true;
                g.enableCheckButton();
                const btn = document.getElementById('check-btn');
                if (btn && btn.scrollIntoView) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            setTimeout(() => window.BwcL2.decRender(), 500);
        },
    };
})();
