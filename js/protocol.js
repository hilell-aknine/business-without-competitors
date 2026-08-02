/* 10X AI Learning Protocol — frontend renderer.
   Public API: window.Protocol.render(panelEl, ctx)
     ctx = { videoId, lessonKey, externalGptUrl?, lessonTitle? } */
(function () {
  'use strict';

  const CACHE_PREFIX = 'bwc_protocol_v1_';
  const PROVIDER_LABELS = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter' };

  function loadCache(lessonKey) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + lessonKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveCache(lessonKey, data) {
    try { localStorage.setItem(CACHE_PREFIX + lessonKey, JSON.stringify(data)); } catch {}
  }
  function clearCache(lessonKey) {
    try { localStorage.removeItem(CACHE_PREFIX + lessonKey); } catch {}
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }
  function inlineMd(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<em>$1</em>');
  }
  function renderMarkdown(md) {
    if (!md) return '';
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = []; }
    };
    const flushList = () => {
      if (list) {
        out.push(`<${list.type}>${list.items.map(i => `<li>${inlineMd(i)}</li>`).join('')}</${list.type}>`);
        list = null;
      }
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); flushList(); continue; }
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        flushPara(); flushList();
        const tag = `h${Math.min(h[1].length + 3, 6)}`;
        out.push(`<${tag}>${inlineMd(escapeHtml(h[2]))}</${tag}>`);
        continue;
      }
      if (/^---+$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
      const ol = line.match(/^(\d+)\.\s+(.+)$/);
      if (ol) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(escapeHtml(ol[2]));
        continue;
      }
      const ul = line.match(/^[-*]\s+(.+)$/);
      if (ul) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(escapeHtml(ul[1]));
        continue;
      }
      flushList();
      para.push(escapeHtml(line));
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  // All AI endpoints require a Supabase login since 2026-08-02 (abuse
  // protection + cost control). The JWT rides along on every call.
  async function authToken() {
    try {
      const { data } = await window.bwcSupabase.auth.getSession();
      return data?.session?.access_token || null;
    } catch { return null; }
  }

  async function postJson(url, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = await authToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  function loginRequiredBlock() {
    return `
      <div class="proto__error" style="border-color:rgba(230,198,90,.4);">
        <strong>הפיצ'רים החכמים זמינים למשתמשים מחוברים.</strong><br>
        ההתחברות חינמית ולוקחת חצי דקה — והיא גם שומרת את ההתקדמות שלך בענן.
        <br><button data-action="open-login" style="margin-top:.6rem;">התחברות / הרשמה</button>
      </div>`;
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---- Rendering ----
  const MODES = [
    { id: 'habit',       emoji: '🔁', title: 'צימוד הרגלים',  desc: 'לחבר מיקרו-פעולה אחת מהשיטה להרגל יומיומי קיים' },
    { id: 'sim',         emoji: '🎬', title: 'סימולציה',        desc: 'תסריט לתרגול + תשובה של מומחה לבדיקה עצמית' },
    { id: 'investigate', emoji: '🔍', title: 'חקירה אישית',     desc: '5 שאלות שמתרגמות את המודל לתחום אמיתי בחיים שלך' },
  ];

  // ---- Lesson coach (עוזר הלמידה) ----
  const COACH_PREFIX = 'bwc_coach_v1_';

  function loadCoach(lessonKey) {
    try {
      const raw = localStorage.getItem(COACH_PREFIX + lessonKey);
      return raw ? JSON.parse(raw) : { messages: [] };
    } catch { return { messages: [] }; }
  }
  function saveCoach(lessonKey, state) {
    try {
      // keep the chat bounded so localStorage never bloats
      state.messages = state.messages.slice(-20);
      localStorage.setItem(COACH_PREFIX + lessonKey, JSON.stringify(state));
    } catch {}
  }

  function coachBlock(coach) {
    const msgs = coach.messages.map(m => `
      <div class="proto__chat-msg proto__chat-msg--${m.role === 'user' ? 'user' : 'ai'}">
        ${m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content)}
      </div>`).join('');
    return `
      <div class="proto__card proto__coach" data-role="coach">
        <div class="proto__section-title" style="margin-top:0;">
          <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
          שאל את השיעור
        </div>
        <p class="proto__section-sub">עוזר הלמידה מכיר את התמלול המלא של השיעור הזה ועונה רק ממנו — בלי המצאות.</p>
        <div class="proto__chat-log" data-role="coach-log">${msgs || ''}</div>
        <div class="proto__chat-inputrow">
          <textarea data-role="coach-input" rows="2" maxlength="600"
            placeholder="לדוגמה: מה הרעיון המרכזי כאן? איזו דוגמה רם נתן?"></textarea>
          <button class="proto__cta" data-action="coach-ask" style="white-space:nowrap;">שאל</button>
        </div>
      </div>`;
  }

  function intro(externalGptUrl) {
    return `
      <div class="proto__intro">
        <h3>פרוטוקול 10X — ללמוד פי 10 מהשיעור הזה</h3>
        <p>במקום לצפות פעם אחת ולשכוח, השיטה הזאת מזקקת את המתודולוגיה החבויה בשיעור ובונה לך תרגיל אישי להטמעה. רבע שעה כאן שווה כמה שעות צפייה.</p>
        <button class="proto__cta" data-action="run">
          <i class="fa-solid fa-bolt" aria-hidden="true"></i>
          הפעל פרוטוקול
        </button>
      </div>
      ${externalGptUrl ? `
        <a class="proto__external" href="${escapeHtml(externalGptUrl)}" target="_blank" rel="noopener">
          <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
          <span>אם אתה מעדיף — אפשר גם להשתמש במאמן ה-GPT החיצוני של המודול</span>
          <i class="fa-solid fa-arrow-left" aria-hidden="true" style="margin-inline-start:auto;"></i>
        </a>` : ''}`;
  }

  function loadingBlock(text) {
    return `<div class="proto__loading"><div class="proto__spinner"></div><span>${escapeHtml(text)}</span></div>`;
  }

  function errorBlock(message, retryAction) {
    return `<div class="proto__error">${escapeHtml(message)}${retryAction ? `<br><button data-action="${retryAction}">נסה שוב</button>` : ''}</div>`;
  }

  function pasteBlock() {
    return `
      <div class="proto__paste">
        <p>לא הצלחתי לשלוף תמלול אוטומטי לשיעור הזה. אם יש לך תמלול — הדבק אותו כאן ולחץ "הפעל":</p>
        <textarea data-role="paste" placeholder="הדבק כאן את התמלול של השיעור..."></textarea>
        <div style="margin-top:.7rem;">
          <button class="proto__cta" data-action="run-paste">הפעל פרוטוקול עם התמלול הזה</button>
        </div>
      </div>`;
  }

  function methodologyBlock(methodology, providerUsed, hasActive) {
    return `
      <div class="proto__card" data-role="methodology">
        ${renderMarkdown(methodology)}
        <div class="proto__meta">
          <span class="proto__meta-pill"><i class="fa-solid fa-microchip"></i> נוצר באמצעות ${escapeHtml(PROVIDER_LABELS[providerUsed] || providerUsed || 'AI')}</span>
          <button class="proto__meta-btn" data-action="reset">התחל מחדש</button>
        </div>
      </div>
      <div>
        <div class="proto__section-title">למידה אקטיבית — בחר מצב</div>
        <p class="proto__section-sub">בחר את הדרך שמתאימה לך עכשיו. התוצאה נשמרת אצלך, אפשר להתחיל באחת ולחזור לאחרות בהמשך.</p>
        <div class="proto__modes">
          ${MODES.map(m => `
            <button class="proto__mode${hasActive === m.id ? ' is-active' : ''}" data-action="mode" data-mode="${m.id}">
              <span class="proto__mode-emoji">${m.emoji}</span>
              <span class="proto__mode-title">${escapeHtml(m.title)}</span>
              <span class="proto__mode-desc">${escapeHtml(m.desc)}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  function activeBlock(content, providerUsed, mode) {
    const m = MODES.find(x => x.id === mode);
    return `
      <div class="proto__card" data-role="active">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem;color:var(--lg-gold,#D4AF37);font-weight:600;">
          <span style="font-size:1.3rem;">${m ? m.emoji : '✨'}</span>
          <span>${escapeHtml(m ? m.title : 'תרגול')}</span>
        </div>
        ${renderMarkdown(content)}
        <div class="proto__meta">
          <span class="proto__meta-pill"><i class="fa-solid fa-microchip"></i> נוצר באמצעות ${escapeHtml(PROVIDER_LABELS[providerUsed] || providerUsed || 'AI')}</span>
          <button class="proto__meta-btn" data-action="regen-active" data-mode="${mode}">צור מחדש</button>
        </div>
      </div>`;
  }

  // ---- Controller ----
  function render(panelEl, ctx) {
    const { videoId, lessonKey, externalGptUrl } = ctx || {};
    if (!panelEl || !lessonKey || !videoId) {
      panelEl && (panelEl.innerHTML = `
        <div class="v1-ai__placeholder">
          <i class="fa-solid fa-robot"></i>
          <p>בחר שיעור עם וידאו כדי להפעיל את פרוטוקול הלמידה</p>
        </div>`);
      return;
    }

    let cache = loadCache(lessonKey);
    let coach = loadCoach(lessonKey);

    const wrap = document.createElement('div');
    wrap.className = 'proto';
    panelEl.innerHTML = '';
    panelEl.appendChild(wrap);

    function paint() {
      const has = cache.methodology;
      const hasActiveMode = cache.lastMode || (cache.active && Object.keys(cache.active)[0]);
      let html = coachBlock(coach);
      if (!has) {
        html += intro(externalGptUrl);
      } else {
        html += methodologyBlock(cache.methodology, cache.providerUsed, hasActiveMode);
        if (hasActiveMode && cache.active && cache.active[hasActiveMode]) {
          const a = cache.active[hasActiveMode];
          html += activeBlock(a.content, a.providerUsed, hasActiveMode);
        }
      }
      wrap.innerHTML = html;
      const log = wrap.querySelector('[data-role="coach-log"]');
      if (log) log.scrollTop = log.scrollHeight;
    }

    async function askCoach() {
      const input = wrap.querySelector('[data-role="coach-input"]');
      const question = (input?.value || '').trim();
      if (!question) { input?.focus(); return; }

      const token = await authToken();
      if (!token) {
        const log = wrap.querySelector('[data-role="coach-log"]');
        if (log) log.insertAdjacentHTML('beforeend', loginRequiredBlock());
        return;
      }

      const history = coach.messages.slice(-6);
      coach.messages.push({ role: 'user', content: question });
      saveCoach(lessonKey, coach);
      input.value = '';
      paint();
      const log = wrap.querySelector('[data-role="coach-log"]');
      if (log) log.insertAdjacentHTML('beforeend', loadingBlock('קורא את השיעור...'));

      try {
        const { status, data } = await postJson('/api/lesson-coach', { lessonKey, question, history });
        if (status === 401) {
          coach.messages.pop();
          saveCoach(lessonKey, coach);
          paint();
          const l = wrap.querySelector('[data-role="coach-log"]');
          if (l) l.insertAdjacentHTML('beforeend', loginRequiredBlock());
          return;
        }
        if (status === 404) {
          coach.messages.push({ role: 'assistant', content: 'לשיעור הזה אין עדיין תמלול במערכת, אז אין לי על מה להתבסס. נסה שיעור אחר.' });
        } else if (!data?.ok) {
          coach.messages.pop();
          saveCoach(lessonKey, coach);
          paint();
          const l = wrap.querySelector('[data-role="coach-log"]');
          if (l) l.insertAdjacentHTML('beforeend', errorBlock('לא הצלחתי לענות כרגע. נסה שוב בעוד רגע.'));
          return;
        } else {
          coach.messages.push({ role: 'assistant', content: data.answer });
        }
        saveCoach(lessonKey, coach);
        paint();
      } catch (err) {
        console.error('[Coach] ask failed', err);
        coach.messages.pop();
        saveCoach(lessonKey, coach);
        paint();
        const l = wrap.querySelector('[data-role="coach-log"]');
        if (l) l.insertAdjacentHTML('beforeend', errorBlock('שגיאה ברשת. בדוק את החיבור ונסה שוב.'));
      }
    }

    async function runStage1(transcriptOverride) {
      wrap.innerHTML = loadingBlock(transcriptOverride
        ? 'מעבד את התמלול וזיקוק המתודולוגיה...'
        : 'שולף תמלול מ-YouTube וזיקוק המתודולוגיה...');
      const body = transcriptOverride
        ? { transcript: transcriptOverride, videoId, lessonKey }
        : { videoId, lessonKey };
      try {
        const { status, data } = await postJson('/api/protocol-extract', body);
        if (status === 401) {
          wrap.innerHTML = coachBlock(coach) + loginRequiredBlock();
          return;
        }
        if (status === 424) {
          // transcript not available
          wrap.innerHTML = pasteBlock();
          return;
        }
        if (!data?.ok) {
          wrap.innerHTML = errorBlock('לא הצלחתי לחלץ את המתודולוגיה כרגע. נסה שוב בעוד דקה — או הדבק תמלול ידנית.', 'run');
          return;
        }
        cache = { ...cache, methodology: data.methodology, providerUsed: data.providerUsed, transcript: data.transcript };
        saveCache(lessonKey, cache);
        paint();
      } catch (err) {
        console.error('[Protocol] extract failed', err);
        wrap.innerHTML = errorBlock('שגיאה ברשת. בדוק את החיבור ונסה שוב.', 'run');
      }
    }

    async function runStage2(mode) {
      if (!cache.methodology) return;
      const previous = wrap.innerHTML;
      const stage1Html = methodologyBlock(cache.methodology, cache.providerUsed, mode);
      wrap.innerHTML = stage1Html + loadingBlock('בונה תרגיל למידה אקטיבית...');
      try {
        const { data } = await postJson('/api/protocol-active', {
          transcript: cache.transcript,
          methodology: cache.methodology,
          mode,
        });
        if (!data?.ok) {
          wrap.innerHTML = stage1Html + errorBlock('לא הצלחתי לייצר את התרגול כרגע. נסה שוב.', `mode-${mode}`);
          return;
        }
        cache.active = cache.active || {};
        cache.active[mode] = { content: data.content, providerUsed: data.providerUsed };
        cache.lastMode = mode;
        saveCache(lessonKey, cache);
        paint();
      } catch (err) {
        console.error('[Protocol] active failed', err);
        wrap.innerHTML = previous + errorBlock('שגיאה ברשת. נסה שוב.', `mode-${mode}`);
      }
    }

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'coach-ask') askCoach();
      else if (action === 'open-login') {
        if (typeof window.openLoginModal === 'function') window.openLoginModal();
      }
      else if (action === 'run') runStage1();
      else if (action === 'run-paste') {
        const ta = wrap.querySelector('[data-role="paste"]');
        const text = (ta?.value || '').trim();
        if (text.length < 100) { ta?.focus(); return; }
        runStage1(text);
      }
      else if (action === 'reset') {
        clearCache(lessonKey);
        cache = {};
        paint();
      }
      else if (action === 'mode') runStage2(btn.dataset.mode);
      else if (action === 'regen-active') {
        if (cache.active) delete cache.active[btn.dataset.mode];
        saveCache(lessonKey, cache);
        runStage2(btn.dataset.mode);
      }
      else if (action.startsWith('mode-')) runStage2(action.slice(5));
    });

    paint();
  }

  window.Protocol = { render };
})();
