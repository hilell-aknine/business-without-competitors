/* דשבורד בריאות התוכן — pages/admin-stats.html.
   Aggregate-only by construction: this screen answers questions about the
   COURSE (which lesson loses people, which module is abandoned, which quiz is
   too hard), so it never needs a name or an email. Its sibling
   pages/admin-users.html answers questions about PEOPLE.

   Reframed 2026-08-09: this used to be sold as "the anonymous dashboard". That
   framing was misleading — the same admin sees every name one click away, so
   the aggregation protected nobody; it is simply the right shape for content
   questions. Do NOT re-add per-learner identity here; use admin-users.html.

   Access: profiles.role='admin' (checked via the is_admin() RPC from migration
   004; RLS admin-select policies expose the rows). Added 2026-08-02.

   No watch-time anywhere: the portal never measures video playback. Every
   number here comes from an explicit "סמן כהושלם" click, a submitted quiz, a
   practice challenge or an application doc. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function bar(pct, warn) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return `<div class="adm-barline"><div class="adm-bar${warn ? ' adm-bar--warn' : ''}" title="${p}%"><div class="adm-bar__fill" style="inline-size:${p}%"></div></div></div>`;
  }

  // lesson_key m{mi}-{wi}-{di} → module index, plus a flat order per module
  function lessonMaps() {
    const mods = window.MODULES || [];
    const orderInModule = {}; // key -> position
    const titles = {};        // key -> readable title
    const totalPerModule = [];
    mods.forEach((mod, mi) => {
      let pos = 0;
      mod.weeks.forEach((week, wi) => {
        week.days.forEach((day, di) => {
          const key = `m${mi}-${wi}-${di}`;
          orderInModule[key] = pos++;
          titles[key] = `מודול ${mi + 1} · ${week.title} · ${day.title}`;
        });
      });
      totalPerModule[mi] = pos;
    });
    return { orderInModule, titles, totalPerModule };
  }

  async function isAdmin(userId) {
    try {
      const { data, error } = await window.bwcSupabase.rpc('is_admin', { uid: userId });
      return !error && data === true;
    } catch { return false; }
  }

  async function fetchAll(table, columns) {
    // paged fetch so we never silently cap at 1000 rows
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await window.bwcSupabase
        .from(table).select(columns).range(from, from + PAGE - 1);
      if (error) { console.warn(`[admin-stats] ${table}:`, error.message); break; }
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async function render() {
    $('loading').classList.remove('hidden');
    const { orderInModule, titles, totalPerModule } = lessonMaps();

    const [profiles, progress, quizzes, practice, appDocs] = await Promise.all([
      fetchAll('profiles', 'id, created_at'),
      fetchAll('course_progress', 'user_id, lesson_key, completed_at'),
      fetchAll('quiz_scores', 'user_id, module_idx, best_score, attempts, passed, total'),
      fetchAll('practice_stats', 'user_id, total_xp, current_streak, longest_streak'),
      fetchAll('application_docs', 'user_id, module_idx, updated_at'),
    ]);

    // headline stats
    $('stat-users').textContent = profiles.length;
    $('stat-completions').textContent = progress.length;
    $('stat-quiztakers').textContent = new Set(quizzes.map(q => q.user_id)).size;
    $('stat-practicers').textContent = practice.length;
    $('stat-appdocs').textContent = appDocs.length;

    // per-module progress
    const perModule = (window.MODULES || []).map((m, mi) => ({
      title: m.title, mi,
      users: new Set(), completions: 0, finishers: new Set(),
    }));
    const perUserLast = {}; // user -> {key, order, mi}
    for (const row of progress) {
      const m = /^m(\d+)-/.exec(row.lesson_key);
      if (!m) continue;
      const mi = Number(m[1]);
      if (!perModule[mi]) continue;
      perModule[mi].users.add(row.user_id);
      perModule[mi].completions++;
      const ord = orderInModule[row.lesson_key];
      if (ord !== undefined && ord === totalPerModule[mi] - 1) perModule[mi].finishers.add(row.user_id);
      const prev = perUserLast[row.user_id];
      const t = row.completed_at || '';
      if (!prev || t > prev.t) perUserLast[row.user_id] = { key: row.lesson_key, t };
    }

    $('tbl-modules').innerHTML = `
      <thead><tr><th>מודול</th><th>לומדים פעילים</th><th>השלמות</th><th>סיימו את המודול</th><th>נטישה</th></tr></thead><tbody>` +
      perModule.map(m => {
        const started = m.users.size, finished = m.finishers.size;
        const dropPct = started ? ((started - finished) / started) * 100 : 0;
        return `<tr>
          <td data-cell="name" class="adm-name">מודול ${m.mi + 1} · ${esc(m.title)}</td>
          <td data-label="לומדים פעילים" class="adm-num">${started}</td>
          <td data-label="השלמות" class="adm-num">${m.completions}</td>
          <td data-label="סיימו את המודול" class="adm-num">${finished}</td>
          <td data-label="נטישה" data-cell="progress">${started ? bar(dropPct, dropPct > 60) : '<span class="adm-muted">אין נתונים</span>'}</td>
        </tr>`;
      }).join('') + '</tbody>';

    // quizzes per module
    const quizAgg = Array.from({ length: 8 }, () => ({ n: 0, sum: 0, passed: 0, attempts: 0 }));
    for (const q of quizzes) {
      const a = quizAgg[q.module_idx];
      if (!a) continue;
      a.n++; a.sum += (q.best_score / (q.total || 5)) * 100; a.attempts += q.attempts || 0;
      if (q.passed) a.passed++;
    }
    $('tbl-quiz').innerHTML = `
      <thead><tr><th>מודול</th><th>ניגשו</th><th>ציון ממוצע</th><th>אחוז עוברים</th><th>סך ניסיונות</th></tr></thead><tbody>` +
      quizAgg.map((a, mi) => `<tr>
        <td data-cell="name" class="adm-name">מודול ${mi + 1}</td>
        <td data-label="ניגשו" class="adm-num">${a.n}</td>
        <td data-label="ציון ממוצע" class="adm-num">${a.n ? Math.round(a.sum / a.n) + '%' : '<span class="adm-muted">—</span>'}</td>
        <td data-label="אחוז עוברים" data-cell="progress">${a.n ? bar((a.passed / a.n) * 100) : '<span class="adm-muted">—</span>'}</td>
        <td data-label="סך ניסיונות" class="adm-num">${a.attempts}</td>
      </tr>`).join('') + '</tbody>';

    // drop-off: distribution of each user's LAST completed lesson
    const lastCounts = {};
    Object.values(perUserLast).forEach(({ key }) => { lastCounts[key] = (lastCounts[key] || 0) + 1; });
    const top = Object.entries(lastCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('tbl-dropoff').innerHTML = `
      <thead><tr><th>שיעור</th><th>לומדים שנעצרו כאן</th></tr></thead><tbody>` +
      (top.length ? top.map(([key, n]) => `<tr>
        <td data-cell="name" class="adm-name">${esc(titles[key] || key)}</td>
        <td data-label="לומדים שנעצרו כאן" class="adm-num">${n}</td>
      </tr>`).join('') : '<tr><td colspan="2"><span class="adm-muted">אין עדיין נתוני התקדמות בענן</span></td></tr>') + '</tbody>';

    // practice
    const xp = practice.map(p => p.total_xp || 0);
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    $('tbl-practice').innerHTML = `
      <thead><tr><th>מדד</th><th>ערך</th></tr></thead>
      <tbody>
      <tr><td class="adm-mini__name">לומדים שתרגלו</td><td class="adm-num">${practice.length}</td></tr>
      <tr><td class="adm-mini__name">XP ממוצע ללומד</td><td class="adm-num">${avg(xp)}</td></tr>
      <tr><td class="adm-mini__name">XP מצטבר</td><td class="adm-num">${xp.reduce((a, b) => a + b, 0)}</td></tr>
      <tr><td class="adm-mini__name">הרצף הארוך ביותר שנרשם</td><td class="adm-num">${Math.max(0, ...practice.map(p => p.longest_streak || 0))} ימים</td></tr>
      <tr><td class="adm-mini__name">לומדים עם רצף פעיל</td><td class="adm-num">${practice.filter(p => (p.current_streak || 0) > 0).length}</td></tr>
      </tbody>`;

    $('loading').classList.add('hidden');
    $('dash').classList.remove('hidden');
  }

  async function applyAuthState() {
    const user = window.bwcAuth && window.bwcAuth.getUser();
    if (!user) {
      $('gate').classList.remove('hidden');
      $('dash').classList.add('hidden');
      $('gateMsg').textContent = 'התחבר עם חשבון מנהל כדי לצפות בדשבורד.';
      return;
    }
    const admin = await isAdmin(user.id);
    if (!admin) {
      $('gate').classList.remove('hidden');
      $('dash').classList.add('hidden');
      $('gateMsg').textContent = 'החשבון שלך אינו חשבון מנהל. הדשבורד זמין למנהלי המערכת בלבד.';
      return;
    }
    $('gate').classList.add('hidden');
    render().catch(err => {
      console.error('[admin-stats]', err);
      $('loading').textContent = 'שגיאה בטעינת הנתונים. בדוק את הקונסול.';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.bwcAuth) {
      window.bwcAuth.ready().then(applyAuthState);
      window.bwcAuth.onChange(applyAuthState);
    }
  });
})();
