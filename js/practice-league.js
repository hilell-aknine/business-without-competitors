/* ==============================================================
   practice-league.js — motivation layer for the practice game
   עסק ללא מתחרים · Vanilla JS, no libraries

   Three axes of measurement, never one:
     למידה   — lessons completed + quiz scores      (course_progress, quiz_scores)
     התמדה   — streak + active days                 (practice_stats, practice_weekly)
     יישום   — application documents produced       (application_docs)

   Rules baked in on purpose:
     • POSITIVE ONLY. We say "you're in the top N%" and never the inverse.
       An axis where the learner is below the median simply shows no
       percentile — the headline moves to their strongest axis, or to a
       forward-looking personal goal.
     • NUMBERS FLOOR. Below MIN_COHORT active learners a percentile is noise,
       so the server suppresses it and we show personal goals instead.
     • PRIVACY. Everything cross-learner comes from two SECURITY DEFINER RPCs
       that return aggregates and anonymous seats. This file never queries
       another learner's row, and there is no code path here that could.
     • DEGRADES QUIETLY. Guest, offline, or migration 007 not deployed yet →
       the panel falls back to local personal goals. Never an error state.
   ============================================================== */

'use strict';

(function () {

  /* ==============================================================
     TUNABLES — mirror of the constants in
     supabase/migrations/007_league_and_standing.sql.
     The SERVER value is what actually gates disclosure; these are
     only used by the local fallback and by the copy.
     ============================================================== */
  const MIN_COHORT = 20;   // no percentiles below this many active learners
  const LEAGUE_SIZE = 20;  // learners per weekly league

  const AXES = {
    learning:    { key: 'learning',    label: 'למידה',  icon: 'fa-graduation-cap', color: '#3fa9c2' },
    persistence: { key: 'persistence', label: 'התמדה',  icon: 'fa-fire',           color: '#f0932f' },
    application: { key: 'application', label: 'יישום',  icon: 'fa-hammer',         color: '#d4af37' }
  };

  let cache = { standing: null, board: null, fetchedAt: 0 };
  let rpcAvailable = true;   // flips to false the first time 007 is missing

  /* ==============================================================
     HELPERS
     ============================================================== */

  function esc(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function todayJerusalem() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  }

  /** Sunday-based week start, in Israel time — matches league_week_start() in SQL. */
  function weekStartJerusalem() {
    const d = new Date(todayJerusalem() + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  }

  /** Hebrew day counts: 1 and 2 have their own forms. */
  function days(n) {
    if (n === 1) return 'יום אחד';
    if (n === 2) return 'יומיים';
    return `${n} ימים`;
  }

  function supa()  { return window.bwcSupabase || null; }
  function user()  { return (window.bwcAuth && window.bwcAuth.getUser()) || null; }

  /* ==============================================================
     WEEKLY BUCKET  (local mirror + push to practice_weekly)
     practice_stats holds lifetime totals, which makes a league
     unwinnable for anyone who joined late. Leagues need per-week XP.
     ============================================================== */

  /** Fold this round's XP into the local weekly bucket. Mutates `data`. */
  function bumpWeekly(data, xp) {
    const ws = weekStartJerusalem();
    const today = todayJerusalem();
    if (!data.weekly || data.weekly.weekStart !== ws) {
      data.weekly = { weekStart: ws, xp: 0, days: [] };
    }
    data.weekly.xp += Math.max(0, Math.round(xp || 0));
    if (data.weekly.days.indexOf(today) === -1) data.weekly.days.push(today);
    return data.weekly;
  }

  /** Fire-and-forget push of the weekly bucket. Own row only, plain RLS. */
  async function pushWeekly(weekly) {
    const u = user(), sb = supa();
    if (!u || !sb || !weekly) return;
    try {
      const { error } = await sb.from('practice_weekly').upsert({
        user_id:          u.id,
        week_start:       weekly.weekStart,
        xp:               weekly.xp,
        active_days:      (weekly.days || []).length,
        last_active_date: todayJerusalem(),
        updated_at:       new Date().toISOString()
      }, { onConflict: 'user_id,week_start' });
      if (error) noteMissing(error, '[league] practice_weekly upsert');
    } catch (err) {
      console.warn('[league] pushWeekly failed:', err);
    }
  }

  /** Migration 007 not deployed yet → stop trying, fall back silently. */
  function noteMissing(error, where) {
    const msg = (error && (error.message || error.hint || '')) + '';
    if (/does not exist|not find the (function|table)|schema cache|PGRST202|42P01|42883/i.test(msg)) {
      rpcAvailable = false;
      console.info(where + ': migration 007 not deployed yet — using local goals.');
    } else {
      console.warn(where + ':', msg);
    }
  }

  /* ==============================================================
     DATA FETCH
     ============================================================== */

  async function fetchStanding() {
    const sb = supa();
    if (!sb || !user() || !rpcAvailable) return null;
    try {
      const { data, error } = await sb.rpc('get_learner_standing');
      if (error) { noteMissing(error, '[league] get_learner_standing'); return null; }
      return (data && !data.error) ? data : null;
    } catch (err) { noteMissing(err, '[league] get_learner_standing'); return null; }
  }

  async function fetchBoard() {
    const sb = supa();
    if (!sb || !user() || !rpcAvailable) return null;
    try {
      const { data, error } = await sb.rpc('get_league_board');
      if (error) { noteMissing(error, '[league] get_league_board'); return null; }
      return (data && !data.error) ? data : null;
    } catch (err) { noteMissing(err, '[league] get_league_board'); return null; }
  }

  /* ==============================================================
     LOCAL FALLBACK — everything we can honestly say without the server
     ============================================================== */

  function localStanding() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem('bwc_practice_v1') || '{}'); } catch (_) {}
    const completed = d.completed || {};
    const solved = Object.keys(completed).filter(k => completed[k] >= 80).length;
    const totalCh = (window.PRACTICE_CHALLENGES || []).length || 88;

    let lessons = 0;
    try { lessons = (JSON.parse(localStorage.getItem('bwc_completed') || '[]') || []).length; } catch (_) {}

    let quizAvg = 0;
    try {
      const q = JSON.parse(localStorage.getItem('bwc_quiz_scores') || '{}');
      const vals = Object.values(q).map(v => (v.total ? (v.best * 100) / v.total : 0));
      if (vals.length) quizAvg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    } catch (_) {}

    const weekly = (d.weekly && d.weekly.weekStart === weekStartJerusalem()) ? d.weekly : { xp: 0, days: [] };

    return {
      local: true,
      cohort: 0,
      show_percentiles: false,
      axes: {
        learning: {
          score: Math.round(0.6 * Math.min(100, (lessons * 100) / 132) + 0.4 * Math.min(100, quizAvg)),
          top_pct: null,
          raw: { lessons, total_lessons: 132, quiz_avg: quizAvg }
        },
        persistence: {
          score: Math.round(0.5 * Math.min(100, ((d.streak || 0) * 100) / 30) +
                            0.5 * Math.min(100, ((weekly.days || []).length * 100) / 20)),
          top_pct: null,
          raw: { current_streak: d.streak || 0, longest_streak: d.streak || 0,
                 active_days_28: (weekly.days || []).length }
        },
        application: { score: 0, top_pct: null, raw: { docs: 0, total_modules: 8 } }
      },
      best_axis: 'persistence',
      extra: { solved, totalCh, weeklyXp: weekly.xp || 0 }
    };
  }

  /* ==============================================================
     COPY — positive only, always
     ============================================================== */

  /**
   * The single celebratory line at the top.
   * Order of preference:
   *   1. the strongest axis where the learner is genuinely in the top half
   *   2. otherwise a forward-looking personal goal — never a ranking
   */
  function headlineFor(st) {
    const axes = st.axes || {};
    if (st.show_percentiles) {
      const ranked = Object.keys(AXES)
        .map(k => ({ k, top: axes[k] && axes[k].top_pct }))
        .filter(a => typeof a.top === 'number' && a.top <= 50)
        .sort((a, b) => a.top - b.top);
      if (ranked.length) {
        const a = ranked[0];
        return {
          tone: 'win',
          text: `אתה ב-${a.top}% העליונים ב${AXES[a.k].label} החודש`,
          sub: a.k === 'application'
            ? 'זה הציר שהכי קשה לשמור עליו — רוב הלומדים צופים, אתה מיישם.'
            : 'תמשיך ככה, זה בדיוק מה שבונה את הפער.'
        };
      }
    }
    // No percentile to celebrate → a personal, forward-looking goal
    const g = goalsFor(st)[0];
    return {
      tone: 'goal',
      text: g ? g.text : 'כל סבב תרגול מזיז את המחט',
      sub: st.show_percentiles
        ? 'ברגע שתעבור את החצי העליון באחד הצירים, נגיד לך.'
        : (st.local || (st.cohort || 0) < MIN_COHORT
            ? 'עוד מעט נוכל להשוות אותך לשאר הקבוצה. בינתיים — היעדים שלך.'
            : '')
    };
  }

  /** Concrete next steps. Always phrased as a reachable target. */
  function goalsFor(st) {
    const out = [];
    const p = st.axes.persistence.raw;
    const a = st.axes.application.raw;
    const l = st.axes.learning.raw;

    if (p.longest_streak > p.current_streak) {
      out.push({ icon: 'fa-fire', text:
        `עוד ${days(p.longest_streak - p.current_streak + 1)} כדי לשבור את שיא הרצף שלך (${p.longest_streak})` });
    } else if (p.current_streak > 0) {
      out.push({ icon: 'fa-fire', text:
        `רצף של ${days(p.current_streak)} — עוד יום וזה שיא חדש` });
    } else {
      out.push({ icon: 'fa-fire', text: 'סבב אחד היום פותח רצף חדש' });
    }

    if (a.docs < a.total_modules) {
      out.push({ icon: 'fa-hammer', text:
        `הפקת ${a.docs} מתוך ${a.total_modules} מסמכי יישום — עוד אחד ואתה על ${a.docs + 1}` });
    } else {
      out.push({ icon: 'fa-hammer', text: 'כל שמונת מסמכי היישום מוכנים — זה נדיר' });
    }

    if (l.lessons < l.total_lessons) {
      out.push({ icon: 'fa-graduation-cap', text:
        `${l.lessons} מתוך ${l.total_lessons} שיעורים הושלמו` });
    }
    return out;
  }

  /* ==============================================================
     RENDER — standing card
     ============================================================== */

  function renderStanding(st) {
    const root = document.getElementById('standing-card');
    if (!root) return;

    const head = headlineFor(st);
    const goals = goalsFor(st);

    let anyChip = false;
    const axisRows = Object.keys(AXES).map(k => {
      const cfg = AXES[k];
      const ax  = st.axes[k] || { score: 0, top_pct: null, raw: {} };
      // The chip appears ONLY for a top-half result. There is no branch in
      // this function that can print a bottom-half position.
      const showChip = st.show_percentiles && typeof ax.top_pct === 'number' && ax.top_pct <= 50;
      if (showChip) anyChip = true;
      const chip = showChip ? `<span class="lg-axis__chip">${ax.top_pct}% העליונים</span>` : '';
      let detail = '';
      if (k === 'learning')    detail = `${ax.raw.lessons}/${ax.raw.total_lessons} שיעורים`;
      if (k === 'persistence') detail = `רצף ${days(ax.raw.current_streak)} · פעיל ${days(ax.raw.active_days_28)} החודש`;
      if (k === 'application') detail = `${ax.raw.docs}/${ax.raw.total_modules} מסמכי יישום`;

      return `
        <div class="lg-axis">
          <div class="lg-axis__head">
            <span class="lg-axis__name">
              <i class="fa-solid ${cfg.icon}" aria-hidden="true" style="color:${cfg.color}"></i>
              ${cfg.label}
            </span>
            ${chip}
          </div>
          <div class="lg-axis__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"
               aria-valuenow="${ax.score}" aria-label="${cfg.label}">
            <div class="lg-axis__fill" style="inline-size:${Math.max(2, ax.score)}%;background:${cfg.color}"></div>
          </div>
          <div class="lg-axis__detail">${esc(detail)}</div>
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="lg-head lg-head--${head.tone}">
        <i class="fa-solid ${head.tone === 'win' ? 'fa-trophy' : 'fa-bullseye'}" aria-hidden="true"></i>
        <div>
          <strong>${esc(head.text)}</strong>
          ${head.sub ? `<span>${esc(head.sub)}</span>` : ''}
        </div>
      </div>
      <div class="lg-axes">${axisRows}</div>
      <ul class="lg-goals">
        ${goals.slice(0, 3).map(g =>
          `<li><i class="fa-solid ${g.icon}" aria-hidden="true"></i> ${esc(g.text)}</li>`).join('')}
      </ul>
      ${st.show_percentiles
        ? `<div class="lg-foot">מבוסס על ${st.cohort} לומדים פעילים${
              anyChip ? ' · מוצג רק מה שאתה חזק בו' : ''}</div>`
        : `<div class="lg-foot">${st.local
              ? 'התחבר כדי להשוות את עצמך לשאר הלומדים'
              : `השוואה לקבוצה תיפתח מ-${MIN_COHORT} לומדים פעילים`}</div>`}
    `;
    root.hidden = false;
  }

  /* ==============================================================
     RENDER — weekly league board
     ============================================================== */

  function renderBoard(board) {
    const wrap = document.getElementById('league-panel');
    const body = document.getElementById('league-body');
    const line = document.getElementById('league-summary');
    if (!wrap || !body) return;

    if (!board) { wrap.hidden = true; return; }
    wrap.hidden = false;

    if (board.opted_out) {
      line.textContent = 'לא משתתף בליגה';
      body.innerHTML = `
        <p class="lg-note">בחרת לא להשתתף בליגה השבועית.</p>
        <button type="button" class="lg-btn" id="league-optin">הצטרף חזרה</button>`;
      body.querySelector('#league-optin')?.addEventListener('click', () => setPrefs({ opted_in: true }));
      return;
    }

    const players = board.players || [];
    const me = players.find(p => p.is_me);
    line.textContent = me
      ? `ליגה ${board.league_no} · מקום ${me.rank} מתוך ${players.length}`
      : `ליגה ${board.league_no} · ${players.length} לומדים`;

    const rows = players.map(p => {
      const name = p.display_name ? esc(p.display_name) : `לומד/ת #${p.seat}`;
      const medal = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : '';
      return `
        <li class="lg-row ${p.is_me ? 'lg-row--me' : ''}">
          <span class="lg-row__rank">${medal || p.rank}</span>
          <span class="lg-row__name">${name}${p.is_me ? ' <b>(אתה)</b>' : ''}</span>
          <span class="lg-row__xp">${p.xp} XP</span>
        </li>`;
    }).join('');

    body.innerHTML = `
      <ol class="lg-rows">${rows || '<li class="lg-note">הליגה נפתחת עם הסבב הראשון השבוע</li>'}</ol>
      ${board.joined ? '' : '<p class="lg-note">שחק סבב אחד השבוע כדי להיכנס לדירוג</p>'}
      <p class="lg-note lg-note--privacy">
        <i class="fa-solid fa-lock" aria-hidden="true"></i>
        בליגה מוצג רק שם פרטי או כינוי שבחרת. כברירת מחדל אתה אנונימי, ומייל לעולם לא מוצג.
      </p>
      <div class="lg-prefs">
        <label class="lg-prefs__label" for="league-nick">הכינוי שלי בליגה</label>
        <div class="lg-prefs__row">
          <input class="lg-prefs__input" id="league-nick" type="text" maxlength="24"
                 placeholder="למשל: יוסי מחיפה" autocomplete="off">
          <button type="button" class="lg-btn" id="league-save">שמור</button>
        </div>
        <button type="button" class="lg-link" id="league-optout">אני מעדיף לא להשתתף בליגה</button>
      </div>`;

    body.querySelector('#league-save')?.addEventListener('click', () => {
      const v = (body.querySelector('#league-nick').value || '').trim().slice(0, 24);
      setPrefs({ nickname: v || null });
    });
    body.querySelector('#league-optout')?.addEventListener('click', () => setPrefs({ opted_in: false }));
  }

  async function setPrefs(patch) {
    const u = user(), sb = supa();
    if (!u || !sb) return;
    try {
      const row = Object.assign({ user_id: u.id, updated_at: new Date().toISOString() }, patch);
      const { error } = await sb.from('league_prefs').upsert(row, { onConflict: 'user_id' });
      if (error) { noteMissing(error, '[league] league_prefs upsert'); return; }
      cache.board = await fetchBoard();
      renderBoard(cache.board);
    } catch (err) { console.warn('[league] setPrefs failed:', err); }
  }

  /* ==============================================================
     PUBLIC API
     ============================================================== */

  async function render(force) {
    // Local fallback paints instantly so the panel is never empty.
    const local = localStanding();
    if (!cache.standing) renderStanding(local);

    if (!user() || !supa() || !rpcAvailable) {
      renderBoard(null);
      return;
    }

    const fresh = force || (Date.now() - cache.fetchedAt > 60000);
    if (fresh) {
      const [st, bd] = await Promise.all([fetchStanding(), fetchBoard()]);
      cache.standing = st;
      cache.board = bd;
      cache.fetchedAt = Date.now();
    }
    renderStanding(cache.standing || local);
    renderBoard(cache.board);
  }

  /** Called by practice.js when a round ends. */
  function recordRound(data, xp) {
    const weekly = bumpWeekly(data, xp);
    pushWeekly(weekly);
    cache.fetchedAt = 0; // next render refetches
  }

  window.bwcLeague = {
    render,
    recordRound,
    bumpWeekly,
    weekStartJerusalem,
    MIN_COHORT,
    LEAGUE_SIZE
  };

  // Collapsible league panel
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('league-toggle');
    const panel  = document.getElementById('league-panel');
    toggle?.addEventListener('click', () => {
      const open = panel.classList.toggle('lg-panel--open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  });

})();
