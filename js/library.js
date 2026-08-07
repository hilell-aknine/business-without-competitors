/* ================================================================
   library.js — ספריית השיעורים
   All logic: flatten data, filter, render. No external deps.
   Depends on: MODULES, SEMINARS globals from course-data.js
   ================================================================ */

(function () {
  'use strict';

  /* ---- Topic keyword map ----
     Keywords are matched case-insensitive against the combined
     parent (module/seminar) title + lesson title. Expanded so every
     parent gets ≥ 1 tag (no "untagged" lessons in the library). */
  const TOPIC_KEYWORDS = {
    'תמחור':    ['תמחור', 'מחיר', 'פרמיום', 'תשלום'],
    'מיצוב':    ['מיצוב', 'אוטוריטה', 'מומחיות', 'מומחה'],
    'שיווק':    ['שיווק', 'קמפיין', 'פרסום', 'תוכן', 'אורגני', 'השפעה'],
    'מנהיגות':  ['מנהיגות', 'מנהיג', 'הובלה', 'אומץ', 'אמונה', 'להאמין'],
    'מוצר':     ['מוצר', 'הצעה', 'מוצרים'],
    'המרה':     ['המרה', 'סגירה', 'מכירה', 'שיחת מכירה', 'סגירת', 'פיצוח'],
    'משוב':     ['פידבק', 'משוב', 'ביקורת'],
    'מותג':     ['מותג', 'מיתוג', 'זהות', 'ברנד'],
    'חדשנות':   ['חדשנות', 'אינוואציה', 'יצירתיות'],
    'אסטרטגיה': ['אסטרטגיה', 'תכנון', 'תוכנית', 'בור', 'סולם', 'מהפכה', 'מתחרים', 'עסק'],
    'קהל':      ['קהל', 'אווטאר', 'לקוח', 'פרסונה', 'מסע'],
    'שיטה':     ['אטומית', 'אטומי', 'שיטה', 'מתודולוגיה', 'מערכת', 'אופטימיזציה']
  };

  /* ---- Derive topic tags from lesson title ---- */
  function getTags(title) {
    const lower = title.toLowerCase();
    const tags = [];
    for (const [tag, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
        tags.push(tag);
        if (tags.length === 3) break;
      }
    }
    return tags;
  }

  /* ---- Flatten all lessons into a single array ---- */
  function buildFlatList() {
    const list = [];

    MODULES.forEach((mod, mi) => {
      mod.weeks.forEach((week, wi) => {
        week.days.forEach((day, di) => {
          const key = `m${mi}-${wi}-${di}`;
          const isAiTool = !day.videoId && !!day.aiToolUrl;
          const title = day.title;
          list.push({
            key,
            type: 'module',
            mi, wi, di,
            title,
            displayTitle: title,
            moduleName: mod.title,
            moduleNum: mi + 1,
            weekTitle: week.title,
            meta: `מודול ${mi + 1}: ${mod.title} · ${week.title}`,
            videoId: day.videoId,
            isAiTool,
            aiToolUrl: day.aiToolUrl || null,
            aiToolLabel: day.aiToolLabel || null,
            url: isAiTool
              ? (day.aiToolUrl)
              : `../index.html?module=${mi}&week=${wi}&day=${di}`,
            tags: getTags(mod.title + ' ' + title)
          });
        });
      });
    });

    SEMINARS.forEach((sem, si) => {
      sem.parts.forEach((part, pi) => {
        const key = `s${si}-${pi}`;
        const title = part.title === 'הסמינר המלא' ? sem.title : `${sem.title} — ${part.title}`;
        list.push({
          key,
          type: 'seminar',
          si, pi,
          title,
          displayTitle: part.title,
          seminarTitle: sem.title,
          meta: `סמינר ${si + 1}: ${sem.title} · חלק ${pi + 1}`,
          videoId: part.videoId,
          isAiTool: false,
          url: `../index.html?seminar=${si}&part=${pi}`,
          tags: getTags(sem.title + ' ' + part.title)
        });
      });
    });

    return list;
  }

  /* ---- Read completed lessons from localStorage (defensive) ---- */
  function getCompleted() {
    try {
      const raw = localStorage.getItem('bwc_completed');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /* ---- Merge a Supabase lesson-key array into localStorage and return merged array ----
     Union: a lesson is complete if either source says so. */
  function mergeCompleted(remoteKeys) {
    if (!Array.isArray(remoteKeys) || remoteKeys.length === 0) return getCompleted();
    const local = getCompleted();
    const merged = Array.from(new Set([...local, ...remoteKeys]));
    if (merged.length !== local.length) {
      try { localStorage.setItem('bwc_completed', JSON.stringify(merged)); } catch (_) {}
    }
    return merged;
  }

  /* ---- Fetch course_progress rows for the logged-in user from Supabase ---- */
  async function fetchRemoteCompleted(userId) {
    try {
      if (!window.bwcSupabase) return null;
      const { data, error } = await window.bwcSupabase
        .from('course_progress')
        .select('lesson_key')
        .eq('user_id', userId);
      if (error) { console.warn('[library] fetchRemoteCompleted error', error); return null; }
      return (data || []).map(r => r.lesson_key).filter(k => typeof k === 'string' && k.length > 0);
    } catch (e) {
      console.warn('[library] fetchRemoteCompleted exception', e);
      return null;
    }
  }

  /* ---- Pull from Supabase, merge with localStorage, re-render ----
     2026-08-07: delegate to window.bwcSync.pullMerge() when available. It does
     the same union but ALSO (a) honours pending un-marks so a deleted lesson
     can't be resurrected by the pull, and (b) pushes local-only keys back up.
     The standalone fetch below stays as a fallback if the sync engine failed
     to load — it is read-only and cannot make things worse. */
  async function syncAndRefresh(allLessons, refreshFn) {
    const user = window.bwcAuth && window.bwcAuth.getUser ? window.bwcAuth.getUser() : null;
    if (!user || !user.id) return; // guest — no action needed

    if (window.bwcSync && typeof window.bwcSync.pullMerge === 'function') {
      await window.bwcSync.pullMerge();
    } else {
      const remoteKeys = await fetchRemoteCompleted(user.id);
      if (remoteKeys === null) return; // fetch failed — keep existing state
      mergeCompleted(remoteKeys);
    }
    updateStats(getCompleted(), allLessons.length);
    refreshFn();
  }

  /* ---- Build set of unique topic tags that appear in the list ---- */
  function collectTopics(list) {
    const seen = new Set();
    list.forEach(item => item.tags.forEach(t => seen.add(t)));
    return Array.from(seen).sort();
  }

  /* ---- Populate the module filter select ---- */
  function populateModuleSelect(el) {
    MODULES.forEach((mod, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `מודול ${i + 1} — ${mod.title}`;
      el.appendChild(opt);
    });
  }

  /* ---- Populate the topic select ---- */
  function populateTopicSelect(el, topics) {
    topics.forEach(topic => {
      const opt = document.createElement('option');
      opt.value = topic;
      opt.textContent = topic;
      el.appendChild(opt);
    });
  }

  /* ---- Apply all active filters and return matching subset ----
     Empty query short-circuits the text-search block entirely so that
     clearing #libSearch (via Backspace, browser X button, or Escape)
     restores the full catalog without any stale needle. */
  function applyFilters(list, completed, state) {
    // Read the query freshly off the state object every call. We avoid
    // destructuring `query` at the parameter level so there's no chance
    // of a stale primitive snapshot if state.query is mutated mid-frame.
    const rawQuery = (state && typeof state.query === 'string') ? state.query : '';
    const needle = rawQuery.trim().toLowerCase();
    const hasQuery = needle.length > 0;

    const typeFilter   = state.typeFilter;
    const moduleFilter = state.moduleFilter;
    const statusFilter = state.statusFilter;
    const topicFilter  = state.topicFilter;

    return list.filter(item => {
      // Text search — search title, meta, tags, AND topic synonyms.
      // Synonyms come from TOPIC_KEYWORDS: e.g. a query for "אווטאר"
      // matches every lesson tagged 'קהל' because 'אווטאר' is listed
      // as a synonym for that topic.
      if (hasQuery) {
        let matched = (item.title + ' ' + item.meta).toLowerCase().includes(needle);

        if (!matched && Array.isArray(item.tags)) {
          for (let i = 0; i < item.tags.length; i++) {
            const tag = item.tags[i];
            if (tag.toLowerCase().includes(needle)) { matched = true; break; }
            const synonyms = TOPIC_KEYWORDS[tag];
            if (synonyms && synonyms.some(s => s.toLowerCase().includes(needle))) {
              matched = true;
              break;
            }
          }
        }

        if (!matched) return false;
      }

      // Type filter
      if (typeFilter === 'modules' && item.type !== 'module') return false;
      if (typeFilter === 'seminars' && item.type !== 'seminar') return false;
      if (typeFilter === 'ai' && !item.isAiTool) return false;

      // Module filter (only meaningful for module type)
      if (moduleFilter !== '' && item.type === 'module' && item.mi !== parseInt(moduleFilter, 10)) return false;
      if (moduleFilter !== '' && item.type === 'seminar') return false;

      // Status filter
      const isDone = completed.includes(item.key);
      if (statusFilter === 'watched' && !isDone) return false;
      if (statusFilter === 'unwatched' && isDone) return false;

      // Topic filter
      if (topicFilter !== '' && !item.tags.includes(topicFilter)) return false;

      return true;
    });
  }

  /* ---- Render a single lesson row ---- */
  function renderRow(item, completed) {
    const isDone = completed.includes(item.key);
    const isAi   = item.isAiTool;

    const row = document.createElement('a');
    row.className = 'lib-row g' + (isAi ? ' lib-row--ai' : '') + (item.type === 'seminar' ? ' lib-row--seminar' : '');
    row.href = item.url;
    if (isAi) {
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }
    row.setAttribute('aria-label', item.title);

    /* Completion icon */
    const iconWrap = document.createElement('span');
    iconWrap.className = 'lib-row__icon ' + (isDone ? 'lib-row__icon--done' : 'lib-row__icon--pending');
    iconWrap.setAttribute('aria-label', isDone ? 'הושלם' : 'לא נצפה');
    iconWrap.innerHTML = isDone
      ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>'
      : '<i class="fa-regular fa-circle" aria-hidden="true"></i>';

    /* Body */
    const body = document.createElement('div');
    body.className = 'lib-row__body';

    const titleEl = document.createElement('div');
    titleEl.className = 'lib-row__title';
    titleEl.textContent = isAi ? (item.aiToolLabel || item.title) : item.displayTitle;

    const metaEl = document.createElement('div');
    metaEl.className = 'lib-row__meta';
    metaEl.textContent = item.meta;

    body.appendChild(titleEl);
    body.appendChild(metaEl);

    /* Right side: tags + CTA */
    const right = document.createElement('div');
    right.className = 'lib-row__right';

    item.tags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'lib-tag' + (isAi ? ' lib-tag--ai' : '');
      chip.textContent = tag;
      right.appendChild(chip);
    });

    if (isAi) {
      const chip = document.createElement('span');
      chip.className = 'lib-tag lib-tag--ai';
      chip.textContent = 'כלי AI';
      right.insertBefore(chip, right.firstChild);
    }

    /* Module-overview link: only for module lessons. Lets the user jump from the
       flat catalog into the focused single-module page (weeks/days view). */
    if (item.type === 'module') {
      const modLink = document.createElement('a');
      modLink.className = 'lib-row__modlink';
      modLink.href = `module.html?id=${item.mi}`;
      modLink.setAttribute('aria-label', `פתח את עמוד מודול ${item.moduleNum}`);
      modLink.innerHTML = '<i class="fa-solid fa-layer-group" aria-hidden="true"></i><span>מודול ' + item.moduleNum + '</span>';
      modLink.addEventListener('click', e => e.stopPropagation());
      right.appendChild(modLink);
    }

    const cta = document.createElement('a');
    cta.className = 'lib-row__cta';
    cta.href = item.url;
    cta.textContent = isAi ? 'פתח' : 'צפה';
    if (isAi) {
      cta.target = '_blank';
      cta.rel = 'noopener noreferrer';
    }
    /* Prevent double-navigation since the whole row is a link */
    cta.addEventListener('click', e => e.stopPropagation());
    right.appendChild(cta);

    row.appendChild(iconWrap);
    row.appendChild(body);
    row.appendChild(right);

    return row;
  }

  /* ---- Update the stats row in the header ---- */
  function updateStats(completed, total) {
    const done = completed.length;
    const remain = total - done;
    const doneEl   = document.getElementById('libStatDone');
    const remainEl = document.getElementById('libStatRemain');
    if (doneEl)   doneEl.textContent = done;
    if (remainEl) remainEl.textContent = remain;
  }

  /* ---- Main render: write rows to DOM ----
     Empty-state toggle is computed up front from filtered.length so a
     prior "no results" view can never linger after the user clears the
     search (Backspace / browser X / Escape all funnel through here). */
  function renderList(filtered, completed) {
    const container = document.getElementById('libList');
    const empty     = document.getElementById('libEmpty');
    const countEl   = document.getElementById('libCount');
    const totalEl   = document.getElementById('libTotal');

    if (!container) return;

    container.innerHTML = '';

    const isEmpty = filtered.length === 0;

    if (countEl) countEl.textContent = filtered.length;
    if (totalEl) totalEl.textContent = window.__libTotalCount || filtered.length;
    if (empty)   empty.hidden = !isEmpty;

    if (isEmpty) return;

    const frag = document.createDocumentFragment();
    filtered.forEach(item => frag.appendChild(renderRow(item, completed)));
    container.appendChild(frag);
  }

  /* ================================================================
     INIT
     ================================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof MODULES === 'undefined' || typeof SEMINARS === 'undefined') {
      console.error('library.js: course-data.js not loaded');
      return;
    }

    const allLessons = buildFlatList();
    window.__libTotalCount = allLessons.length;
    const completed  = getCompleted();
    const topics     = collectTopics(allLessons);

    /* Wire up selects */
    const modSelect   = document.getElementById('libModuleSelect');
    const topicSelect = document.getElementById('libTopicSelect');
    if (modSelect)   populateModuleSelect(modSelect);
    if (topicSelect) populateTopicSelect(topicSelect, topics);

    /* Update stats count */
    const topicCountEl = document.getElementById('libStatTopics');
    if (topicCountEl) topicCountEl.textContent = topics.length;
    updateStats(completed, allLessons.length);

    /* Update total count in subtitle.
       The portal counts only video lessons (131); the AI-tool item has no video
       and is not "completable", so we list it separately instead of folding it
       into the lesson count — keeps this page honest against the portal number. */
    const subtitleCount = document.getElementById('libSubtitleCount');
    if (subtitleCount) {
      const videoCount = allLessons.filter(l => l.videoId).length;
      const aiCount = allLessons.filter(l => l.isAiTool).length;
      subtitleCount.textContent = aiCount > 0
        ? `${videoCount} שיעורים וסמינרים + ${aiCount === 1 ? 'כלי AI אחד' : aiCount + ' כלי AI'}`
        : `${allLessons.length} שיעורים וסמינרים`;
    }

    /* Filter state */
    let state = {
      query: '',
      typeFilter: 'all',
      moduleFilter: '',
      statusFilter: 'all',
      topicFilter: ''
    };

    /* Apply pre-filters from URL params so deep links from the nav and module page
       arrive at the right view. Supported: ?type=modules|seminars|ai · ?module=0..7 */
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const typeParam = urlParams.get('type');
      if (typeParam && ['all', 'modules', 'seminars', 'ai'].includes(typeParam)) {
        state.typeFilter = typeParam;
      }
      const modParam = urlParams.get('module');
      if (modParam !== null && modParam !== '' && !isNaN(parseInt(modParam, 10))) {
        state.moduleFilter = String(parseInt(modParam, 10));
      }
    } catch (_) { /* malformed query string — ignore */ }

    function refresh() {
      const filtered = applyFilters(allLessons, getCompleted(), state);
      renderList(filtered, getCompleted());
    }

    /* Search input */
    const searchEl = document.getElementById('libSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.query = searchEl.value.trim();
        refresh();
      });
    }

    /* Ctrl+K focus search */
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (searchEl) { searchEl.focus(); searchEl.select(); }
      }
    });

    /* Esc clears search */
    if (searchEl) {
      searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape' && searchEl.value) {
          e.preventDefault();
          searchEl.value = '';
          state.query = '';
          refresh();
        }
      });
    }

    /* Type select */
    const typeSelect = document.getElementById('libTypeSelect');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        state.typeFilter = typeSelect.value;
        /* When switching to seminars, clear module filter — it doesn't apply */
        if (state.typeFilter === 'seminars') {
          state.moduleFilter = '';
          if (modSelect) modSelect.value = '';
        }
        refresh();
      });
    }

    /* Module select */
    if (modSelect) {
      modSelect.addEventListener('change', () => {
        state.moduleFilter = modSelect.value;
        refresh();
      });
    }

    /* Status toggle buttons */
    document.querySelectorAll('.lib-filters__toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lib-filters__toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.statusFilter = btn.dataset.status;
        refresh();
      });
    });

    /* Topic select */
    if (topicSelect) {
      topicSelect.addEventListener('change', () => {
        state.topicFilter = topicSelect.value;
        refresh();
      });
    }

    /* Mobile filter panel toggle */
    const mobileToggle  = document.getElementById('libFilterToggle');
    const advancedPanel = document.getElementById('libAdvanced');
    if (mobileToggle && advancedPanel) {
      mobileToggle.addEventListener('click', () => {
        const isOpen = advancedPanel.classList.toggle('open');
        mobileToggle.setAttribute('aria-expanded', String(isOpen));
        const icon = mobileToggle.querySelector('i');
        if (icon) icon.className = isOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-sliders';
      });
    }

    /* Sync the dropdown selects to the initial state, so URL-driven filters
       (?type=modules from the nav, etc.) appear pre-selected in the UI and
       the user can clear them from the dropdown. */
    const typeSelectEl = document.getElementById('libTypeSelect');
    if (typeSelectEl && state.typeFilter !== 'all') typeSelectEl.value = state.typeFilter;
    if (modSelect && state.moduleFilter !== '') modSelect.value = state.moduleFilter;

    /* Initial render */
    refresh();

    /* ---- Re-render whenever the sync engine finishes a pull+merge.
       sync-localstorage.js runs its own pull on auth change; if it got there
       first our pullMerge() call short-circuits, so this event is what
       guarantees the list reflects the merged data. ---- */
    window.addEventListener('bwc:sync-done', () => {
      updateStats(getCompleted(), allLessons.length);
      refresh();
    });

    /* ---- Supabase sync: pull remote progress after auth is ready ---- */
    if (window.bwcAuth && typeof window.bwcAuth.ready === 'function') {
      window.bwcAuth.ready().then(() => {
        // Sync once on page load (handles page refresh while logged in)
        syncAndRefresh(allLessons, refresh);

        // Re-sync on every auth state change (handles login while page is open)
        window.bwcAuth.onChange((user) => {
          if (user && user.id) {
            syncAndRefresh(allLessons, refresh);
          }
        });
      });
    }
  });
})();
