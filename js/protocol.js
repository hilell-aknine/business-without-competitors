/* 10X AI Learning Protocol — frontend renderer.
   Public API: window.Protocol.render(panelEl, ctx)
     ctx = { videoId, lessonKey, externalGptUrl?, lessonTitle? } */
(function () {
  'use strict';

  const CACHE_PREFIX = 'bwc_protocol_v1_';
  const PROVIDER_LABELS = { anthropic: 'Claude', gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter' };

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
    // On the GitHub Pages mirror there is no /api/*. Fail with an explicit
    // marker instead of letting the 404 be misread as "no transcript".
    if (window.bwcApi && !window.bwcApi.available) {
      return { status: 0, data: { ok: false, reason: 'static_mirror' } };
    }
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

  // Streaming POST (2026-10-19). Asks the server for { stream: true } and calls
  // onDelta(text) as pieces arrive. Returns the same { status, data } shape as
  // postJson, with data = { ok, text, providerUsed, truncated, ...extra }.
  // Falls back to a plain JSON request when the browser cannot read streams,
  // and accepts a plain JSON answer from a server that does not stream
  // (validation errors, 401/429, or an older deployment).
  async function postStream(url, body, onDelta) {
    const canStream = typeof window.ReadableStream === 'function' && typeof window.TextDecoder === 'function';
    if (!canStream || (window.bwcApi && !window.bwcApi.available)) return postJson(url, body);

    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const token = await authToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) {
        // A whole answer from a non-streaming server: show it in one go.
        const whole = data.methodology || data.content || '';
        if (whole) onDelta(whole);
      }
      return { status: res.status, data };
    }

    let text = '';
    let done = null;
    let failed = null;
    let buf = '';
    const handleBlock = (block) => {
      let ev = 'message';
      const dataLines = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return;
      let d;
      try { d = JSON.parse(dataLines.join('\n')); } catch { return; }
      if (ev === 'delta' && typeof d.t === 'string') { text += d.t; onDelta(d.t); }
      else if (ev === 'done') done = d;
      else if (ev === 'error') failed = d;
    };
    const eat = (chunkText) => {
      buf += chunkText.replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        handleBlock(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    };

    let cut = false;
    try {
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          eat(dec.decode(value, { stream: true }));
        }
      } else {
        eat(await res.text());
      }
      if (buf.trim()) eat('\n\n');
    } catch (err) {
      console.error('[Protocol] stream read failed', err);
      cut = true;
    }

    if (done) return { status: 200, data: { ok: true, text, ...done } };
    if (!text) return { status: res.status, data: { ok: false, reason: (failed && failed.reason) || 'stream_failed' } };
    // Text arrived but the stream ended without "done": the answer is partial.
    return { status: 200, data: { ok: true, text, truncated: true, cut } };
  }

  function loginRequiredBlock() {
    return `
      <div class="proto__error" style="border-color:rgba(230,198,90,.4);">
        <strong>הכלים האישיים פתוחים למי שמחובר.</strong><br>
        ההתחברות חינמית ולוקחת חצי דקה, והיא גם שומרת לך את ההתקדמות.
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

  // When the answer leaned on another lesson, the server returns which one.
  // Showing it as a real link is the difference between "trust me" and "go see".
  function sourcesBlock(sources) {
    if (!Array.isArray(sources) || !sources.length) return '';
    const chips = sources.map(s => `
      <button type="button" class="proto__source" data-action="goto-lesson" data-lesson="${escapeHtml(s.key)}">
        <i class="fa-solid fa-play" aria-hidden="true"></i>${escapeHtml(s.title || s.key)}
      </button>`).join('');
    return `<div class="proto__sources"><span>הנושא הזה מופיע גם כאן:</span>${chips}</div>`;
  }

  function coachBlock(coach) {
    const msgs = coach.messages.map(m => `
      <div class="proto__chat-msg proto__chat-msg--${m.role === 'user' ? 'user' : 'ai'}">
        ${m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content) + sourcesBlock(m.sources)}
      </div>`).join('');
    return `
      <div class="proto__card proto__coach" data-role="coach">
        <div class="proto__section-title" style="margin-top:0;">
          <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
          שאל את השיעור
        </div>
        <p class="proto__section-sub">עוזר הלמידה מכיר את התמלול המלא של השיעור הזה, ואם התשובה נמצאת במקום אחר בקורס — הוא ימצא אותה שם ויפנה אותך לשיעור. עונה רק מהחומר, בלי המצאות.</p>
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
        <p>לא מצאתי את הטקסט של השיעור הזה. אם יש לך אותו, הדבק אותו כאן ולחץ "הפעל":</p>
        <textarea data-role="paste" placeholder="הדבק כאן את הטקסט של השיעור..."></textarea>
        <div style="margin-top:.7rem;">
          <button class="proto__cta" data-action="run-paste">הפעל עם הטקסט הזה</button>
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
        if (status === 0) {
          coach.messages.push({ role: 'assistant', content: 'עוזר הלמידה לא זמין בכתובת הזו — הוא רץ על שרת שקיים רק בפורטל המלא. השיעורים עצמם כאן מלאים. כדי לשאול אותי שאלות, פתח את הפורטל בכתובת ' + (window.bwcApi ? window.bwcApi.primary : '') });
        } else if (status === 404) {
          coach.messages.push({ role: 'assistant', content: 'לשיעור הזה אין תמלול במערכת, וגם בשאר הקורס לא מצאתי חומר שעונה על השאלה הזאת. נסה לנסח אותה אחרת, או לשאול אותה בשיעור אחר.' });
        } else if (!data?.ok) {
          coach.messages.pop();
          saveCoach(lessonKey, coach);
          paint();
          const l = wrap.querySelector('[data-role="coach-log"]');
          if (l) l.insertAdjacentHTML('beforeend', errorBlock('לא הצלחתי לענות כרגע. נסה שוב בעוד רגע.'));
          return;
        } else {
          coach.messages.push({ role: 'assistant', content: data.answer, sources: data.sources || [] });
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

    // ---- Streaming UI (2026-10-19) ----
    // Before the first words arrive: a warm rotating line, no technical words.
    // Once text arrives: the answer builds up in place with a "כותב..." marker.
    function startWaiting(prefixHtml, lines) {
      wrap.innerHTML = prefixHtml + loadingBlock(lines[0]);
      let i = 0;
      const timer = setInterval(() => {
        if (i >= lines.length - 1) { clearInterval(timer); return; }
        i += 1;
        const span = wrap.querySelector('.proto__loading span');
        if (span) span.textContent = lines[i];
      }, 3500);
      return () => clearInterval(timer);
    }

    // Returns onDelta(text) for postStream. The first call swaps the waiting
    // line for the live card; later calls re-render at most once per frame.
    function liveWriter(prefixHtml, headerHtml, stopWaiting) {
      let text = '';
      let body = null;
      let queued = false;
      const flush = () => {
        queued = false;
        if (body) body.innerHTML = renderMarkdown(text); // escapes before markdown
      };
      const onDelta = (t) => {
        text += t;
        if (!body) {
          stopWaiting();
          wrap.innerHTML = prefixHtml + `
            <div class="proto__card proto__card--live" data-role="live" aria-live="polite" aria-busy="true">
              ${headerHtml || ''}
              <div data-role="live-body"></div>
              <div class="proto__writing"><span>כותב</span><span class="proto__dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
            </div>`;
          body = wrap.querySelector('[data-role="live-body"]');
        }
        if (!queued) { queued = true; requestAnimationFrame(flush); }
      };
      // Final paint for a cut answer: keep what arrived, say clearly it is partial.
      const showPartial = (message, retryAction) => {
        flush();
        const live = wrap.querySelector('[data-role="live"]');
        if (live) {
          live.removeAttribute('aria-busy');
          live.querySelector('.proto__writing')?.remove();
          live.insertAdjacentHTML('afterend', errorBlock(message, retryAction));
        } else {
          wrap.innerHTML = prefixHtml + errorBlock(message, retryAction);
        }
      };
      return { onDelta, showPartial, started: () => !!body };
    }

    const MSG_CUT = 'התשובה נעצרה באמצע, ומה שמופיע כאן הוא רק ההתחלה שלה. לחץ על "נסה שוב" כדי לקבל אותה שלמה.';
    const MSG_FAILED = 'משהו השתבש בדרך ולא הצלחתי להכין את זה עכשיו. נסה שוב בעוד דקה.';
    const MSG_NETWORK = 'נראה שהחיבור לאינטרנט נפל. בדוק אותו ונסה שוב.';
    const MSG_BUSY = 'היו הרבה בקשות בדקה האחרונה. חכה דקה ונסה שוב.';
    const MSG_SLOW = 'זה לקח יותר זמן מהרגיל ונעצר. נסה שוב, בדרך כלל זה עובר בפעם השנייה.';

    async function runStage1(textOverride) {
      const stopWaiting = startWaiting('', [
        'מכין לך את התרגיל מהשיעור...',
        'מזקק את השיטה בשבילך...',
        'עוד רגע, זה כמעט מוכן...',
      ]);
      const writer = liveWriter('', '', stopWaiting);
      const body = textOverride
        ? { transcript: textOverride, videoId, lessonKey }
        : { videoId, lessonKey };
      try {
        const { status, data } = await postStream('/api/protocol-extract', body, writer.onDelta);
        stopWaiting();
        if (status === 401) {
          wrap.innerHTML = coachBlock(coach) + loginRequiredBlock();
          return;
        }
        if (status === 424) {
          wrap.innerHTML = pasteBlock();
          return;
        }
        if (status === 0) {
          wrap.innerHTML = coachBlock(coach) + errorBlock('את התרגיל הזה אפשר להפעיל רק בפורטל המלא: ' + (window.bwcApi ? window.bwcApi.primary : ''));
          return;
        }
        if (status === 429) {
          wrap.innerHTML = errorBlock(MSG_BUSY, 'run');
          return;
        }
        const text = data?.methodology || data?.text;
        if (!data?.ok || !text) {
          if (writer.started()) writer.showPartial(MSG_CUT, 'run');
          else wrap.innerHTML = errorBlock(status === 504 ? MSG_SLOW : MSG_FAILED, 'run');
          return;
        }
        if (data.truncated) {
          // Never cached: a partial answer must not come back as if complete.
          writer.showPartial(MSG_CUT, 'run');
          return;
        }
        cache = { ...cache, methodology: text, providerUsed: data.providerUsed, transcript: data.transcript };
        saveCache(lessonKey, cache);
        paint();
      } catch (err) {
        stopWaiting();
        console.error('[Protocol] extract failed', err);
        if (writer.started()) writer.showPartial(MSG_CUT, 'run');
        else wrap.innerHTML = errorBlock(MSG_NETWORK, 'run');
      }
    }

    async function runStage2(mode) {
      if (!cache.methodology) return;
      const m = MODES.find(x => x.id === mode);
      const stage1Html = methodologyBlock(cache.methodology, cache.providerUsed, mode);
      const header = `
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem;color:var(--lg-gold,#D4AF37);font-weight:600;">
          <span style="font-size:1.3rem;">${m ? m.emoji : '✨'}</span>
          <span>${escapeHtml(m ? m.title : 'תרגול')}</span>
        </div>`;
      const stopWaiting = startWaiting(stage1Html, [
        'בונה לך תרגיל אישי...',
        'מתאים אותו לשיעור הזה...',
        'עוד רגע, זה כמעט מוכן...',
      ]);
      const writer = liveWriter(stage1Html, header, stopWaiting);
      try {
        const { status, data } = await postStream('/api/protocol-active', {
          transcript: cache.transcript,
          methodology: cache.methodology,
          mode,
        }, writer.onDelta);
        stopWaiting();
        const text = data?.content || data?.text;
        if (!data?.ok || !text || data.truncated) {
          if (writer.started()) { writer.showPartial(MSG_CUT, `mode-${mode}`); return; }
          wrap.innerHTML = stage1Html + errorBlock(status === 429 ? MSG_BUSY
            : status === 401 ? 'צריך להתחבר מחדש כדי להמשיך.'
            : status === 0 ? 'את התרגיל הזה אפשר להפעיל רק בפורטל המלא: ' + (window.bwcApi ? window.bwcApi.primary : '')
            : status === 504 ? MSG_SLOW : MSG_FAILED, `mode-${mode}`);
          return;
        }
        cache.active = cache.active || {};
        cache.active[mode] = { content: text, providerUsed: data.providerUsed };
        cache.lastMode = mode;
        saveCache(lessonKey, cache);
        paint();
      } catch (err) {
        stopWaiting();
        console.error('[Protocol] active failed', err);
        if (writer.started()) writer.showPartial(MSG_CUT, `mode-${mode}`);
        else wrap.innerHTML = stage1Html + errorBlock(MSG_NETWORK, `mode-${mode}`);
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
      else if (action === 'goto-lesson') {
        const key = btn.dataset.lesson;
        // index.html owns lesson selection; inside the tabs iframe there is no
        // such global, so fall back to a top-level navigation.
        if (typeof window.selectLessonByKey === 'function' && window.selectLessonByKey(key)) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          const base = (window.bwcApi && window.bwcApi.primary) ? window.bwcApi.primary : '';
          window.top.location.href = `${base}/index.html#lesson=${encodeURIComponent(key)}`;
        }
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
