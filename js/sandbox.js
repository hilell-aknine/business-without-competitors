/* ==========================================================================
   sandbox.js — client of pages/sandbox.html (חדר האימון). Added 2026-11-16,
   pilot on module 2 (moduleIdx 1).

   Flow: [follow-up of the last if-then plan] -> start screen (level, concept,
   3 short business questions if there is no application doc) -> exercises
   1..5, each a short chat with /api/sandbox -> summary.

   Personal from existing sources only:
     * application_docs (migration 005): what the learner sells, to whom
     * bwc_game_v1.missed / perfectLessonsList: what they got wrong in the
       game of this module (js/game.js records misses since 2026-11-16)
     * the level they pick: קליל / בלי הנחות

   Storage: localStorage first, always (bwc_sandbox_v1_m<idx>, bound to the
   user id), and the cloud copy in the migration 014 tables when they exist.
   If a table is missing the page keeps working on localStorage alone.
   ========================================================================== */
(function () {
  'use strict';

  var PILOT_MODULES = [1];
  var STATE_PREFIX = 'bwc_sandbox_v1_m';
  var PLAN_PREFIX = 'bwc_sandbox_plan_v1_m';
  var PROFILE_KEY = 'bwc_sandbox_profile_v1';
  var DRAFT_PREFIX = 'bwc_sandbox_draft_v1_m';
  var CLOUD_MISSING_KEY = 'bwc_sandbox_cloud_missing';
  var MAX_ANSWER = 4000;
  var FOLLOWUP_AFTER_MS = 6 * 60 * 60 * 1000;

  var EX = {
    1: { name: 'תלמד אותי', icon: 'fa-chalkboard-user', what: 'מסבירים את המושג למתחיל סקרן, מהזיכרון. השיעור נעול עד הסוף.' },
    2: { name: 'המראה', icon: 'fa-user-pen', what: 'כותבים איך המושג ייראה אצלך בעסק מחר בבוקר, עד שזה מוחשי.' },
    3: { name: 'הלקוח הספקן', icon: 'fa-user-tie', what: 'לקוח מהנישה שלך עם התנגדות אמיתית. אחרי כמה הודעות המנטור יוצא מהדמות ונותן משוב.' },
    4: { name: 'פרה-מורטם', icon: 'fa-magnifying-glass-chart', what: 'עברו שישה חודשים והתוכנית נכשלה. למה? ואיך מונעים את זה מראש.' },
    5: { name: 'אם-אז', icon: 'fa-flag-checkered', what: 'משפט התחייבות אחד. בכניסה הבאה נשאל אותך איך הלך.' },
  };

  var $view, $steps;
  var moduleIdx = 1;
  var user = null;
  var state = null;       // the current session
  var ctx = { profile: null, docText: '', weakLines: [], weakTerms: [], concepts: [] };
  var sending = false;
  var composer = null;
  var forceQuestions = false;   // "לעדכן פרטים" on the start screen

  /* ------------------------------------------------------------ helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function md(text) {
    // Paragraphs + **bold** only. Everything escaped first.
    return String(text || '').split(/\n{2,}/).map(function (p) {
      // «...» reaches the page only when the server verified it against the
      // lesson's transcript, so it is shown as the lesson's own words.
      return '<p>' + esc(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/«([^«»]+)»/g, '<q class="sbx-quote">$1</q>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function gameModule() { return window['GAME_MODULE_' + (moduleIdx + 1)] || null; }
  function moduleData() { return (window.MODULES || [])[moduleIdx] || null; }
  function lessonHref(key) {
    var m = /^m(\d+)-(\d+)-(\d+)$/.exec(key || '');
    return m ? '../index.html?module=' + m[1] + '&week=' + m[2] + '&day=' + m[3] : '../index.html';
  }
  function he(n) { return n === 1 ? 'אחד' : String(n); }
  function g(fem, masc) { return ctx.profile && ctx.profile.gender === 'f' ? fem : masc; }

  /* -------------------------------------------------------------- storage */

  function stateKey() { return STATE_PREFIX + moduleIdx; }
  function planKey() { return PLAN_PREFIX + moduleIdx; }

  function loadState() {
    var s = readJSON(stateKey());
    if (!s || !user || s.ownerId !== user.id) return null;
    return s;
  }
  function saveState() { if (state) writeJSON(stateKey(), state); }
  function loadPlan() {
    var p = readJSON(planKey());
    return p && user && p.ownerId === user.id ? p : null;
  }

  function cloudOk() {
    try { return !!window.bwcSupabase && localStorage.getItem(CLOUD_MISSING_KEY) !== '1'; } catch (_) { return !!window.bwcSupabase; }
  }
  function cloudFailed(error, where) {
    if (!error) return false;
    var code = String(error.code || '');
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || /does not exist|schema cache/i.test(error.message || '')) {
      try { localStorage.setItem(CLOUD_MISSING_KEY, '1'); } catch (_) {}
      console.warn('[sandbox] cloud tables missing, local only');
    } else {
      console.warn('[sandbox] cloud ' + where + ' failed', error);
    }
    return true;
  }
  async function cloud(where, fn) {
    if (!cloudOk()) return null;
    try {
      var r = await fn(window.bwcSupabase);
      if (r && r.error) { cloudFailed(r.error, where); return null; }
      return r ? r.data : null;
    } catch (e) { console.warn('[sandbox] cloud ' + where, e); return null; }
  }

  function pushSession() {
    if (!state) return;
    return cloud('session', function (sb) {
      return sb.from('sandbox_sessions').upsert({
        id: state.id, user_id: user.id, module_idx: moduleIdx, level: state.level,
        concept_term: state.conceptTerm, current_exercise: state.current,
        updated_at: new Date().toISOString(),
        completed_at: state.completedAt || null,
      }, { onConflict: 'id' });
    });
  }
  function pushAnswer(ex) {
    if (!state || !state.exercises[ex]) return;
    var a = state.exercises[ex];
    return pushSession().then(function () {
      return cloud('answer', function (sb) {
        return sb.from('sandbox_answers').upsert({
          session_id: state.id, exercise: ex, user_id: user.id,
          messages: a.messages, done: !!a.done, sources: a.sources || [],
          updated_at: new Date().toISOString(),
        }, { onConflict: 'session_id,exercise' });
      });
    });
  }
  function pushPlan(p) {
    return cloud('plan', function (sb) {
      return sb.from('sandbox_plans').upsert({
        user_id: user.id, module_idx: moduleIdx, session_id: p.sessionId || null,
        plan: p.plan, created_at: p.createdAt, followup_status: p.status,
        followup_note: p.note || '', followed_up_at: p.followedUpAt || null,
      }, { onConflict: 'user_id,module_idx' });
    });
  }
  function pushProfile(p) {
    return cloud('profile', function (sb) {
      return sb.from('sandbox_profiles').upsert({
        user_id: user.id, sells: p.sells || '', audience: p.audience || '', edge: p.edge || '',
        gender: p.gender === 'f' ? 'f' : 'm', updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    });
  }

  /* ------------------------------------------------------- personal context */

  async function loadContext() {
    // 1. profile: local, then cloud
    var p = readJSON(PROFILE_KEY);
    if (p && p.ownerId !== user.id) p = null;
    if (!p) {
      var rows = await cloud('profile-read', function (sb) {
        return sb.from('sandbox_profiles').select('sells,audience,edge,gender').eq('user_id', user.id).maybeSingle();
      });
      if (rows) { p = Object.assign({ ownerId: user.id }, rows); writeJSON(PROFILE_KEY, p); }
    }
    ctx.profile = p;

    // 2. application doc: this module's, else the most recent one
    try {
      var r = await window.bwcSupabase.from('application_docs')
        .select('module_idx, content, updated_at').order('updated_at', { ascending: false }).limit(8);
      if (!r.error && r.data && r.data.length) {
        var doc = r.data.find(function (d) { return d.module_idx === moduleIdx; }) || r.data[0];
        ctx.docText = String(doc.content || '').slice(0, 2500);
      }
    } catch (_) {}

    // 3. game: missed exercises of this module, else lessons not played perfect
    ctx.weakLines = []; ctx.weakTerms = [];
    var gm = gameModule();
    var save = readJSON('bwc_game_v1') || {};
    if (gm) {
      var missed = save.missed || {};
      var perfect = save.perfectLessonsList || [];
      var done = save.completedLessons || {};
      gm.lessons.forEach(function (l) {
        var idxs = Array.isArray(missed[l.lessonKey]) ? missed[l.lessonKey] : [];
        idxs.forEach(function (i) {
          var exr = (l.exercises || [])[i];
          if (exr && exr.explanation && ctx.weakLines.length < 6) {
            ctx.weakLines.push(l.title + ': ' + String(exr.explanation).slice(0, 220));
          }
        });
        var weakLesson = idxs.length || (done[l.lessonKey] && perfect.indexOf(l.lessonKey) < 0);
        if (weakLesson) {
          (l.reading && l.reading.keyTerms || []).forEach(function (k) {
            if (ctx.weakTerms.indexOf(k.term) < 0) ctx.weakTerms.push(k.term);
          });
          if (!idxs.length && ctx.weakLines.length < 6) {
            ctx.weakLines.push(l.title + ': לא כל התרגילים בשיעור הזה נפתרו בפעם הראשונה');
          }
        }
      });
    }

    // 4. concept choices: weak first, then the core of the module
    var core = ['מוטיבציה אטומית', 'חזון גדול', 'פרוטוקול זהב', 'הרגלים אטומים', 'נוסחת השפע המשודרגת', 'השותף הפנימי'];
    var list = [];
    ctx.weakTerms.slice(0, 3).forEach(function (t) { list.push({ term: t, weak: true }); });
    core.forEach(function (t) { if (!list.some(function (x) { return x.term === t; })) list.push({ term: t, weak: false }); });
    ctx.concepts = list.slice(0, 6);
  }

  function profilePayload() {
    var p = ctx.profile || {};
    return { sells: p.sells || '', audience: p.audience || '', edge: p.edge || '', doc: ctx.docText || '', gender: p.gender === 'f' ? 'f' : 'm' };
  }

  function carryFor(ex) {
    var own = function (n) {
      var e = state.exercises[n];
      if (!e) return '';
      return e.messages.filter(function (m) { return m.role === 'user'; }).map(function (m) { return m.content; }).join('\n');
    };
    if (ex === 4) return 'התוכנית מתרגיל המראה:\n' + own(2);
    if (ex === 5) return ('מתרגיל המראה:\n' + own(2) + '\n\nמהפרה-מורטם:\n' + own(4)).slice(0, 3000);
    return '';
  }

  /* ------------------------------------------------------------------ API */

  async function token() {
    try { var r = await window.bwcSupabase.auth.getSession(); return r.data.session.access_token; } catch (_) { return null; }
  }

  async function callSandbox(ex) {
    var t = await token();
    var a = state.exercises[ex];
    var res = await fetch('/api/sandbox', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}),
      body: JSON.stringify({
        moduleIdx: moduleIdx, exercise: ex, level: state.level, conceptTerm: state.conceptTerm,
        profile: profilePayload(), weak: ctx.weakLines, carry: carryFor(ex), history: a.messages,
      }),
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data: data };
  }

  /* ---------------------------------------------------------------- views */

  function paintSteps() {
    if (!state) { $steps.hidden = true; return; }
    $steps.hidden = false;
    var html = '';
    for (var i = 1; i <= 5; i++) {
      var e = state.exercises[i];
      var cls = e && e.done ? 'is-done' : (i === state.current ? 'is-current' : '');
      html += '<li class="sbx-step ' + cls + '"' + (i === state.current ? ' aria-current="step"' : '') + '>' +
        '<span class="sbx-step__n">' + (e && e.done ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : i) + '</span>' +
        '<span class="sbx-step__name">' + EX[i].name + '</span></li>';
    }
    $steps.innerHTML = html;
    $steps.setAttribute('aria-label', 'תרגיל ' + Math.min(state.current, 5) + ' מתוך 5');
  }

  function show(html) {
    var fsApi = window.bwcComposer && window.bwcComposer.fullscreen;
    if (fsApi && fsApi.isOpen()) fsApi.exit();
    $view.innerHTML = html;
    paintSteps();
  }

  function gateView(title, text, btn) {
    $steps.hidden = true;
    $view.innerHTML = '<section class="sbx-card sbx-gate"><div class="sbx-gate__icon" aria-hidden="true"><i class="fa-solid fa-lock"></i></div>' +
      '<h2>' + title + '</h2><p>' + text + '</p>' + (btn || '') + '</section>';
  }

  // ---- follow-up of the last plan ("עשית?")
  function followupView(p) {
    state = null;
    show(
      '<section class="sbx-card sbx-follow">' +
        '<p class="sbx-kicker"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> לפני שממשיכים</p>' +
        '<h2>בפעם הקודמת ' + g('התחייבת', 'התחייבת') + ' למשפט הזה:</h2>' +
        '<blockquote class="sbx-plan">' + esc(p.plan) + '</blockquote>' +
        '<p class="sbx-q">' + g('עשית? מה קרה?', 'עשית? מה קרה?') + '</p>' +
        '<div class="sbx-choice" role="radiogroup" aria-label="האם ביצעת">' +
          '<button type="button" class="sbx-pill" role="radio" aria-checked="false" data-fu="done">עשיתי</button>' +
          '<button type="button" class="sbx-pill" role="radio" aria-checked="false" data-fu="partial">חלקית</button>' +
          '<button type="button" class="sbx-pill" role="radio" aria-checked="false" data-fu="not_yet">עדיין לא</button>' +
        '</div>' +
        '<label class="sbx-label" for="sbxFuNote">מה קרה בפועל? (לא חובה)</label>' +
        '<textarea id="sbxFuNote" class="sbx-input" rows="3" maxlength="2000" placeholder="משפט או שניים: מה עבד, מה הפריע"></textarea>' +
        '<div class="sbx-actions"><button type="button" class="sbx-btn sbx-btn--main" data-a="fu-save" disabled>שמירה והמשך</button></div>' +
      '</section>'
    );
    var chosen = null;
    $view.querySelectorAll('[data-fu]').forEach(function (b) {
      b.addEventListener('click', function () {
        chosen = b.getAttribute('data-fu');
        $view.querySelectorAll('[data-fu]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        $view.querySelector('[data-a="fu-save"]').disabled = false;
      });
    });
    $view.querySelector('[data-a="fu-save"]').addEventListener('click', function () {
      p.status = chosen;
      p.note = ($view.querySelector('#sbxFuNote').value || '').trim().slice(0, 2000);
      p.followedUpAt = new Date().toISOString();
      writeJSON(planKey(), p);
      pushPlan(p);
      var msg = chosen === 'done' ? 'יפה. ככה בונים הרגל: פעם אחת, ועוד פעם.' :
        chosen === 'partial' ? 'גם חלקית זה צעד. אפשר לחדד את המשפט בסבב הבא.' :
        'קורה. כדאי לבדוק בסבב הבא אם הרגע במשפט היה ספציפי מספיק.';
      startView(msg);
    });
  }

  // ---- start screen
  function startView(flash) {
    var existing = loadState();
    var mod = moduleData();
    var p = ctx.profile || {};
    var needQuestions = forceQuestions || (!ctx.docText && !(p.sells && p.audience));
    var level = (existing && existing.level) || 'light';

    var resume = existing && !existing.completedAt
      ? '<div class="sbx-resume"><p>יש לך סבב פתוח, בתרגיל ' + he(existing.current) + ' מתוך 5 (' + EX[existing.current].name + ').</p>' +
        '<div class="sbx-actions"><button type="button" class="sbx-btn sbx-btn--main" data-a="resume">להמשיך מאיפה שעצרתי</button>' +
        '<button type="button" class="sbx-btn" data-a="fresh">להתחיל סבב חדש</button></div></div>'
      : '';

    var chips = ctx.concepts.map(function (c, i) {
      return '<button type="button" class="sbx-pill sbx-concept" role="radio" aria-checked="' + (i === 0 ? 'true' : 'false') + '" data-term="' + esc(c.term) + '">' +
        esc(c.term) + (c.weak ? ' <span class="sbx-tag">פספסת במשחק</span>' : '') + '</button>';
    }).join('');

    var questions = needQuestions
      ? '<fieldset class="sbx-fields"><legend>שלוש שאלות קצרות על העסק שלך</legend>' +
          '<p class="sbx-hint">אין עדיין מסמך יישום, אז נכיר כך. התשובות נשמרות לכל המודולים.</p>' +
          '<label class="sbx-label" for="sbxSells">מה את/ה מוכר/ת?</label>' +
          '<input id="sbxSells" class="sbx-input" maxlength="400" value="' + esc(p.sells) + '" placeholder="למשל: סדנאות קרמיקה למבוגרים">' +
          '<label class="sbx-label" for="sbxAudience">למי?</label>' +
          '<input id="sbxAudience" class="sbx-input" maxlength="400" value="' + esc(p.audience) + '" placeholder="למשל: נשים בנות 35 עד 55 באזור השרון">' +
          '<label class="sbx-label" for="sbxEdge">מה מבדל אותך?</label>' +
          '<input id="sbxEdge" class="sbx-input" maxlength="400" value="' + esc(p.edge) + '" placeholder="משפט אחד, גם אם עוד לא בטוח">' +
        '</fieldset>'
      : '<p class="sbx-hint"><i class="fa-solid fa-file-lines" aria-hidden="true"></i> ' +
          (ctx.docText ? 'המאמן נשען על מסמך היישום שלך.' : 'המאמן נשען על מה שסיפרת על העסק שלך.') +
          ' <button type="button" class="sbx-link" data-a="edit-profile">לעדכן פרטים</button></p>';

    show(
      (flash ? '<p class="sbx-flash" role="status">' + esc(flash) + '</p>' : '') +
      '<section class="sbx-card">' + resume +
        '<h2>' + (existing && !existing.completedAt ? 'או סבב חדש' : 'מה מחכה לך') + '</h2>' +
        '<ol class="sbx-list">' + [1, 2, 3, 4, 5].map(function (i) {
          return '<li><i class="fa-solid ' + EX[i].icon + '" aria-hidden="true"></i><span><strong>' + EX[i].name + '.</strong> ' + EX[i].what + '</span></li>';
        }).join('') + '</ol>' +
        '<p class="sbx-hint">כל תרגיל לוקח חמש עד עשר דקות. אפשר לעצור ולחזור, ההתקדמות נשמרת.</p>' +

        '<h3 class="sbx-h3">על איזה מושג מהמודול נתאמן?</h3>' +
        '<div class="sbx-choice" role="radiogroup" aria-label="מושג לתרגול">' + chips + '</div>' +

        '<h3 class="sbx-h3">רמה</h3>' +
        '<div class="sbx-choice" role="radiogroup" aria-label="רמת קושי">' +
          '<button type="button" class="sbx-pill sbx-level" role="radio" aria-checked="' + (level === 'light') + '" data-level="light">קליל</button>' +
          '<button type="button" class="sbx-pill sbx-level" role="radio" aria-checked="' + (level === 'hard') + '" data-level="hard">בלי הנחות</button>' +
        '</div>' +

        '<h3 class="sbx-h3">איך לפנות אליך?</h3>' +
        '<div class="sbx-choice" role="radiogroup" aria-label="לשון פנייה">' +
          '<button type="button" class="sbx-pill sbx-gender" role="radio" aria-checked="' + (p.gender !== 'f') + '" data-gender="m">אתה</button>' +
          '<button type="button" class="sbx-pill sbx-gender" role="radio" aria-checked="' + (p.gender === 'f') + '" data-gender="f">את</button>' +
        '</div>' +
        questions +
        '<p class="sbx-err" id="sbxStartErr" role="alert" hidden></p>' +
        '<div class="sbx-actions"><button type="button" class="sbx-btn sbx-btn--main" data-a="start">מתחילים</button></div>' +
      '</section>'
    );
    if (mod) document.getElementById('sbxModule').textContent = 'מודול ' + (moduleIdx + 1) + ' · ' + mod.title;

    function radio(sel) {
      $view.querySelectorAll(sel).forEach(function (b) {
        b.addEventListener('click', function () {
          $view.querySelectorAll(sel).forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
        });
      });
    }
    radio('.sbx-concept'); radio('.sbx-level'); radio('.sbx-gender');
    function picked(sel, attr) {
      var b = $view.querySelector(sel + '[aria-checked="true"]');
      return b ? b.getAttribute(attr) : null;
    }

    $view.addEventListener('click', function onClick(e) {
      var b = e.target.closest('[data-a]');
      if (!b || !$view.contains(b)) return;
      var a = b.getAttribute('data-a');
      if (a === 'resume') { $view.removeEventListener('click', onClick); state = existing; openExercise(state.current); }
      else if (a === 'fresh') { b.closest('.sbx-resume').remove(); }
      else if (a === 'edit-profile') { $view.removeEventListener('click', onClick); forceQuestions = true; startView(); }
      else if (a === 'start') {
        var gender = picked('.sbx-gender', 'data-gender') || 'm';
        var prof = Object.assign({}, ctx.profile || {}, { ownerId: user.id, gender: gender });
        var sellsEl = $view.querySelector('#sbxSells');
        if (sellsEl) {
          prof.sells = sellsEl.value.trim();
          prof.audience = $view.querySelector('#sbxAudience').value.trim();
          prof.edge = $view.querySelector('#sbxEdge').value.trim();
          if (!prof.sells || !prof.audience) {
            var err = $view.querySelector('#sbxStartErr');
            err.textContent = 'חסרות שתי השאלות הראשונות: מה מוכרים ולמי. בלעדיהן הלקוח בתרגיל 3 יהיה כללי.';
            err.hidden = false;
            return;
          }
        }
        ctx.profile = prof;
        writeJSON(PROFILE_KEY, prof);
        pushProfile(prof);
        $view.removeEventListener('click', onClick);
        state = {
          id: uuid(), ownerId: user.id, moduleIdx: moduleIdx,
          level: picked('.sbx-level', 'data-level') || 'light',
          conceptTerm: picked('.sbx-concept', 'data-term') || (ctx.concepts[0] && ctx.concepts[0].term),
          current: 1, exercises: {}, startedAt: new Date().toISOString(), completedAt: null,
        };
        saveState();
        pushSession();
        openExercise(1);
      }
    });
  }

  // ---- one exercise
  function openExercise(ex) {
    state.current = ex;
    if (!state.exercises[ex]) state.exercises[ex] = { messages: [], done: false, sources: [] };
    saveState();
    var a = state.exercises[ex];
    var lockNote = ex === 1 && !a.done
      ? '<p class="sbx-lock"><i class="fa-solid fa-lock" aria-hidden="true"></i> השיעור נעול עד סוף התרגיל: מסבירים מהזיכרון, זה מה שמקבע את החומר.</p>' : '';
    show(
      '<section class="sbx-card sbx-chat" id="sbxChat">' +
        '<div class="sbx-chat__head" data-fs-head>' +
          '<div><p class="sbx-kicker">תרגיל ' + ex + ' מתוך 5</p><h2><i class="fa-solid ' + EX[ex].icon + '" aria-hidden="true"></i> ' + EX[ex].name + '</h2></div>' +
          '<button type="button" class="bwc-fs-btn" id="sbxFs"></button>' +
        '</div>' +
        '<p class="sbx-what" data-fs-hide>' + EX[ex].what + (ex <= 2 ? ' המושג: <strong>' + esc(state.conceptTerm) + '</strong>.' : '') + '</p>' +
        lockNote +
        '<div class="sbx-log" id="sbxLog" data-fs-log></div>' +
        '<div class="sbx-inputrow" data-fs-input id="sbxInputRow">' +
          '<textarea id="sbxInput" rows="2" maxlength="' + MAX_ANSWER + '" aria-label="התשובה שלך" placeholder="' + (ex === 5 ? 'אם ... אז אני ...' : 'כתבו כאן, או לחצו על המיקרופון ודברו') + '"></textarea>' +
          '<button type="button" class="sbx-btn sbx-btn--main" data-a="send">שליחה</button>' +
        '</div>' +
        '<div class="sbx-next" id="sbxNext" hidden></div>' +
      '</section>'
    );
    var ta = document.getElementById('sbxInput');
    composer = window.bwcComposer ? window.bwcComposer.enhance(ta, {
      max: MAX_ANSWER, onSend: send, draftKey: DRAFT_PREFIX + moduleIdx + '_' + ex,
    }) : null;
    if (window.bwcComposer) window.bwcComposer.fullscreen.bind(document.getElementById('sbxFs'), document.getElementById('sbxChat'), { opener: composer && composer.foot });
    else document.getElementById('sbxFs').remove();
    document.querySelector('#sbxChat [data-a="send"]').addEventListener('click', send);

    paintLog();
    if (a.done) showNext();
    else if (!a.messages.length) request(ex);
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) return '';
    return '<div class="sbx-src">' + sources.map(function (s) {
      return '<a href="' + lessonHref(s.key) + '" class="sbx-src__chip"><i class="fa-solid fa-play" aria-hidden="true"></i> מהשיעור: ' + esc(s.title) + '</a>';
    }).join('') + '</div>';
  }

  function paintLog() {
    var a = state.exercises[state.current];
    var log = document.getElementById('sbxLog');
    if (!log) return;
    log.innerHTML = a.messages.map(function (m) {
      if (m.role === 'user') return '<div class="sbx-msg sbx-msg--me">' + esc(String(m.content).trim()) + '</div>';
      var out = /^\s*\[מחוץ לדמות\]/.test(m.content);
      var body = String(m.content).replace(/^\s*\[מחוץ לדמות\]\s*/, '');
      return '<div class="sbx-msg sbx-msg--ai' + (out ? ' is-feedback' : '') + '">' +
        (out ? '<p class="sbx-msg__tag">משוב</p>' : '') + md(body) + sourcesHtml(m.sources) + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  function setBusy(on) {
    var log = document.getElementById('sbxLog');
    var el = log && log.querySelector('.sbx-typing');
    if (on && log && !el) {
      el = document.createElement('div');
      el.className = 'sbx-typing';
      el.innerHTML = '<span></span><span></span><span></span><span class="sbx-sr">המאמן כותב</span>';
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    } else if (!on && el) el.remove();
    var btn = document.querySelector('#sbxChat [data-a="send"]');
    if (btn) btn.disabled = on;
  }

  function chatError(msg) {
    var log = document.getElementById('sbxLog');
    if (!log) return;
    var el = document.createElement('div');
    el.className = 'sbx-error';
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function giveBack(ex) {
    var a = state.exercises[ex];
    var last = a.messages[a.messages.length - 1];
    if (!last || last.role !== 'user') return;
    a.messages.pop();
    saveState();
    paintLog();
    var ta = document.getElementById('sbxInput');
    if (ta && !ta.value.trim()) { ta.value = last.content; if (composer) composer.refresh(); }
  }

  async function request(ex) {
    if (sending) return;
    sending = true;
    setBusy(true);
    try {
      var r = await callSandbox(ex);
      setBusy(false);
      var d = r.data || {};
      if (r.status === 200 && d.ok) {
        var a = state.exercises[ex];
        a.messages.push({ role: 'assistant', content: d.reply, sources: d.sources || [] });
        (d.sources || []).forEach(function (s) { if (!a.sources.some(function (x) { return x.key === s.key; })) a.sources.push(s); });
        if (d.done) a.done = true;
        if (d.plan) savePlan(d.plan);
        saveState();
        pushAnswer(ex);
        paintLog();
        if (a.done) showNext();
        return;
      }
      giveBack(ex);
      if (d.reason === 'daily_cap') chatError('הגעת למכסת התרגול של היום. ההתקדמות שמורה, ומחר ממשיכים בדיוק מכאן.');
      else if (d.reason === 'sandbox_disabled') chatError('חדר האימון סגור כרגע. ההתקדמות שמורה, ונמשיך כשהוא ייפתח.');
      else if (d.reason === 'exercise_over') { state.exercises[ex].done = true; saveState(); showNext(); }
      else if (r.status === 401) chatError('החיבור לחשבון פג. רעננו את הדף והתחברו, התשובה חזרה לתיבה.');
      else if (r.status === 429) chatError('היו הרבה בקשות בדקה האחרונה. חכו רגע ונסו שוב, התשובה חזרה לתיבה.');
      else if (d.reason === 'answer_too_long') chatError('התשובה ארוכה מדי לתרגיל הזה. קצרו אותה ונסו שוב.');
      else chatError('לא הצלחתי לקבל תשובה כרגע. התשובה שלך חזרה לתיבה, נסו שוב בעוד רגע.');
    } catch (err) {
      console.error('[sandbox]', err);
      setBusy(false);
      giveBack(ex);
      chatError('נראה שהחיבור לאינטרנט נפל. התשובה חזרה לתיבה, נסו שוב.');
    } finally {
      sending = false;
    }
  }

  function send() {
    var ta = document.getElementById('sbxInput');
    if (!ta || sending) return;
    var text = (ta.value || '').trim();
    if (!text) return;
    var a = state.exercises[state.current];
    if (a.done) return;
    a.messages.push({ role: 'user', content: text.slice(0, MAX_ANSWER) });
    saveState();
    ta.value = '';
    if (composer) { composer.clearDraft(); composer.refresh(); }
    paintLog();
    request(state.current);
  }

  function savePlan(text) {
    var p = { ownerId: user.id, plan: text, sessionId: state.id, createdAt: new Date().toISOString(), status: 'pending', note: '', followedUpAt: null };
    writeJSON(planKey(), p);
    state.plan = text;
    pushPlan(p);
  }

  function showNext() {
    var ex = state.current;
    var row = document.getElementById('sbxInputRow');
    if (row) {
      row.hidden = true;
      var foot = row.nextElementSibling;
      while (foot && foot.id !== 'sbxNext') { foot.hidden = true; foot = foot.nextElementSibling; }
    }
    var next = document.getElementById('sbxNext');
    if (!next) return;
    var lesson = '';
    if (ex === 1) {
      var c = (gameModule() && gameModule().lessons || []).find(function (l) {
        return (l.reading && l.reading.keyTerms || []).some(function (k) { return k.term === state.conceptTerm; });
      });
      if (c) lesson = '<a class="sbx-btn" href="' + lessonHref(c.lessonKey) + '" target="_blank" rel="noopener"><i class="fa-solid fa-lock-open" aria-hidden="true"></i> עכשיו אפשר לפתוח את השיעור</a>';
    }
    next.hidden = false;
    next.innerHTML = '<p class="sbx-done"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> סיימת את "' + EX[ex].name + '".</p>' +
      '<div class="sbx-actions">' +
      (ex < 5 ? '<button type="button" class="sbx-btn sbx-btn--main" data-a="next">לתרגיל ' + (ex + 1) + ': ' + EX[ex + 1].name + '</button>'
              : '<button type="button" class="sbx-btn sbx-btn--main" data-a="finish">לסיכום</button>') +
      lesson + '</div>';
    paintSteps();
    var go = next.querySelector('[data-a="next"],[data-a="finish"]');
    go.addEventListener('click', function () {
      if (ex < 5) openExercise(ex + 1);
      else finishView();
    });
    try { go.focus({ preventScroll: false }); } catch (_) {}
  }

  function finishView() {
    state.completedAt = state.completedAt || new Date().toISOString();
    state.current = 5;
    saveState();
    pushSession();
    var p = loadPlan();
    var all = [];
    for (var i = 1; i <= 5; i++) (state.exercises[i] && state.exercises[i].sources || []).forEach(function (s) {
      if (!all.some(function (x) { return x.key === s.key; })) all.push(s);
    });
    show(
      '<section class="sbx-card sbx-final">' +
        '<p class="sbx-kicker">סיימת את חדר האימון של המודול</p>' +
        '<h2>' + g('המשפט שהתחייבת אליו', 'המשפט שהתחייבת אליו') + '</h2>' +
        (p && p.sessionId === state.id
          ? '<blockquote class="sbx-plan">' + esc(p.plan) + '</blockquote><p class="sbx-hint">בכניסה הבאה לחדר האימון נשאל איך הלך.</p>'
          : '<p class="sbx-hint">בסבב הזה לא נשמר משפט אם-אז. אפשר לחזור לתרגיל 5 ולנסח אותו.</p>' +
            '<div class="sbx-actions"><button type="button" class="sbx-btn" data-a="redo5">חזרה לתרגיל 5</button></div>') +
        (all.length ? '<h3 class="sbx-h3">השיעורים שהמאמן נשען עליהם</h3>' + sourcesHtml(all) : '') +
        '<div class="sbx-actions">' +
          '<a class="sbx-btn sbx-btn--main" href="module.html?id=' + moduleIdx + '">חזרה למודול</a>' +
          '<button type="button" class="sbx-btn" data-a="again">סבב חדש</button>' +
        '</div>' +
      '</section>'
    );
    $view.querySelector('[data-a="again"]').addEventListener('click', function () { state = null; startView(); });
    var redo = $view.querySelector('[data-a="redo5"]');
    if (redo) redo.addEventListener('click', function () {
      state.completedAt = null;
      state.exercises[5] = { messages: [], done: false, sources: [] };
      saveState();
      openExercise(5);
    });
  }

  /* ----------------------------------------------------------------- boot */

  async function boot() {
    user = window.bwcAuth && window.bwcAuth.getUser();
    if (!user) {
      gateView('נדרשת התחברות', 'חדר האימון מותאם לעסק שלך ושומר את ההתקדמות, ולכן דורש חשבון (חינמי).',
        '<button type="button" class="sbx-btn sbx-btn--main" onclick="window.openLoginModal && window.openLoginModal()">התחברות / הרשמה</button>');
      return;
    }
    if (window.bwcApi && !window.bwcApi.available) {
      gateView('חדר האימון לא זמין בכתובת הזו', 'הוא רץ על שרת שקיים רק בפורטל המלא.',
        '<a class="sbx-btn sbx-btn--main" href="' + window.bwcApi.primary + '/pages/sandbox.html?module=' + moduleIdx + '">מעבר לפורטל המלא</a>');
      return;
    }
    if (PILOT_MODULES.indexOf(moduleIdx) < 0 || !gameModule()) {
      gateView('חדר האימון של המודול הזה עוד בבנייה', 'בינתיים הוא פתוח במודול 2, מנהיגות אטומית.',
        '<a class="sbx-btn sbx-btn--main" href="sandbox.html?module=1">לחדר האימון של מודול 2</a>');
      return;
    }
    $view.innerHTML = '<p class="sbx-loading">טוען את חדר האימון...</p>';
    await loadContext();

    // Plan follow-up: local copy, else the cloud one (another device).
    var p = loadPlan();
    if (!p) {
      var row = await cloud('plan-read', function (sb) {
        return sb.from('sandbox_plans').select('plan,session_id,created_at,followup_status,followup_note,followed_up_at')
          .eq('user_id', user.id).eq('module_idx', moduleIdx).maybeSingle();
      });
      if (row) {
        p = { ownerId: user.id, plan: row.plan, sessionId: row.session_id, createdAt: row.created_at, status: row.followup_status, note: row.followup_note, followedUpAt: row.followed_up_at };
        writeJSON(planKey(), p);
      }
    }
    var force = /[?&]followup=1/.test(location.search);
    if (p && p.status === 'pending' && (force || Date.now() - Date.parse(p.createdAt) > FOLLOWUP_AFTER_MS)) {
      followupView(p);
      return;
    }
    startView();
  }

  document.addEventListener('DOMContentLoaded', function () {
    $view = document.getElementById('sbxView');
    $steps = document.getElementById('sbxSteps');
    var m = parseInt(new URLSearchParams(location.search).get('module'), 10);
    moduleIdx = Number.isInteger(m) && m >= 0 && m <= 7 ? m : 1;
    var mod = moduleData();
    if (mod) document.getElementById('sbxModule').textContent = 'מודול ' + (moduleIdx + 1) + ' · ' + mod.title;
    if (!window.bwcAuth) { gateView('משהו לא נטען', 'רעננו את הדף.'); return; }
    var booted = false;
    var run = function () {
      var u = window.bwcAuth.getUser();
      if (booted && u && user && u.id === user.id) return;
      booted = true;
      boot();
    };
    window.bwcAuth.ready().then(run);
    window.bwcAuth.onChange(run);
  });
})();
