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

  /* ---- Apply all active filters and return matching subset ---- */
  function applyFilters(list, completed, { query, typeFilter, moduleFilter, statusFilter, topicFilter }) {
    const needle = query ? query.toLowerCase() : '';

    return list.filter(item => {
      // Text search
      if (needle) {
        const haystack = (item.title + ' ' + item.meta).toLowerCase();
        if (!haystack.includes(needle)) return false;
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

  /* ---- Main render: write rows to DOM ---- */
  function renderList(filtered, completed) {
    const container = document.getElementById('libList');
    const empty     = document.getElementById('libEmpty');
    const countEl   = document.getElementById('libCount');
    const totalEl   = document.getElementById('libTotal');

    if (!container) return;

    container.innerHTML = '';

    if (countEl) countEl.textContent = filtered.length;
    if (totalEl) totalEl.textContent = window.__libTotalCount || filtered.length;

    if (filtered.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;

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

    /* Update total count in subtitle */
    const subtitleCount = document.getElementById('libSubtitleCount');
    if (subtitleCount) subtitleCount.textContent = allLessons.length;

    /* Filter state */
    let state = {
      query: '',
      typeFilter: 'all',
      moduleFilter: '',
      statusFilter: 'all',
      topicFilter: ''
    };

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

    /* Initial render */
    refresh();
  });
})();
