/* ==========================================================================
   admin-users.js — per-learner admin dashboard (pages/admin-users.html).

   Sibling of admin-stats.js, but the opposite privacy posture on purpose:
   admin-stats is aggregate-only (no names ever), this page IS the roster —
   who signed up, what exactly they learned, where they stand right now, and
   what they answered in the onboarding questionnaire.

   Access: profiles.role = 'admin', checked with the is_admin() RPC
   (SECURITY DEFINER, migration 004). The rows come back because of the
   *_admin_select RLS policies on profiles / course_progress / quiz_scores /
   practice_stats / onboarding_answers / application_docs. A non-admin session
   gets empty arrays, not an error — so we gate on the RPC before rendering.

   Contact fields: name + email only. There is no phone anywhere in this
   system (decision, 2026-08-07).

   ---------------------------------------------------------------------------
   2026-08-09 rebuild — "I can't see who the users are and what they learned"
   ---------------------------------------------------------------------------
   The old version showed name / email / date / lesson count / average quiz
   score. That is a tally, not a person. This version resolves every raw
   lesson_key (m3-1-2) against js/course-data.js so the drawer shows the real
   module, week and lesson titles, and adds the three signals that were
   missing entirely: practice, application docs, and where the learner
   actually stopped.

   TWO DATA HONESTY NOTES, both surfaced in the UI and not just here:

   1. "שיעורים שסומנו" counts rows in course_progress, i.e. lessons the
      learner pressed "סמן כהושלם" on. It is NOT watch time — the portal does
      not measure playback at all.

   2. Cloud sync USED to be one-time-per-device: progress made after the first
      login never left the learner's browser. Fixed in js/sync-localstorage.js,
      but the fix is NOT retroactive — historical progress only arrives when
      the learner next opens the portal on that device. So for older accounts
      every number here is a FLOOR, not a ceiling.

   And a third, new: profiles.last_seen_at is dead. touch_last_seen() exists in
   migration 001 but NOTHING in the client has ever called it, so the column is
   NULL for every account and the old "כניסה אחרונה" column was permanently
   blank. Rather than show an empty column we derive "פעילות אחרונה" from the
   learning data itself (newest of: lesson completion / quiz attempt / practice
   session / application doc). That works retroactively and needs no migration.
   The trade-off is stated in the UI: a learner who logs in and only browses
   does not count as active.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var DAY = 86400000;
  var ACTIVE_DAYS = 7;    // active if they did something within a week
  var SLOWING_DAYS = 21;  // beyond this and they are treated as stuck

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

  /* An empty status filter is not always a failure. Zero stuck learners is
     the best possible result, and the screen should say so. */
  var EMPTY_FILTER_COPY = {
    stuck:   ['אף לומד לא תקוע', 'כל מי שהתחיל ללמוד נגע בקורס ב-21 הימים האחרונים. אין כרגע מי לדחוף.'],
    slowing: ['אף לומד לא מאט', 'אין לומד שנעלם בין שבוע לשלושה שבועות.'],
    active:  ['אף לומד לא היה פעיל השבוע', 'אף אחד לא סימן שיעור, ניגש למבחן, תרגל או הפיק מסמך יישום ב-7 הימים האחרונים.'],
    new:     ['כולם כבר התחילו', 'אין לומד רשום שעדיין לא עשה שום דבר בקורס.']
  };

  var rows = [];        // merged learner records
  var LESSONS = [];     // flat, ordered lesson index built from course-data.js
  var GROUPS = [];      // display groups: 8 modules + one seminars group
  var TOTAL_LESSONS = 0;

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
    return Math.floor((Date.now() - d.getTime()) / DAY);
  }

  /* Hebrew counts read badly with a bare number at 1 ("1 מבחנים", "לפני 1 ימים"). */
  function agoLabel(days) {
    if (days === null) return null;
    if (days <= 0) return 'היום';
    if (days === 1) return 'אתמול';
    if (days === 2) return 'שלשום';
    if (days < 31) return 'לפני ' + days + ' ימים';
    var months = Math.round(days / 30);
    if (months === 1) return 'לפני חודש';
    if (months === 2) return 'לפני חודשיים';
    if (months < 12) return 'לפני ' + months + ' חודשים';
    return 'לפני יותר משנה';
  }

  function plural(n, one, two, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    return many.replace('%', n);
  }

  /* Newest of a list of ISO strings (nulls ignored). */
  function maxIso() {
    var best = '';
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v && v > best) best = v;
    }
    return best;
  }

  function bar(pct, mod) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    return '<div class="adm-bar' + (mod ? ' ' + mod : '') + '" title="' + p + '%">' +
           '<div class="adm-bar__fill" style="inline-size:' + p + '%"></div></div>';
  }

  /* ------------------------------------------------- course index (real names) */

  /* Turns js/course-data.js into an ordered, flat lesson list so a raw
     lesson_key from the database ("m3-1-2", "s0-1") can be shown as the
     actual lesson the learner watched. Key format must stay identical to
     js/library.js buildFlatList() — that is the writer. */
  function buildCourseIndex() {
    LESSONS = [];
    GROUPS = [];

    if (typeof MODULES === 'undefined' || typeof SEMINARS === 'undefined') {
      console.error('[admin-users] course-data.js did not load — module names unavailable.');
      return;
    }

    MODULES.forEach(function (mod, mi) {
      var group = {
        id: 'm' + mi,
        kind: 'module',
        moduleIdx: mi,
        label: 'מודול ' + (mi + 1) + ': ' + mod.title,
        lessons: []
      };
      mod.weeks.forEach(function (week, wi) {
        week.days.forEach(function (day, di) {
          var lesson = {
            key: 'm' + mi + '-' + wi + '-' + di,
            group: group,
            title: day.title,
            context: week.title,
            order: LESSONS.length
          };
          LESSONS.push(lesson);
          group.lessons.push(lesson);
        });
      });
      GROUPS.push(group);
    });

    /* Seminars are part of the course (getTotalLessonCount counts them), so
       they get their own display group rather than being silently dropped. */
    var semGroup = { id: 'sem', kind: 'seminars', moduleIdx: null, label: 'סמינרים', lessons: [] };
    SEMINARS.forEach(function (sem, si) {
      sem.parts.forEach(function (part, pi) {
        var lesson = {
          key: 's' + si + '-' + pi,
          group: semGroup,
          title: part.title === 'הסמינר המלא' ? sem.title : part.title,
          context: sem.title,
          order: LESSONS.length
        };
        LESSONS.push(lesson);
        semGroup.lessons.push(lesson);
      });
    });
    GROUPS.push(semGroup);

    TOTAL_LESSONS = LESSONS.length;
  }

  function lessonByKey(key) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].key === key) return LESSONS[i];
    return null;
  }

  function moduleTitle(idx) {
    if (typeof MODULES === 'undefined' || !MODULES[idx]) return 'מודול ' + (idx + 1);
    return 'מודול ' + (idx + 1) + ': ' + MODULES[idx].title;
  }

  /* ------------------------------------------------------------- data load */

  async function isAdmin(userId) {
    try {
      var res = await window.bwcSupabase.rpc('is_admin', { uid: userId });
      return !res.error && res.data === true;
    } catch (e) { return false; }
  }

  /* Paged fetch so we never silently cap at Supabase's default 1000 rows.
     A missing table (42P01 = migration not applied yet) logs and returns what
     we have instead of taking the whole dashboard down. */
  async function fetchAll(table, columns) {
    var out = [];
    var PAGE = 1000;
    for (var from = 0; ; from += PAGE) {
      var res = await window.bwcSupabase.from(table).select(columns).range(from, from + PAGE - 1);
      if (res.error) {
        console.warn('[admin-users] ' + table + ':', res.error.message);
        break;
      }
      var data = res.data || [];
      out.push.apply(out, data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  /* ------------------------------------------------------- learner shaping */

  function buildLearner(p, progress, quizzes, practice, onboarding, docs) {
    var doneAt = {};                 // lesson_key -> completed_at
    var lessonsDone = 0;
    var lastCompletedIso = '';
    var lastLesson = null;

    progress.forEach(function (row) {
      doneAt[row.lesson_key] = row.completed_at || '';
      lessonsDone++;
      if ((row.completed_at || '') > lastCompletedIso) {
        lastCompletedIso = row.completed_at || '';
        lastLesson = lessonByKey(row.lesson_key);
      }
    });

    /* Per-group breakdown with the real titles. */
    var groups = GROUPS.map(function (g) {
      var done = 0;
      var lessons = g.lessons.map(function (l) {
        var at = Object.prototype.hasOwnProperty.call(doneAt, l.key) ? (doneAt[l.key] || true) : null;
        if (at) done++;
        return { key: l.key, title: l.title, context: l.context, at: (at === true ? '' : at), done: !!at };
      });
      return { id: g.id, kind: g.kind, moduleIdx: g.moduleIdx, label: g.label,
               done: done, total: g.lessons.length, lessons: lessons };
    });

    /* "Where he is now" = the group of the most recently completed lesson.
       Falls back to the furthest group with any progress, so a learner whose
       rows arrived without timestamps still lands somewhere sensible. */
    var currentGroup = lastLesson ? lastLesson.group : null;
    if (!currentGroup) {
      for (var gi = groups.length - 1; gi >= 0; gi--) {
        if (groups[gi].done > 0) { currentGroup = GROUPS[gi]; break; }
      }
    }

    /* "Where he stopped" = first uncompleted lesson at or after the last one
       he finished. This is the concrete next click, not a guess. */
    var nextLesson = null;
    var startFrom = lastLesson ? lastLesson.order + 1 : 0;
    for (var i = startFrom; i < LESSONS.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(doneAt, LESSONS[i].key)) { nextLesson = LESSONS[i]; break; }
    }
    if (!nextLesson) {
      for (var j = 0; j < LESSONS.length; j++) {
        if (!Object.prototype.hasOwnProperty.call(doneAt, LESSONS[j].key)) { nextLesson = LESSONS[j]; break; }
      }
    }

    /* Quizzes */
    var quizRows = quizzes.slice().sort(function (a, b) { return a.module_idx - b.module_idx; });
    var quizSum = 0, quizPassed = 0, quizLastIso = '';
    quizRows.forEach(function (q) {
      quizSum += (q.best_score / (q.total || 5)) * 100;
      if (q.passed) quizPassed++;
      quizLastIso = maxIso(quizLastIso, q.updated_at);
    });
    var quizAvg = quizRows.length ? quizSum / quizRows.length : 0;

    /* Practice */
    var pr = practice || null;
    var challengesDone = 0;
    if (pr && pr.challenges_completed && typeof pr.challenges_completed === 'object') {
      challengesDone = Object.keys(pr.challenges_completed).length;
    }
    var practiceIso = pr
      ? maxIso(pr.updated_at, pr.last_practice_date ? pr.last_practice_date + 'T00:00:00Z' : '')
      : '';

    /* Application docs */
    var docRows = (docs || []).slice().sort(function (a, b) { return a.module_idx - b.module_idx; });
    var docsIso = '';
    docRows.forEach(function (d) { docsIso = maxIso(docsIso, d.updated_at, d.created_at); });

    /* Last activity — derived from the learning itself, see file header. */
    var lastActivity = maxIso(lastCompletedIso, quizLastIso, practiceIso, docsIso);
    var hasAnyActivity = lessonsDone > 0 || quizRows.length > 0 || challengesDone > 0 || docRows.length > 0;

    var pct = TOTAL_LESSONS ? (lessonsDone / TOTAL_LESSONS) * 100 : 0;
    var days = daysAgo(lastActivity);

    var status;
    if (!hasAnyActivity) {
      status = { key: 'new', label: 'טרם התחיל', cls: 'adm-pill--none' };
    } else if (lessonsDone >= TOTAL_LESSONS && TOTAL_LESSONS > 0) {
      status = { key: 'done', label: 'סיים את הקורס', cls: 'adm-pill--good' };
    } else if (days === null || days <= ACTIVE_DAYS) {
      status = { key: 'active', label: 'פעיל', cls: 'adm-pill--good' };
    } else if (days <= SLOWING_DAYS) {
      status = { key: 'slowing', label: 'מאט', cls: 'adm-pill--warn' };
    } else {
      status = { key: 'stuck', label: 'תקוע', cls: 'adm-pill--stuck' };
    }

    return {
      id: p.id,
      email: p.email || '',
      full_name: (p.full_name || '').trim(),
      created_at: p.created_at || '',
      role: p.role || 'user',

      lessons: lessonsDone,
      pct: pct,
      groups: groups,
      currentGroup: currentGroup,
      lastLesson: lastLesson,
      lastLessonAt: lastCompletedIso,
      nextLesson: nextLesson,

      quizRows: quizRows,
      quizAvg: quizAvg,
      quizPassed: quizPassed,

      practice: pr,
      challengesDone: challengesDone,

      docs: docRows,

      onboarding: onboarding || null,
      lastActivity: lastActivity,
      lastActivityDays: days,
      hasAnyActivity: hasAnyActivity,
      status: status
    };
  }

  /* ------------------------------------------------------------ rendering */

  function displayName(r) {
    if (r.full_name) return esc(r.full_name);
    return '<span class="adm-name__none">ללא שם</span>';
  }

  function renderRows(list) {
    var body = $('usersBody');
    var table = $('tbl-users');

    $('emptyFilter').hidden = true;
    $('emptyAll').hidden = true;

    if (!list.length) {
      body.innerHTML = '';
      table.hidden = true;
      $('rowCount').textContent = '';
      /* Three very different silences: nobody signed up yet, the search
         matched nothing, or the status filter is empty — and an empty
         "תקועים" filter is GOOD news, not a failure. Saying "אין לומדים"
         for all three is how a dashboard starts lying. */
      if (!rows.length) { $('emptyAll').hidden = false; return; }

      var f = $('filter').value;
      var msg = EMPTY_FILTER_COPY[f];
      if (msg && !($('q').value || '').trim()) {
        $('emptyFilterTitle').textContent = msg[0];
        $('emptyFilterBody').textContent = msg[1];
      } else {
        $('emptyFilterTitle').textContent = 'אין לומד שתואם';
        $('emptyFilterBody').textContent = 'נסה שם חלקי, כתובת מייל אחרת, או החזר את הסינון ל"כל הלומדים".';
      }
      $('emptyFilter').hidden = false;
      return;
    }

    table.hidden = false;
    $('rowCount').textContent = (list.length === rows.length)
      ? 'מציג ' + list.length
      : 'מציג ' + list.length + ' מתוך ' + rows.length;

    body.innerHTML = list.map(function (r) {
      var whereTxt = r.currentGroup
        ? esc(r.currentGroup.label)
        : '<span class="adm-muted">טרם התחיל</span>';

      var ago = agoLabel(r.lastActivityDays);
      var seenTxt = r.lastActivity
        ? esc(ago) + ' <span class="adm-muted">(' + esc(fmtDate(r.lastActivity)) + ')</span>'
        : '<span class="adm-muted">אין פעילות</span>';

      var onbTxt = r.onboarding
        ? '<span class="adm-pill">' + (r.onboarding.completed_at ? 'מלא' : (r.onboarding.steps_done || 0) + '/6') + '</span>'
        : '<span class="adm-pill adm-pill--none">לא מילא</span>';

      return '<tr class="is-clickable" data-uid="' + esc(r.id) + '" tabindex="0" role="button" ' +
                 'aria-label="פתח את תיק הלומד ' + esc(r.full_name || r.email) + '">' +
        '<td data-cell="name" class="adm-name">' + displayName(r) + '</td>' +
        '<td data-label="מייל" class="adm-email">' + esc(r.email) + '</td>' +
        '<td data-label="התקדמות" data-cell="progress">' +
          '<div class="adm-barline">' + bar(r.pct) +
          '<span class="adm-num">' + Math.round(r.pct) + '%</span></div>' +
          '<span class="adm-muted" style="font-size:.72rem;">' + r.lessons + ' מתוך ' + TOTAL_LESSONS + ' שיעורים</span>' +
        '</td>' +
        '<td data-label="נמצא עכשיו">' + whereTxt + '</td>' +
        '<td data-label="פעילות אחרונה" class="adm-num">' + seenTxt + '</td>' +
        '<td data-label="מצב"><span class="adm-pill ' + r.status.cls + '">' + esc(r.status.label) + '</span></td>' +
        '<td data-label="שאלון">' + onbTxt + '</td>' +
      '</tr>';
    }).join('');
  }

  function applyFilters() {
    var q = ($('q').value || '').trim().toLowerCase();
    var status = $('filter').value;
    var sort = $('sort').value;

    var list = rows.filter(function (r) {
      if (status !== 'all' && r.status.key !== status) return false;
      if (!q) return true;
      return (r.full_name || '').toLowerCase().indexOf(q) !== -1 ||
             (r.email || '').toLowerCase().indexOf(q) !== -1;
    });

    var cmp = {
      /* Default order is the actionable one: the learner who has been silent
         longest sits at the top. Learners who never started have no activity
         date at all — they belong at the bottom, not pretending to be the
         most urgent. */
      activity_desc: function (a, b) {
        if (!a.lastActivity && !b.lastActivity) return 0;
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return a.lastActivity.localeCompare(b.lastActivity);
      },
      progress_desc: function (a, b) { return b.lessons - a.lessons; },
      created_desc:  function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); },
      name_asc:      function (a, b) { return (a.full_name || 'תתת').localeCompare(b.full_name || 'תתת', 'he'); }
    }[sort];

    if (cmp) list.sort(cmp);
    renderRows(list);
  }

  /* -------------------------------------------------------------- drawer */

  function drawerHead(r) {
    $('drawerName').innerHTML = displayName(r);
    $('drawerEmail').textContent = r.email || '';

    var tags = ['<span class="adm-pill ' + r.status.cls + '">' + esc(r.status.label) + '</span>'];
    if (r.role === 'admin') tags.push('<span class="adm-pill adm-pill--teal">מנהל</span>');
    if (r.currentGroup) tags.push('<span class="adm-pill adm-pill--teal">' + esc(r.currentGroup.label) + '</span>');
    $('drawerTags').innerHTML = tags.join('');

    var lastAct = r.lastActivity ? agoLabel(r.lastActivityDays) : 'אין פעילות';
    $('drawerStats').innerHTML = [
      '<div class="adm-drawer__stat"><b>' + Math.round(r.pct) + '%</b><span>מהקורס</span></div>',
      '<div class="adm-drawer__stat"><b>' + r.lessons + '</b><span>שיעורים שסומנו</span></div>',
      '<div class="adm-drawer__stat"><b>' + (r.quizRows.length ? Math.round(r.quizAvg) + '%' : '—') + '</b><span>ציון מבחן ממוצע</span></div>',
      '<div class="adm-drawer__stat"><b>' + (r.practice ? (r.practice.total_xp || 0) : 0) + '</b><span>נקודות תרגול</span></div>',
      '<div class="adm-drawer__stat"><b>' + r.docs.length + '</b><span>מסמכי יישום</span></div>',
      '<div class="adm-drawer__stat"><b class="is-text">' + esc(fmtDate(r.created_at) || '—') + '</b><span>תאריך הרשמה</span></div>',
      '<div class="adm-drawer__stat"><b class="is-text">' + esc(lastAct) + '</b><span>פעילות אחרונה</span></div>'
    ].join('');
  }

  function drawerOnboarding(r) {
    var onb = r.onboarding;
    if (!onb) {
      $('drawerAnswers').innerHTML =
        /* Copy corrected 2026-08-09: the questionnaire used to open for any
           visitor on the home page. It now opens only after the account
           exists, on the first visit while logged in. */
        '<p class="adm-blank">הלומד עדיין לא מילא את שאלון הכניסה, אז אין לנו את התמונה העסקית שלו — ' +
        'לא את שלב העסק, לא מה הוא מוכר ולא את החומה שעוצרת אותו. השאלון עולה אוטומטית בביקור הראשון ' +
        'בדף הבית אחרי פתיחת החשבון, ואפשר לפתוח אותו שוב מכפתור "ברוך הבא לפורטל" בסרגל הצד.</p>';
      return;
    }

    var answers = onb.answers || {};
    var items = QUESTION_ORDER.map(function (qid) {
      var a = answers[qid];
      if (!a) return '';
      var label = (typeof a === 'object') ? a.label : a;
      return '<li><span class="adm-qa__q">' + esc(QUESTION_LABELS[qid] || qid) + '</span>' +
             '<span class="adm-qa__a">' + esc(label) + '</span></li>';
    }).filter(Boolean);

    if (!items.length) {
      $('drawerAnswers').innerHTML = '<p class="adm-blank">השאלון נפתח אבל לא נענתה אף שאלה.</p>';
      return;
    }

    var status = onb.completed_at
      ? 'השאלון הושלם ב-' + (fmtDate(onb.completed_at) || '')
      : 'נענו ' + items.length + ' מתוך 6 שאלות';
    $('drawerAnswers').innerHTML =
      '<ul class="adm-qa">' + items.join('') + '</ul>' +
      '<p class="adm-note">' + esc(status) + '</p>';
  }

  function drawerModules(r) {
    if (!TOTAL_LESSONS) {
      $('drawerModules').innerHTML = '<p class="adm-blank">מבנה הקורס לא נטען, אי אפשר להציג שמות שיעורים.</p>';
      return;
    }

    var head = '';
    if (r.lastLesson) {
      head = '<p class="adm-note" style="margin-block-start:0;">' +
        '<strong>השיעור האחרון שנגע בו:</strong> ' + esc(r.lastLesson.title) +
        ' <span class="adm-muted">(' + esc(r.lastLesson.context) + ' · ' + esc(r.lastLesson.group.label) + ')</span>' +
        (r.lastLessonAt ? ' — ' + esc(fmtDate(r.lastLessonAt)) : '') +
        (r.nextLesson
          ? '<br><strong>עצר לפני:</strong> ' + esc(r.nextLesson.title) +
            ' <span class="adm-muted">(' + esc(r.nextLesson.context) + ' · ' + esc(r.nextLesson.group.label) + ')</span>'
          : '<br><strong>סיים את כל השיעורים.</strong>') +
        '</p>';
    } else {
      head = '<p class="adm-blank">הלומד עדיין לא סימן אף שיעור כהושלם.</p>';
    }

    var mods = r.groups.map(function (g, gi) {
      var pct = g.total ? (g.done / g.total) * 100 : 0;
      var isEmpty = g.done === 0;

      var lessonsHtml = g.lessons.map(function (l) {
        var isLast = r.lastLesson && r.lastLesson.key === l.key;
        return '<li class="adm-lesson ' + (l.done ? 'adm-lesson--done' : 'adm-lesson--todo') +
               (isLast ? ' adm-lesson--last' : '') + '">' +
          '<i class="fa-solid ' + (l.done ? 'fa-circle-check' : 'fa-circle') + '" aria-hidden="true"></i>' +
          '<span class="adm-lesson__name">' + esc(l.context) + ' · ' + esc(l.title) + '</span>' +
          '<span class="adm-lesson__when">' + (l.done ? esc(fmtDate(l.at) || 'סומן') : '') + '</span>' +
        '</li>';
      }).join('');

      var bodyId = 'modbody-' + gi;
      return '<div class="adm-mod' + (isEmpty ? ' adm-mod--empty' : '') + '">' +
        '<button type="button" class="adm-mod__btn" aria-expanded="false" aria-controls="' + bodyId + '" data-mod="' + gi + '">' +
          '<span class="adm-mod__idx">' + (g.kind === 'seminars' ? '<i class="fa-solid fa-microphone-lines" aria-hidden="true"></i>' : (g.moduleIdx + 1)) + '</span>' +
          '<span class="adm-mod__main">' +
            '<span class="adm-mod__name">' + esc(g.kind === 'seminars' ? g.label : (MODULES[g.moduleIdx] ? MODULES[g.moduleIdx].title : g.label)) + '</span>' +
            '<span class="adm-mod__meta">' + bar(pct, g.kind === 'seminars' ? 'adm-bar--teal' : '') +
              '<span class="adm-mod__count">' + g.done + '/' + g.total + '</span>' +
            '</span>' +
          '</span>' +
          '<i class="fa-solid fa-chevron-down adm-mod__chev" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="adm-mod__body" id="' + bodyId + '" hidden><ul class="adm-lessons">' + lessonsHtml + '</ul></div>' +
      '</div>';
    }).join('');

    $('drawerModules').innerHTML = head + '<div class="adm-mods">' + mods + '</div>';
  }

  function drawerQuiz(r) {
    if (!r.quizRows.length) {
      $('drawerQuiz').innerHTML = '<p class="adm-blank">הלומד עדיין לא ניגש לאף מבחן מודול.</p>';
      return;
    }
    var body = r.quizRows.map(function (q) {
      var pct = Math.round((q.best_score / (q.total || 5)) * 100);
      return '<tr>' +
        '<td class="adm-mini__name">' + esc(moduleTitle(q.module_idx)) + '</td>' +
        '<td class="adm-num">' + q.best_score + '/' + (q.total || 5) + ' <span class="adm-muted">(' + pct + '%)</span></td>' +
        '<td class="adm-num">' + (q.attempts || 0) + '</td>' +
        '<td>' + (q.passed
          ? '<span class="adm-pill adm-pill--good">עבר</span>'
          : '<span class="adm-pill adm-pill--warn">לא עבר</span>') + '</td>' +
      '</tr>';
    }).join('');

    $('drawerQuiz').innerHTML =
      '<div class="adm-scroll"><table class="adm-mini">' +
        '<thead><tr><th>מודול</th><th>ציון הכי טוב</th><th>ניסיונות</th><th>סטטוס</th></tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>' +
      '<p class="adm-note">' + r.quizPassed + ' מתוך ' + r.quizRows.length +
        ' ' + plural(r.quizRows.length, 'המבחן עבר', 'המבחנים עברו', 'המבחנים עברו') +
        ' (סף מעבר 80%).</p>';
  }

  function drawerPractice(r) {
    var pr = r.practice;
    if (!pr || (!pr.total_xp && !r.challengesDone)) {
      $('drawerPractice').innerHTML = '<p class="adm-blank">הלומד עדיין לא תרגל אף אתגר.</p>';
      return;
    }
    var last = pr.last_practice_date ? fmtDate(pr.last_practice_date + 'T00:00:00Z') : null;
    $('drawerPractice').innerHTML =
      '<div class="adm-drawer__stats">' +
        '<div class="adm-drawer__stat"><b>' + (pr.total_xp || 0) + '</b><span>נקודות (XP)</span></div>' +
        '<div class="adm-drawer__stat"><b>' + (pr.current_streak || 0) + '</b><span>רצף נוכחי (ימים)</span></div>' +
        '<div class="adm-drawer__stat"><b>' + (pr.longest_streak || 0) + '</b><span>הרצף הארוך ביותר</span></div>' +
        '<div class="adm-drawer__stat"><b>' + r.challengesDone + '</b><span>אתגרים שנפתרו</span></div>' +
        '<div class="adm-drawer__stat"><b class="is-text">' + esc(last || '—') + '</b><span>תרגול אחרון</span></div>' +
      '</div>';
  }

  function drawerApply(r) {
    if (!r.docs.length) {
      $('drawerApply').innerHTML =
        '<p class="adm-blank">הלומד עדיין לא הפיק מסמך יישום. עוזר היישום נמצא בתפריט "עוד" ' +
        'ומפיק מסמך אישי אחד לכל מודול.</p>';
      return;
    }
    var body = r.docs.map(function (d) {
      return '<tr>' +
        '<td class="adm-mini__name">' + esc(moduleTitle(d.module_idx)) + '</td>' +
        '<td>' + esc(d.title || 'מסמך יישום') + '</td>' +
        '<td class="adm-num">' + esc(fmtDate(d.updated_at || d.created_at) || '—') + '</td>' +
      '</tr>';
    }).join('');
    $('drawerApply').innerHTML =
      '<div class="adm-scroll"><table class="adm-mini">' +
        '<thead><tr><th>מודול</th><th>כותרת</th><th>עודכן</th></tr></thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  function openDrawer(uid) {
    var r = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === uid) { r = rows[i]; break; } }
    if (!r) return;

    drawerHead(r);
    drawerOnboarding(r);
    drawerModules(r);
    drawerQuiz(r);
    drawerPractice(r);
    drawerApply(r);

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
      fetchAll('profiles', 'id, email, full_name, created_at, role'),
      fetchAll('course_progress', 'user_id, lesson_key, completed_at'),
      fetchAll('quiz_scores', 'user_id, module_idx, best_score, attempts, passed, total, updated_at'),
      fetchAll('practice_stats', 'user_id, total_xp, current_streak, longest_streak, last_practice_date, challenges_completed, updated_at'),
      fetchAll('onboarding_answers', 'user_id, answers, steps_done, completed_at'),
      fetchAll('application_docs', 'user_id, module_idx, title, created_at, updated_at')
    ]);
    var profiles = results[0], progress = results[1], quizzes = results[2],
        practice = results[3], onboarding = results[4], docs = results[5];

    function groupBy(list) {
      var m = {};
      list.forEach(function (x) { (m[x.user_id] || (m[x.user_id] = [])).push(x); });
      return m;
    }
    var progressBy = groupBy(progress);
    var quizBy = groupBy(quizzes);
    var docsBy = groupBy(docs);

    var practiceBy = {};
    practice.forEach(function (x) { practiceBy[x.user_id] = x; });
    var onbBy = {};
    onboarding.forEach(function (o) { onbBy[o.user_id] = o; });

    rows = profiles.map(function (p) {
      return buildLearner(
        p,
        progressBy[p.id] || [],
        quizBy[p.id] || [],
        practiceBy[p.id] || null,
        onbBy[p.id] || null,
        docsBy[p.id] || []
      );
    });

    $('stat-users').textContent = rows.length;
    $('stat-started').textContent = rows.filter(function (r) { return r.hasAnyActivity; }).length;
    $('stat-active').textContent = rows.filter(function (r) { return r.status.key === 'active'; }).length;
    $('stat-stuck').textContent = rows.filter(function (r) { return r.status.key === 'stuck'; }).length;
    $('stat-onboarded').textContent = rows.filter(function (r) { return !!r.onboarding; }).length;

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
    buildCourseIndex();

    $('q').addEventListener('input', applyFilters);
    $('filter').addEventListener('change', applyFilters);
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

    /* Per-module accordion inside the drawer (delegated — the markup is
       rebuilt on every open). */
    $('drawerModules').addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.adm-mod__btn') : null;
      if (!btn) return;
      var body = document.getElementById(btn.getAttribute('aria-controls'));
      if (!body) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
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
        else if (window.openLoginModal) window.openLoginModal();
      });
    }

    if (window.bwcAuth) {
      window.bwcAuth.ready().then(applyAuthState);
      window.bwcAuth.onChange(applyAuthState);
    }
  });
})();
