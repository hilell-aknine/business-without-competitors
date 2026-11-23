/* ==========================================================================
   private-course.js — the player for a private course (pages/private-course.html).

   Every byte of course content comes from the database (migration 015) and
   only for an account that holds a grant. This file holds no content. With no
   grant the queries return zero rows and the page says "not found", the same
   answer it gives for a course id that does not exist.

   URL: ?c=<course id>#l=<lesson number>
   Progress: table private_course_progress (own rows) + a per-user local cache.
   ========================================================================== */
(function () {
  'use strict';

  var TABS = [
    { id: 'summary', label: 'סיכום', icon: 'fa-align-right' },
    { id: 'points', label: 'נקודות מפתח', icon: 'fa-list-check' },
    { id: 'quiz', label: 'תרגול', icon: 'fa-circle-question' },
    { id: 'workbook', label: 'חוברת עבודה', icon: 'fa-pen-to-square' },
    { id: 'coach', label: 'שאל את השיעור', icon: 'fa-robot' },
  ];

  var state = {
    user: null,
    course: null,
    lessons: [],        // sorted by ord
    byOrd: {},
    done: {},           // ord -> true
    current: null,      // ord
    tab: 'summary',
    chat: {},           // ord -> [{role, content}]
    loadedFor: null,
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function courseIdFromUrl() {
    var c = new URLSearchParams(location.search).get('c');
    return c && /^[a-z0-9-]{2,40}$/.test(c) ? c : null;
  }
  function ordFromHash() {
    var m = /(?:^#|&)l=(\d+)/.exec(location.hash || '');
    return m ? parseInt(m[1], 10) : null;
  }
  function cacheKey() { return 'bwc_pc_done_v1:' + (state.user ? state.user.id : '') + ':' + (state.course ? state.course.id : ''); }

  /* ------------------------------------------------------------- states */
  function showState(html) {
    $('pcCourse').hidden = true;
    var el = $('pcState');
    el.hidden = false;
    el.innerHTML = html;
  }
  function showLogin() {
    showState(
      '<i class="fa-solid fa-lock" aria-hidden="true"></i>' +
      '<span>הדף הזה זמין רק אחרי התחברות.</span>' +
      '<button type="button" class="pc-btn pc-btn--primary" id="pcLogin">התחברות</button>'
    );
    var b = $('pcLogin');
    if (b) b.addEventListener('click', function () {
      if (window.bwcAuthModal && typeof window.bwcAuthModal.open === 'function') window.bwcAuthModal.open();
    });
  }
  function showNotFound() {
    document.title = 'לא נמצא - עסק ללא מתחרים';
    showState(
      '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>' +
      '<span>הקורס לא נמצא, או שאין לחשבון הזה גישה אליו.</span>' +
      '<a class="pc-btn" href="../index.html">חזרה לדף הבית</a>'
    );
  }

  /* --------------------------------------------------------------- load */
  function load(user) {
    state.user = user || null;
    if (!user) { state.loadedFor = null; showLogin(); return; }
    if (state.loadedFor === user.id) return;
    state.loadedFor = user.id;
    showState('<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>טוען…</span>');

    var sb = window.bwcSupabase;
    var wanted = courseIdFromUrl();
    var q = sb.from('private_courses').select('id,title,subtitle,structure');
    q = wanted ? q.eq('id', wanted) : q.order('created_at').limit(1);
    q.then(function (res) {
      if (state.loadedFor !== user.id) return;
      var course = res && !res.error && res.data && res.data[0];
      if (!course) { showNotFound(); return; }
      state.course = course;
      return Promise.all([
        sb.from('private_course_lessons')
          .select('ord,stage_ord,module_ord,title,video_type,video_id,video_hash,content_status,summary,key_points,practice_questions,workbook')
          .eq('course_id', course.id).order('ord'),
        sb.from('private_course_progress').select('ord').eq('course_id', course.id),
      ]).then(function (r) {
        if (state.loadedFor !== user.id) return;
        var lessons = r[0] && !r[0].error ? (r[0].data || []) : [];
        if (!lessons.length) { showNotFound(); return; }
        state.lessons = lessons;
        state.byOrd = {};
        lessons.forEach(function (l) { state.byOrd[l.ord] = l; });
        state.done = readLocalDone();
        if (r[1] && !r[1].error && Array.isArray(r[1].data)) {
          r[1].data.forEach(function (p) { state.done[p.ord] = true; });
          writeLocalDone();
        }
        start();
      });
    }).catch(function (e) {
      console.warn('[private-course] load failed', e);
      showNotFound();
    });
  }

  function readLocalDone() {
    try {
      var raw = JSON.parse(localStorage.getItem(cacheKey()) || '[]');
      var out = {};
      (Array.isArray(raw) ? raw : []).forEach(function (n) { out[n] = true; });
      return out;
    } catch (_) { return {}; }
  }
  function writeLocalDone() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(Object.keys(state.done).map(Number))); } catch (_) { /* private mode */ }
  }

  /* -------------------------------------------------------------- render */
  function start() {
    var c = state.course;
    document.title = c.title + ' - קורס אישי';
    $('pcTitle').textContent = c.title;
    $('pcSub').textContent = c.subtitle || '';
    $('pcState').hidden = true;
    $('pcCourse').hidden = false;
    var first = ordFromHash();
    if (!first || !state.byOrd[first]) {
      var next = state.lessons.find(function (l) { return !state.done[l.ord]; });
      first = (next || state.lessons[0]).ord;
    }
    renderToc('');
    select(first, false);
    renderProgress();
  }

  function renderProgress() {
    var total = state.lessons.length;
    var done = state.lessons.filter(function (l) { return state.done[l.ord]; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    var ready = state.lessons.filter(function (l) { return l.content_status === 'ready'; }).length;
    $('pcCount').textContent = done + '/' + total + ' שיעורים הושלמו · ' + ready + ' עם חומר לימוד מלא';
    $('pcPct').textContent = pct + '%';
    $('pcFill').style.inlineSize = pct + '%';
    $('pcBar').setAttribute('aria-valuenow', String(pct));
  }

  function stageList() {
    var s = Array.isArray(state.course.structure) ? state.course.structure : [];
    if (s.length) return s;
    // Fallback: derive stages/modules from the lessons themselves.
    var map = {};
    state.lessons.forEach(function (l) {
      var st = map[l.stage_ord] || (map[l.stage_ord] = { ord: l.stage_ord, title: 'שלב ' + l.stage_ord, modules: {} });
      var m = st.modules[l.module_ord] || (st.modules[l.module_ord] = { ord: l.module_ord, title: 'יחידה ' + l.module_ord, lessons: [] });
      m.lessons.push(l.ord);
    });
    return Object.keys(map).map(function (k) {
      var st = map[k];
      st.modules = Object.keys(st.modules).map(function (mk) { return st.modules[mk]; });
      return st;
    });
  }

  function renderToc(filter) {
    var q = String(filter || '').trim().toLowerCase();
    var cur = state.byOrd[state.current];
    var html = stageList().map(function (st) {
      var stageLessons = [];
      var modsHtml = (st.modules || []).map(function (m) {
        var items = (m.lessons || []).map(function (n) { return state.byOrd[n]; }).filter(Boolean);
        items.forEach(function (l) { stageLessons.push(l); });
        var shown = items.filter(function (l) {
          return !q || l.title.toLowerCase().indexOf(q) !== -1 || String(m.title).toLowerCase().indexOf(q) !== -1 || String(st.title).toLowerCase().indexOf(q) !== -1;
        });
        if (!shown.length) return '';
        return '<div class="pc-mod"><div class="pc-mod__title">' + esc(m.title) + '</div>' +
          shown.map(lessonBtn).join('') + '</div>';
      }).join('');
      if (!modsHtml) return '';
      var doneN = stageLessons.filter(function (l) { return state.done[l.ord]; }).length;
      var open = !!q || (cur && cur.stage_ord === st.ord);
      return '<details class="pc-stage"' + (open ? ' open' : '') + ' data-stage="' + st.ord + '">' +
        '<summary><span class="pc-stage__num" aria-hidden="true">' + st.ord + '</span>' +
        '<span class="pc-stage__title">' + esc(st.title) + '</span>' +
        '<span class="pc-stage__count">' + doneN + '/' + stageLessons.length + '</span></summary>' +
        modsHtml + '</details>';
    }).join('');
    $('pcToc').innerHTML = html || '<p class="pc-empty">לא נמצאו שיעורים תואמים</p>';
  }

  function lessonBtn(l) {
    var active = l.ord === state.current;
    var done = !!state.done[l.ord];
    var icon = done ? 'fa-circle-check' : (l.video_type === 'youtube' || l.video_type === 'vimeo' ? 'fa-circle-play' : 'fa-file-lines');
    return '<button type="button" class="pc-les' + (active ? ' is-active' : '') + (done ? ' is-done' : '') + '" data-ord="' + l.ord + '"' +
      (active ? ' aria-current="true"' : '') + '>' +
      '<i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
      '<span class="pc-les__title">' + esc(l.title) + '</span>' +
      (l.content_status !== 'ready' ? '<span class="pc-tag">בהכנה</span>' : '') +
      '</button>';
  }

  function crumbs(l) {
    var st = stageList().find(function (s) { return s.ord === l.stage_ord; });
    var m = st && (st.modules || []).find(function (x) { return x.ord === l.module_ord; });
    return [st && st.title, m && m.title].filter(Boolean).map(esc).join(' <span aria-hidden="true">›</span> ');
  }

  function videoHtml(l) {
    if (l.video_type === 'youtube' && l.video_id) {
      return '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(l.video_id) + '?rel=0&modestbranding=1" title="' + esc(l.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    }
    if (l.video_type === 'vimeo' && l.video_id) {
      var src = 'https://player.vimeo.com/video/' + encodeURIComponent(l.video_id) + '?dnt=1' + (l.video_hash ? '&h=' + encodeURIComponent(l.video_hash) : '');
      return '<iframe src="' + src + '" title="' + esc(l.title) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    }
    var msg = l.video_type === 'unavailable'
      ? 'הסרטון של השיעור הזה זמין רק בפלטפורמה המקורית ולא ניתן להטמעה כאן.'
      : 'לשיעור הזה אין סרטון.';
    return '<div class="pc-video__none"><i class="fa-solid fa-video-slash" aria-hidden="true"></i><span>' + msg + '</span></div>';
  }

  function select(ord, scroll) {
    var l = state.byOrd[ord];
    if (!l) return;
    state.current = ord;
    try { history.replaceState(null, '', location.pathname + location.search + '#l=' + ord); } catch (_) { /* file:// */ }
    $('pcVideo').innerHTML = videoHtml(l);
    $('pcCrumbs').innerHTML = crumbs(l);
    $('pcLessonTitle').textContent = l.title;
    var idx = state.lessons.indexOf(l);
    $('pcPrev').disabled = idx <= 0;
    $('pcNext').disabled = idx >= state.lessons.length - 1;
    renderDone();
    renderTabs();
    renderToc($('pcSearch').value);
    if (scroll) $('pcLesson').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderDone() {
    var d = !!state.done[state.current];
    var b = $('pcDone');
    b.innerHTML = d
      ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> הושלם'
      : '<i class="fa-regular fa-circle" aria-hidden="true"></i> סמן כהושלם';
    b.setAttribute('aria-pressed', d ? 'true' : 'false');
    b.classList.toggle('is-done', d);
  }

  function renderTabs() {
    $('pcTabs').innerHTML = TABS.map(function (t) {
      var sel = t.id === state.tab;
      return '<button type="button" role="tab" class="pc-tab' + (sel ? ' is-active' : '') + '" data-tab="' + t.id + '" aria-selected="' + sel + '">' +
        '<i class="fa-solid ' + t.icon + '" aria-hidden="true"></i><span>' + t.label + '</span></button>';
    }).join('');
    renderPanel();
  }

  function pendingNote() {
    return '<div class="pc-pending"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>' +
      '<span>חומר הלימוד לשיעור הזה עוד לא הוכן. הכותרת והסרטון (אם יש) זמינים, הסיכום והתרגול יתווספו כשהתמלול יעובד.</span></div>';
  }

  function renderPanel() {
    var l = state.byOrd[state.current];
    var p = $('pcPanel');
    var ready = l.content_status === 'ready';
    if (state.tab === 'summary') {
      p.innerHTML = ready && l.summary ? '<p class="pc-text">' + esc(l.summary) + '</p>' : pendingNote();
    } else if (state.tab === 'points') {
      var pts = Array.isArray(l.key_points) ? l.key_points : [];
      p.innerHTML = pts.length ? '<ol class="pc-points">' + pts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : pendingNote();
    } else if (state.tab === 'quiz') {
      renderQuiz(p, l);
    } else if (state.tab === 'workbook') {
      var w = l.workbook;
      if (!w) { p.innerHTML = pendingNote(); return; }
      p.innerHTML =
        (w.intro ? '<p class="pc-text">' + esc(w.intro) + '</p>' : '') +
        (Array.isArray(w.exercises) && w.exercises.length ? '<h3 class="pc-h3">תרגילים</h3><ol class="pc-points">' + w.exercises.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
        (Array.isArray(w.reflection) && w.reflection.length ? '<h3 class="pc-h3">שאלות לרפלקציה</h3><ul class="pc-points pc-points--q">' + w.reflection.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
    } else if (state.tab === 'coach') {
      renderCoach(p, l);
    }
  }

  function renderQuiz(p, l) {
    var qs = Array.isArray(l.practice_questions) ? l.practice_questions : [];
    if (!qs.length) { p.innerHTML = pendingNote(); return; }
    p.innerHTML = qs.map(function (q, qi) {
      return '<fieldset class="pc-q" data-q="' + qi + '"><legend>' + (qi + 1) + '. ' + esc(q.q) + '</legend>' +
        (q.options || []).map(function (o, oi) {
          return '<button type="button" class="pc-opt" data-q="' + qi + '" data-o="' + oi + '">' + esc(o) + '</button>';
        }).join('') +
        '<div class="pc-q__explain" hidden></div></fieldset>';
    }).join('') + '<div class="pc-q__score" id="pcScore" role="status"></div>';
  }

  function answer(qi, oi) {
    var l = state.byOrd[state.current];
    var q = l.practice_questions[qi];
    var fs = $('pcPanel').querySelector('.pc-q[data-q="' + qi + '"]');
    if (!fs || fs.classList.contains('is-answered')) return;
    fs.classList.add('is-answered');
    var right = oi === q.correct;
    fs.classList.add(right ? 'is-right' : 'is-wrong');
    Array.prototype.forEach.call(fs.querySelectorAll('.pc-opt'), function (b) {
      var o = Number(b.getAttribute('data-o'));
      b.disabled = true;
      if (o === q.correct) b.classList.add('is-correct');
      else if (o === oi) b.classList.add('is-chosen-wrong');
    });
    var ex = fs.querySelector('.pc-q__explain');
    ex.hidden = false;
    ex.innerHTML = '<strong>' + (right ? 'נכון.' : 'לא בדיוק.') + '</strong> ' + esc(q.explain || '');
    var all = $('pcPanel').querySelectorAll('.pc-q');
    var answered = $('pcPanel').querySelectorAll('.pc-q.is-answered');
    if (all.length === answered.length) {
      var r = $('pcPanel').querySelectorAll('.pc-q.is-right').length;
      $('pcScore').textContent = r + ' מתוך ' + all.length + ' נכונות';
    }
  }

  /* --------------------------------------------------------------- coach */
  function renderCoach(p, l) {
    if (window.bwcApi && !window.bwcApi.available) { p.innerHTML = window.bwcApi.unavailableHtml(); return; }
    if (l.content_status !== 'ready') { p.innerHTML = pendingNote(); return; }
    var msgs = state.chat[l.ord] || [];
    p.innerHTML =
      '<div class="pc-chat" id="pcChat">' +
        (msgs.length ? msgs.map(msgHtml).join('') : '<p class="pc-chat__hint">שאל שאלה על השיעור. התשובות מבוססות רק על חומר השיעור הזה.</p>') +
      '</div>' +
      '<div class="pc-chat__form">' +
        '<textarea id="pcAsk" rows="2" placeholder="מה תרצה להבין לעומק?" aria-label="שאלה לשיעור"></textarea>' +
        '<button type="button" class="pc-btn pc-btn--primary" id="pcSend"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> שלח</button>' +
      '</div>';
    var ta = $('pcAsk');
    if (window.bwcComposer) window.bwcComposer.enhance(ta, { onSend: send, draftKey: 'bwc_pc_draft_' + l.ord });
    $('pcSend').addEventListener('click', send);
  }
  function msgHtml(m) {
    return '<div class="pc-msg pc-msg--' + (m.role === 'user' ? 'user' : 'ai') + (m.error ? ' pc-msg--error' : '') + '">' + esc(m.content) + '</div>';
  }

  var sending = false;
  function send() {
    if (sending) return;
    var ta = $('pcAsk');
    var question = ta ? ta.value.trim() : '';
    if (!question) return;
    var l = state.byOrd[state.current];
    var ord = l.ord;
    var list = state.chat[ord] || (state.chat[ord] = []);
    var history = list.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; });
    list.push({ role: 'user', content: question });
    ta.value = '';
    if (ta._bwcComposer) { ta._bwcComposer.clearDraft(); ta._bwcComposer.grow(); }
    sending = true;
    redrawChat(true);
    window.bwcSupabase.auth.getSession().then(function (s) {
      var token = s && s.data && s.data.session && s.data.session.access_token;
      return fetch('/api/private-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ courseId: state.course.id, ord: ord, question: question, history: history }),
      });
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.j && res.j.ok) list.push({ role: 'assistant', content: res.j.answer });
      else list.push({ role: 'assistant', error: true, content: res.status === 429 ? 'יותר מדי שאלות בדקה האחרונה. נסה שוב עוד רגע.' : 'לא הצלחתי לענות כרגע. נסה שוב.' });
    }).catch(function () {
      list.push({ role: 'assistant', error: true, content: 'אין חיבור לשרת כרגע. נסה שוב.' });
    }).then(function () {
      sending = false;
      if (state.current === ord && state.tab === 'coach') redrawChat(false);
    });
  }
  function redrawChat(waiting) {
    var box = $('pcChat');
    if (!box) return;
    var msgs = state.chat[state.current] || [];
    box.innerHTML = msgs.map(msgHtml).join('') +
      (waiting ? '<div class="pc-msg pc-msg--ai pc-msg--wait"><i class="fa-solid fa-ellipsis fa-fade" aria-hidden="true"></i> חושב…</div>' : '');
    box.scrollTop = box.scrollHeight;
    var b = $('pcSend');
    if (b) b.disabled = !!waiting;
  }

  /* ------------------------------------------------------------ progress */
  function toggleDone() {
    var ord = state.current;
    var sb = window.bwcSupabase;
    var was = !!state.done[ord];
    if (was) delete state.done[ord]; else state.done[ord] = true;
    writeLocalDone();
    renderDone(); renderProgress(); renderToc($('pcSearch').value);
    var op = was
      ? sb.from('private_course_progress').delete().eq('course_id', state.course.id).eq('ord', ord)
      : sb.from('private_course_progress').upsert({ user_id: state.user.id, course_id: state.course.id, ord: ord }, { onConflict: 'user_id,course_id,ord', ignoreDuplicates: true });
    op.then(function (r) { if (r && r.error) console.warn('[private-course] progress not saved', r.error.message); });
  }

  /* -------------------------------------------------------------- wiring */
  function wire() {
    $('pcToc').addEventListener('click', function (e) {
      var b = e.target.closest('.pc-les');
      if (b) select(Number(b.getAttribute('data-ord')), window.matchMedia('(max-width: 960px)').matches);
    });
    $('pcTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.pc-tab');
      if (!b) return;
      state.tab = b.getAttribute('data-tab');
      renderTabs();
    });
    $('pcPanel').addEventListener('click', function (e) {
      var b = e.target.closest('.pc-opt');
      if (b) answer(Number(b.getAttribute('data-q')), Number(b.getAttribute('data-o')));
    });
    $('pcDone').addEventListener('click', toggleDone);
    $('pcPrev').addEventListener('click', function () { step(-1); });
    $('pcNext').addEventListener('click', function () { step(1); });
    $('pcSearch').addEventListener('input', function (e) { renderToc(e.target.value); });
    window.addEventListener('hashchange', function () {
      var o = ordFromHash();
      if (o && o !== state.current && state.byOrd[o]) select(o, false);
    });
  }
  function step(d) {
    var i = state.lessons.indexOf(state.byOrd[state.current]) + d;
    if (i >= 0 && i < state.lessons.length) select(state.lessons[i].ord, true);
  }

  function boot() {
    wire();
    if (!window.bwcAuth || !window.bwcSupabase) { showNotFound(); return; }
    window.bwcAuth.ready().then(function () { load(window.bwcAuth.getUser()); });
    window.bwcAuth.onChange(load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
