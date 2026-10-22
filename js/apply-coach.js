/* עוזר היישום — client controller for pages/apply.html.
   Talks to /api/apply-coach (JWT required), keeps the conversation in
   localStorage per module, and saves the final application document to the
   Supabase `application_docs` table (migration 005, RLS: owner row).
   Added 2026-08-02 (Project-100 build). */
(function () {
  'use strict';

  const STORE_PREFIX = 'bwc_apply_v1_m'; // + moduleIdx
  const DRAFT_PREFIX = 'bwc_apply_draft_v1_m'; // + moduleIdx — unsent answer
  // Max length of one answer. Mirrors MAX_TURN_CHARS in api/apply-coach.js
  // (raised 2,500 -> 10,000 on 2026-10-22).
  const MAX_ANSWER_CHARS = 10000;

  let currentModule = null;
  let sending = false;
  let composer = null;

  const $ = id => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // Minimal safe markdown for assistant messages / final doc.
  function md(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let list = null, para = [];
    const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushP(); flushL(); continue; }
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) { flushP(); flushL(); const tag = `h${Math.min(h[1].length + 2, 6)}`; out.push(`<${tag}>${inline(h[2])}</${tag}>`); continue; }
      const ol = line.match(/^\d+\.\s+(.+)$/);
      if (ol) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(ol[1]); continue; }
      const ul = line.match(/^[-*•]\s+(.+)$/);
      if (ul) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(ul[1]); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return out.join('\n');
  }

  function loadConvo(mi) {
    try { return JSON.parse(localStorage.getItem(STORE_PREFIX + mi)) || { messages: [] }; }
    catch { return { messages: [] }; }
  }
  function saveConvo(mi, convo) {
    try { localStorage.setItem(STORE_PREFIX + mi, JSON.stringify(convo)); } catch {}
  }

  async function authToken() {
    try {
      const { data } = await window.bwcSupabase.auth.getSession();
      return data?.session?.access_token || null;
    } catch { return null; }
  }

  async function api(body) {
    // GitHub Pages mirror has no /api/* — say so instead of 404-ing blindly.
    if (window.bwcApi && !window.bwcApi.available) {
      return { status: 0, data: { ok: false, reason: 'static_mirror' } };
    }
    const token = await authToken();
    const res = await fetch('/api/apply-coach', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // ---- views ----
  function show(id) {
    // Leaving the chat while it is full-screen: close that first.
    const fsApi = window.bwcComposer && window.bwcComposer.fullscreen;
    if (id !== 'chatWrap' && fsApi && fsApi.isOpen() && fsApi.panel() === $('chatWrap')) fsApi.exit();
    ['modulePicker', 'chatWrap', 'docView'].forEach(v => $(v).classList.toggle('hidden', v !== id));
  }

  async function fetchMyDocs() {
    try {
      const { data, error } = await window.bwcSupabase
        .from('application_docs')
        .select('module_idx, title, updated_at')
        .order('module_idx');
      if (error) return {};
      const map = {};
      (data || []).forEach(d => { map[d.module_idx] = d; });
      return map;
    } catch { return {}; }
  }

  async function renderPicker() {
    const grid = $('modGrid');
    const docs = await fetchMyDocs();
    const mods = window.MODULES || [];
    grid.innerHTML = mods.map((m, mi) => `
      <button class="mod-card" data-mi="${mi}" type="button">
        <span class="mod-card__num">מודול ${mi + 1}</span>
        <span class="mod-card__title">${esc(m.title)}</span>
        ${docs[mi] ? '<span class="mod-card__badge">✓ יש מסמך יישום — לחץ לצפייה או להמשך</span>' : ''}
      </button>`).join('');
    grid.querySelectorAll('.mod-card').forEach(btn => {
      btn.addEventListener('click', () => openModule(Number(btn.dataset.mi), docs[Number(btn.dataset.mi)]));
    });
    show('modulePicker');
  }

  async function openModule(mi, existingDoc) {
    currentModule = mi;
    if (existingDoc) {
      const shown = await renderDoc(mi);
      if (shown) return;
    }
    openChat(mi);
  }

  async function renderDoc(mi) {
    try {
      const { data, error } = await window.bwcSupabase
        .from('application_docs')
        .select('title, content, updated_at')
        .eq('module_idx', mi)
        .maybeSingle();
      if (error || !data) return false;
      $('docDate').textContent = data.updated_at ? new Date(data.updated_at).toLocaleDateString('he-IL') : '';
      $('docBody').innerHTML = md(data.content);
      $('docBody').dataset.raw = data.content;
      show('docView');
      return true;
    } catch { return false; }
  }

  function paintChat(convo) {
    const log = $('chatLog');
    // No whitespace around the user text: user bubbles keep line breaks
    // (white-space: pre-line), so template indentation would show.
    log.innerHTML = convo.messages.map(m => m.role === 'user'
      ? `<div class="chat-msg chat-msg--user">${esc(String(m.content).trim())}</div>`
      : `<div class="chat-msg chat-msg--ai">${md(m.content)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function openChat(mi) {
    const mod = (window.MODULES || [])[mi];
    $('chatTitle').textContent = `מודול ${mi + 1} · ${mod ? mod.title : ''}`;
    const convo = loadConvo(mi);
    show('chatWrap');
    if (composer) composer.loadDraft();   // this module's unsent answer, if any
    paintChat(convo);
    if (convo.messages.length === 0) await requestReply(mi, false); // opening turn
  }

  function setLoading(on, text) {
    let el = $('chatLog').querySelector('.chat-loading');
    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'chat-loading';
        $('chatLog').appendChild(el);
      }
      el.textContent = text || 'העוזר חושב...';
      $('chatLog').scrollTop = $('chatLog').scrollHeight;
    } else if (el) el.remove();
  }

  function chatError(msg) {
    const el = document.createElement('div');
    el.className = 'chat-error';
    el.textContent = msg;
    $('chatLog').appendChild(el);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }

  async function requestReply(mi, finalize) {
    if (sending) return;
    sending = true;
    const convo = loadConvo(mi);
    setLoading(true, finalize ? 'מרכיב את מסמך היישום שלך...' : 'העוזר חושב...');
    try {
      const { status, data } = await api({ moduleIdx: mi, history: convo.messages, finalize });
      setLoading(false);
      if (status === 0) {
        chatError('עוזר היישום לא זמין בכתובת הזו — הוא רץ על שרת שקיים רק בפורטל המלא. פתח את ' + (window.bwcApi ? window.bwcApi.primary : '') + ' כדי להשתמש בו.');
        return;
      }
      if (status === 401) { giveBack(mi, finalize); chatError('נדרשת התחברות מחדש. רענן את הדף והתחבר.'); return; }
      if (status === 429) { giveBack(mi, finalize); chatError('היו הרבה בקשות בדקה האחרונה. חכה דקה ונסה שוב, התשובה שלך חזרה לתיבה.'); return; }
      if (status === 400 && data?.reason === 'answer_too_long') { giveBack(mi, finalize); chatError('התשובה ארוכה מדי. קצר אותה מעט ונסה שוב.'); return; }
      if (!data?.ok) { giveBack(mi, finalize); chatError('לא הצלחתי לקבל תשובה כרגע. התשובה שלך חזרה לתיבה, נסה שוב בעוד רגע.'); return; }
      if (finalize) {
        await saveDoc(mi, data.reply);
        await renderDoc(mi);
      } else {
        convo.messages.push({ role: 'assistant', content: data.reply });
        saveConvo(mi, convo);
        paintChat(convo);
      }
    } catch (err) {
      console.error('[apply-coach]', err);
      setLoading(false);
      giveBack(mi, finalize);
      chatError('נראה שהחיבור לאינטרנט נפל. התשובה שלך חזרה לתיבה, נסה שוב.');
    } finally {
      sending = false;
    }
  }

  async function saveDoc(mi, content) {
    try {
      const user = window.bwcAuth && window.bwcAuth.getUser();
      if (!user) return;
      const firstLine = String(content).split('\n').find(l => l.trim()) || '';
      const title = firstLine.replace(/^#+\s*/, '').slice(0, 120);
      const { error } = await window.bwcSupabase
        .from('application_docs')
        .upsert(
          { user_id: user.id, module_idx: mi, title, content },
          { onConflict: 'user_id,module_idx' }
        );
      if (error) console.warn('[apply-coach] save failed', error);
    } catch (err) {
      console.warn('[apply-coach] save failed', err);
    }
  }

  // A failed send must never eat a long answer: take the user's last
  // message back out of the conversation and put it in the box again.
  function giveBack(mi, finalize) {
    if (finalize) return;
    const convo = loadConvo(mi);
    const last = convo.messages[convo.messages.length - 1];
    if (!last || last.role !== 'user') return;
    convo.messages.pop();
    saveConvo(mi, convo);
    paintChat(convo);
    const input = $('chatInput');
    if (!input.value.trim()) {
      input.value = last.content;
      if (composer) composer.refresh();
    }
  }

  function sendUserMessage() {
    const input = $('chatInput');
    const text = (input.value || '').trim();
    if (!text || sending || currentModule === null) return;
    if (text.length > MAX_ANSWER_CHARS) {
      chatError('התשובה ארוכה מ-' + MAX_ANSWER_CHARS.toLocaleString('he-IL') + ' תווים. קצר אותה מעט ונסה שוב.');
      return;
    }
    const convo = loadConvo(currentModule);
    convo.messages.push({ role: 'user', content: text });
    saveConvo(currentModule, convo);
    input.value = '';
    if (composer) { composer.clearDraft(); composer.refresh(); }
    paintChat(convo);
    requestReply(currentModule, false);
  }

  // ---- wiring ----
  function wire() {
    document.body.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'send') sendUserMessage();
      else if (a === 'back' || a === 'doc-back') renderPicker();
      else if (a === 'restart') {
        if (currentModule !== null && confirm('להתחיל את הראיון מחדש? השיחה הנוכחית תימחק (המסמך השמור לא).')) {
          saveConvo(currentModule, { messages: [] });
          openChat(currentModule);
        }
      }
      else if (a === 'finalize') {
        if (currentModule !== null) requestReply(currentModule, true);
      }
      else if (a === 'doc-copy') {
        const raw = $('docBody').dataset.raw || $('docBody').textContent;
        navigator.clipboard?.writeText(raw).then(() => { btn.textContent = 'הועתק ✓'; setTimeout(() => btn.textContent = 'העתק', 1500); });
      }
    });
    // 2026-10-22: Enter is a new line (long answers were sent by accident);
    // Ctrl/Cmd+Enter or the button sends. Box grows with the text.
    if (window.bwcComposer) {
      composer = window.bwcComposer.enhance($('chatInput'), {
        max: MAX_ANSWER_CHARS,
        onSend: sendUserMessage,
        draftKey: () => (currentModule === null ? '' : DRAFT_PREFIX + currentModule),
      });
      window.bwcComposer.fullscreen.bind($('chatFsBtn'), $('chatWrap'), { opener: composer && composer.foot });
    } else {
      $('chatFsBtn')?.remove();
    }
  }

  function applyAuthState() {
    const user = window.bwcAuth && window.bwcAuth.getUser();
    $('authGate').classList.toggle('hidden', !!user);
    if (user) {
      if ($('modulePicker').classList.contains('hidden') &&
          $('chatWrap').classList.contains('hidden') &&
          $('docView').classList.contains('hidden')) {
        renderPicker();
      }
    } else {
      ['modulePicker', 'chatWrap', 'docView'].forEach(v => $(v).classList.add('hidden'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wire();
    if (window.bwcAuth) {
      window.bwcAuth.ready().then(applyAuthState);
      window.bwcAuth.onChange(applyAuthState);
    } else {
      // Supabase chain failed to load — leave the gate visible.
      console.error('[apply-coach] bwcAuth missing; check script order');
    }
  });
})();
