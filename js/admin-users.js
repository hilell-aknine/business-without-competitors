/* ==========================================================================
   admin-users.js — per-learner admin dashboard (pages/admin-users.html).

   Sibling of admin-stats.js, but the opposite privacy posture on purpose:
   admin-stats is aggregate-only (no names ever), this page IS the roster —
   who signed up, when, how much they closed, and what they answered in the
   onboarding questionnaire.

   Access: profiles.role = 'admin', checked with the is_admin() RPC
   (SECURITY DEFINER, migration 004). The rows come back because of the
   *_admin_select RLS policies on profiles / course_progress / quiz_scores /
   onboarding_answers. A non-admin session gets empty arrays, not an error —
   so we gate on the RPC before rendering anything.

   Contact fields: name + email only. There is no phone anywhere in this
   system (decision, 2026-08-07).

   Data honesty (surfaced in the UI, not just here):
     - "שיעורים שסומנו" counts rows in course_progress, i.e. lessons the
       learner pressed "סמן כהושלם" on. It is NOT watch time — the portal
       does not measure playback at all.
     - Cloud sync USED to be one-time-per-device: progress made after the
       first login never left the learner's browser. That was fixed in
       js/sync-localstorage.js in the same release as this page, but the fix
       is not retroactive — historical progress only arrives when the learner
       next opens the portal on that device. So for older accounts every
       number here is still a FLOOR, not a ceiling.

   Added 2026-08-07.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Question labels for the detail drawer. Kept in sync with the QUESTIONS
     array in js/onboarding.js — the JSONB payload stores the label the learner
     actually saw, so we only need the question wording here. */
  var QUESTION_LABELS = {
    business_stage:  'איפה העסק עומד היום',
    business_type:   'מה הוא מוכר',
    main_obstacle:   'החומה שהוא נתקל בה',
    desired_outcome: 'איך ייראה "הצליח"',
    weekly_hours:    'זמן פנוי בשבוע',
    weekly_goal:     'יעד שיעורים בשבוע'
  };
  var QUESTION_ORDER = ['business_stage', 'business_type', 'main_obstacle',
                        'desired_outcome', 'weekly_hours', 'weekly_goal'];

  var rows = [];   // merged learner records

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('he-IL', {
        day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Jerusalem'
      }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function daysAgo(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  /* Hebrew counts read badly with a bare number at 1 ("1 מבחנים", "לפני 1 ימים"). */
  function quizCountLabel(n) {
    if (n === 1) return 'מבחן אחד';
    if (n === 2) return 'שני מבחנים';
    return n + ' מבחנים';
  }

  function agoLabel(days) {
    if (days === 0) return 'היום';
    if (days === 1) return 'אתמול';
    if (days === 2) return 'שלשום';
    return 'לפני ' + days + ' ימים';
  }

  function bar(pct) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    return '<div class="bar" title="' + p + '%"><div class="bar__fill" style="width:' + p + '%"></div></div>';
  }

  async function isAdmin(userId) {
    try {
      var res = await window.bwcSupabase.rpc('is_admin', { uid: userId });
      return !res.error && res.data === true;
    } catch (e) { return false; }
  }

  /* Paged fetch so we never silently cap at Supabase's default 1000 rows. */
  async function fetchAll(table, columns) {
    var out = [];
    var PAGE = 1000;
    for (var from = 0; ; from += PAGE) {
      var res = await window.bwcSupabase.from(table).select(columns).range(from, from + PAGE - 1);
      if (res.error) {
        // 42P01 = table missing -> migration 006 has not been applied yet.
        console.warn('[admin-users] ' + table + ':', res.error.message);
        break;
      }
      var data = res.data || [];
      out.push.apply(out, data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  /* ------------------------------------------------------------ rendering */

  function displayName(r) {
    if (r.full_name) return esc(r.full_name);
    return '<span class="u-nameless">ללא שם</span>';
  }

  function renderRows(list) {
    var body = $('usersBody');
    var empty = $('empty');

    if (!list.length) {
      body.innerHTML = '';
      empty.classList.remove('hidden');
      $('rowCount').textContent = '';
      return;
    }
    empty.classList.add('hidden');
    $('rowCount').textContent = 'מציג ' + list.length + ' מתוך ' + rows.length;

    body.innerHTML = list.map(function (r) {
      var seen = fmtDate(r.last_seen_at);
      var ago = daysAgo(r.last_seen_at);
      var seenTxt = seen
        ? esc(seen) + (ago !== null && ago <= 60 ? ' <span class="muted">(' + agoLabel(ago) + ')</span>' : '')
        : '<span class="muted">לא נרשם</span>';

      var quizTxt = (r.quizCount > 0)
        ? '<div style="display:flex;align-items:center;gap:.45rem;">' + bar(r.quizAvg) +
          '<span class="num">' + Math.round(r.quizAvg) + '%</span></div>' +
          '<span class="muted" style="font-size:.72rem;">' + quizCountLabel(r.quizCount) + '</span>'
        : '<span class="muted">לא ניגש</span>';

      var onbTxt = r.onboarding
        ? '<span class="pill">' + (r.onboarding.completed_at ? 'מלא' : (r.onboarding.steps_done || 0) + '/6') + '</span>'
        : '<span class="pill pill--none">לא מילא</span>';

      return '<tr data-uid="' + esc(r.id) + '" tabindex="0">' +
        '<td data-label="שם" class="u-name">' + displayName(r) + '</td>' +
        '<td data-label="מייל" class="u-email">' + esc(r.email || '') + '</td>' +
        '<td data-label="נרשם" class="num">' + (fmtDate(r.created_at) || '<span class="muted">—</span>') + '</td>' +
        '<td data-label="כניסה אחרונה" class="num">' + seenTxt + '</td>' +
        '<td data-label="שיעורים שסומנו" class="num">' + r.lessons + '</td>' +
        '<td data-label="ציון מבחן ממוצע">' + quizTxt + '</td>' +
        '<td data-label="שאלון">' + onbTxt + '</td>' +
      '</tr>';
    }).join('');
  }

  function applyFilters() {
    var q = ($('q').value || '').trim().toLowerCase();
    var sort = $('sort').value;

    var list = rows.filter(function (r) {
      if (!q) return true;
      return (r.full_name || '').toLowerCase().indexOf(q) !== -1 ||
             (r.email || '').toLowerCase().indexOf(q) !== -1;
    });

    var cmp = {
      created_desc: function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); },
      created_asc:  function (a, b) { return (a.created_at || '').localeCompare(b.created_at || ''); },
      lessons_desc: function (a, b) { return b.lessons - a.lessons; },
      lessons_asc:  function (a, b) { return a.lessons - b.lessons; },
      quiz_desc:    function (a, b) { return b.quizAvg - a.quizAvg; },
      seen_desc:    function (a, b) { return (b.last_seen_at || '').localeCompare(a.last_seen_at || ''); },
      name_asc:     function (a, b) { return (a.full_name || 'תתת').localeCompare(b.full_name || 'תתת', 'he'); }
    }[sort];

    if (cmp) list.sort(cmp);
    renderRows(list);
  }

  /* -------------------------------------------------------------- drawer */

  function openDrawer(uid) {
    var r = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === uid) { r = rows[i]; break; } }
    if (!r) return;

    $('drawerName').innerHTML = displayName(r);
    $('drawerEmail').textContent = r.email || '';

    var joined = fmtDate(r.created_at) || '—';
    var seen = fmtDate(r.last_seen_at) || 'לא נרשם';
    $('drawerStats').innerHTML = [
      '<div class="drawer__stat"><b>' + r.lessons + '</b><span>שיעורים שסומנו</span></div>',
      '<div class="drawer__stat"><b>' + (r.quizCount ? Math.round(r.quizAvg) + '%' : '—') + '</b><span>ציון מבחן ממוצע</span></div>',
      '<div class="drawer__stat"><b>' + (r.quizCount || 0) + '</b><span>מבחנים שניגש אליהם</span></div>',
      '<div class="drawer__stat"><b style="font-size:.95rem;">' + esc(joined) + '</b><span>תאריך הרשמה</span></div>',
      '<div class="drawer__stat"><b style="font-size:.95rem;">' + esc(seen) + '</b><span>כניסה אחרונה</span></div>'
    ].join('');

    var onb = r.onboarding;
    if (!onb) {
      $('drawerAnswers').innerHTML =
        // Copy corrected 2026-08-09: the questionnaire used to open for any
        // visitor on the home page. It now opens only after the account
        // exists, on the first visit while logged in.
        '<p class="qa--empty">הלומד עדיין לא מילא את שאלון הכניסה. השאלון עולה אוטומטית בביקור הראשון בדף הבית ' +
        'אחרי פתיחת החשבון, ואפשר לפתוח אותו שוב מכפתור "ברוך הבא לפורטל" בסרגל הצד.</p>';
    } else {
      var answers = onb.answers || {};
      var items = QUESTION_ORDER.map(function (qid) {
        var a = answers[qid];
        if (!a) return '';
        var label = (typeof a === 'object') ? a.label : a;
        return '<li><span class="qa__q">' + esc(QUESTION_LABELS[qid] || qid) + '</span>' +
               '<span class="qa__a">' + esc(label) + '</span></li>';
      }).filter(Boolean);

      if (!items.length) {
        $('drawerAnswers').innerHTML = '<p class="qa--empty">השאלון נפתח אבל לא נענתה אף שאלה.</p>';
      } else {
        var status = onb.completed_at
          ? 'הושלם ב-' + (fmtDate(onb.completed_at) || '')
          : 'נענו ' + items.length + ' מתוך 6 שאלות';
        $('drawerAnswers').innerHTML =
          '<ul class="qa">' + items.join('') + '</ul>' +
          '<p class="qa--empty" style="margin-top:.6rem;font-size:.76rem;">' + esc(status) + '</p>';
      }
    }

    $('drawer').hidden = false;
    document.body.style.overflow = 'hidden';
    try { $('drawerClose').focus(); } catch (e) {}
  }

  function closeDrawer() {
    $('drawer').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------------------------------------------------------------- load */

  async function render() {
    $('loading').classList.remove('hidden');

    var results = await Promise.all([
      fetchAll('profiles', 'id, email, full_name, created_at, last_seen_at, role'),
      fetchAll('course_progress', 'user_id'),
      fetchAll('quiz_scores', 'user_id, best_score, total'),
      fetchAll('onboarding_answers', 'user_id, answers, steps_done, completed_at')
    ]);
    var profiles = results[0], progress = results[1], quizzes = results[2], onboarding = results[3];

    var lessonsBy = {};
    progress.forEach(function (p) { lessonsBy[p.user_id] = (lessonsBy[p.user_id] || 0) + 1; });

    var quizBy = {};
    quizzes.forEach(function (q) {
      var a = quizBy[q.user_id] || (quizBy[q.user_id] = { n: 0, sum: 0 });
      a.n++;
      a.sum += (q.best_score / (q.total || 5)) * 100;
    });

    var onbBy = {};
    onboarding.forEach(function (o) { onbBy[o.user_id] = o; });

    rows = profiles.map(function (p) {
      var qa = quizBy[p.id];
      return {
        id: p.id,
        email: p.email || '',
        full_name: (p.full_name || '').trim(),
        created_at: p.created_at || '',
        last_seen_at: p.last_seen_at || '',
        role: p.role || 'user',
        lessons: lessonsBy[p.id] || 0,
        quizCount: qa ? qa.n : 0,
        quizAvg: qa && qa.n ? (qa.sum / qa.n) : 0,
        onboarding: onbBy[p.id] || null
      };
    });

    var weekAgo = Date.now() - 7 * 86400000;
    $('stat-users').textContent = rows.length;
    $('stat-named').textContent = rows.filter(function (r) { return !!r.full_name; }).length;
    $('stat-onboarded').textContent = rows.filter(function (r) { return !!r.onboarding; }).length;
    $('stat-active').textContent = rows.filter(function (r) { return r.lessons > 0; }).length;
    $('stat-week').textContent = rows.filter(function (r) {
      var t = Date.parse(r.created_at);
      return isFinite(t) && t >= weekAgo;
    }).length;

    applyFilters();

    $('loading').classList.add('hidden');
    $('dash').classList.remove('hidden');
  }

  /* ---------------------------------------------------------------- gate */

  async function applyAuthState() {
    var user = window.bwcAuth && window.bwcAuth.getUser();
    if (!user) {
      $('gate').classList.remove('hidden');
      $('dash').classList.add('hidden');
      $('gateMsg').textContent = 'התחבר עם חשבון מנהל כדי לצפות בדשבורד.';
      return;
    }
    var admin = await isAdmin(user.id);
    if (!admin) {
      $('gate').classList.remove('hidden');
      $('dash').classList.add('hidden');
      $('gateMsg').textContent = 'החשבון שלך אינו חשבון מנהל. הדשבורד זמין למנהלי המערכת בלבד.';
      return;
    }
    $('gate').classList.add('hidden');
    render().catch(function (err) {
      console.error('[admin-users]', err);
      $('loading').classList.remove('hidden');
      $('loading').textContent = 'שגיאה בטעינת הנתונים. בדוק את הקונסול.';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('q').addEventListener('input', applyFilters);
    $('sort').addEventListener('change', applyFilters);

    $('usersBody').addEventListener('click', function (e) {
      var tr = e.target && e.target.closest ? e.target.closest('tr[data-uid]') : null;
      if (tr) openDrawer(tr.getAttribute('data-uid'));
    });
    $('usersBody').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target && e.target.closest ? e.target.closest('tr[data-uid]') : null;
      if (tr) { e.preventDefault(); openDrawer(tr.getAttribute('data-uid')); }
    });

    $('drawerClose').addEventListener('click', closeDrawer);
    $('drawer').addEventListener('click', function (e) {
      if (e.target === $('drawer')) closeDrawer();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer();
    });

    var gateBtn = $('gateLoginBtn');
    if (gateBtn) {
      gateBtn.addEventListener('click', function () {
        if (window.bwcAuthModal) window.bwcAuthModal.open('login');
      });
    }

    if (window.bwcAuth) {
      window.bwcAuth.ready().then(applyAuthState);
      window.bwcAuth.onChange(applyAuthState);
    }
  });
})();
