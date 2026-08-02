/* עוזר היישום — client controller for pages/apply.html.
   Talks to /api/apply-coach (JWT required), keeps the conversation in
   localStorage per module, and saves the final application document to the
   Supabase `application_docs` table (migration 005, RLS: owner row).
   Added 2026-08-02 (Project-100 build). */
(function () {
  'use strict';

  const STORE_PREFIX = 'bwc_apply_v1_m'; // + moduleIdx

  let currentModule = null;
  let sending = false;

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
    log.innerHTML = convo.messages.map(m => `
      <div class="chat-msg chat-msg--${m.role === 'user' ? 'user' : 'ai'}">
        ${m.role === 'user' ? esc(m.content) : md(m.content)}
      </div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function openChat(mi) {
    const mod = (window.MODULES || [])[mi];
    $('chatTitle').textContent = `מודול ${mi + 1} · ${mod ? mod.title : ''}`;
    const convo = loadConvo(mi);
    show('chatWrap');
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
      if (status === 401) { chatError('נדרשת התחברות מחדש. רענן את הדף והתחבר.'); return; }
      if (!data?.ok) { chatError('לא הצלחתי לקבל תשובה כרגע. נסה שוב בעוד רגע.'); return; }
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
      chatError('שגיאת רשת. בדוק את החיבור ונסה שוב.');
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

  function sendUserMessage() {
    const input = $('chatInput');
    const text = (input.value || '').trim();
    if (!text || sending || currentModule === null) return;
    const convo = loadConvo(currentModule);
    convo.messages.push({ role: 'user', content: text });
    saveConvo(currentModule, convo);
    input.value = '';
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
    $('chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserMessage(); }
    });
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
