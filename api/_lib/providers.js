// Multi-provider AI fallback chain: Anthropic -> Gemini -> Groq -> OpenRouter.
// All accept the same system + user prompt. First success wins.
// Anthropic (claude-haiku-4-5, or ANTHROPIC_MODEL) was added 2026-08-02 as the default model for
// the learning agents (cheap + strong Hebrew). If ANTHROPIC_API_KEY is not set
// in the Vercel env, the chain silently falls through to the older providers.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

// Model is overridable from the Vercel env without a code change.
// Default stays Haiku 4.5 (cheap, good Hebrew). Set ANTHROPIC_MODEL=claude-sonnet-5
// for stronger answers at ~2x the cost.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
// Haiku 4.5 still accepts sampling params. Sonnet 5 / Opus 5+ reject `temperature`
// with a 400 and run adaptive thinking when `thinking` is omitted, so for those we
// drop temperature and turn thinking off (plain chat, no tools, short answers).
const ANTHROPIC_IS_HAIKU = ANTHROPIC_MODEL.startsWith('claude-haiku');
const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL = 'deepseek/deepseek-r1-distill-llama-70b:free';

// Time budget (2026-10-19). The old chain gave every provider a flat 25s while
// vercel.json capped the whole function at 30s. With ANTHROPIC_MODEL set to
// claude-sonnet-5, a 10X methodology answer (~1,500 output tokens) takes ~32s
// even on the shortest lesson, so Anthropic was always aborted at 25s, Gemini
// got the last ~5s, and Vercel killed the function: FUNCTION_INVOCATION_TIMEOUT
// on every 10X run. Now the chain shares one budget that fits inside
// maxDuration (vercel.json, 90s): the primary model may use most of it, and
// whatever is left still goes to the fallbacks instead of to a hard kill.
const DEFAULT_BUDGET_MS = 80000;
const PROVIDER_CAP_MS = { anthropic: 55000, gemini: 30000, groq: 20000, openrouter: 20000 };
const MIN_PROVIDER_MS = 4000; // less than this is not worth starting a call

async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// `user` may be a string (single turn) or an array of {role:'user'|'assistant', content}
// messages (multi-turn). All providers accept both shapes.
function toOpenAiMessages(system, user) {
  const msgs = [{ role: 'system', content: system }];
  if (Array.isArray(user)) {
    for (const m of user) msgs.push({ role: m.role, content: m.content });
  } else {
    msgs.push({ role: 'user', content: user });
  }
  return msgs;
}

async function callAnthropic(system, user, timeoutMs) {
  if (!ANTHROPIC_KEY) return null;
  const messages = Array.isArray(user)
    ? user.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: user }];
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      system,
      messages,
      max_tokens: 4096,
      ...(ANTHROPIC_IS_HAIKU ? { temperature: 0.7 } : { thinking: { type: 'disabled' } }),
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error(`[Anthropic] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.filter(b => b.type === 'text').map(b => b.text).join('')
    : null;
  return text ? { text, providerUsed: 'anthropic' } : null;
}

async function callGemini(system, user, timeoutMs) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: Array.isArray(user)
        ? user.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
        : [{ role: 'user', parts: [{ text: user }] }],
      // thinkingBudget 0: Gemini is the fallback, it runs on what is left of the
      // budget. Thinking roughly doubled the latency (16s vs 8s, measured).
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error(`[Gemini] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? { text, providerUsed: 'gemini' } : null;
}

async function callGroq(system, user, timeoutMs) {
  if (!GROQ_KEY) return null;
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: toOpenAiMessages(system, user),
      temperature: 0.7,
      max_tokens: 4096,
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error(`[Groq] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return text ? { text, providerUsed: 'groq' } : null;
}

async function callOpenRouter(system, user, timeoutMs) {
  if (!OPENROUTER_KEY) return null;
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://business-without-competitors.vercel.app',
      'X-Title': 'Business Without Competitors',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: toOpenAiMessages(system, user),
      temperature: 0.7,
      max_tokens: 4096,
    }),
  }, timeoutMs);
  if (!res.ok) {
    console.error(`[OpenRouter] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return text ? { text, providerUsed: 'openrouter' } : null;
}

export async function callAI(systemPrompt, userPrompt, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  const providers = [
    ['anthropic', callAnthropic],
    ['gemini', callGemini],
    ['groq', callGroq],
    ['openrouter', callOpenRouter],
  ];
  for (const [name, provider] of providers) {
    const left = deadline - Date.now();
    if (left < MIN_PROVIDER_MS) break;
    try {
      const result = await provider(systemPrompt, userPrompt, Math.min(PROVIDER_CAP_MS[name], left));
      if (result && result.text) return result;
    } catch (err) {
      console.error(`[Provider] ${name} error: ${err.message}`);
    }
  }
  return { text: null, providerUsed: null, error: 'all_providers_failed' };
}

export function providerStatus() {
  return {
    anthropic: !!ANTHROPIC_KEY,
    gemini: !!GEMINI_KEY,
    groq: !!GROQ_KEY,
    openrouter: !!OPENROUTER_KEY,
  };
}

// ---------------------------------------------------------------------------
// Streaming (2026-10-19). 10X answers take 35-39s on Sonnet 5 when sent whole;
// streamed, the first words arrive in a few seconds. streamAI() walks the same
// chain as callAI() but reports text as it arrives through onDelta(text).
//
// Failure contract (never fail silently):
//   - a provider that fails BEFORE its first token  -> try the next provider
//   - a provider that fails AFTER its first token   -> stop, return what we got
//                                                      with truncated: true
// Result: { text, providerUsed, truncated, reason }
//   text === ''  => nothing reached the user, reason says why.

const FIRST_TOKEN_MS = 20000; // no first token by then = provider is stuck
const IDLE_MS = 20000;        // gap between chunks after the first one

// Reads an SSE body and calls onEvent(dataObject) per `data:` line.
async function readSse(body, onEvent) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      onEvent(obj);
    }
  }
}

// Runs one streaming provider with first-token / idle / hard deadlines.
// `start(signal)` returns the fetch Response; `pick(evt)` maps one SSE event to
// { text?, error?, stop? }.
async function runStream({ name, start, pick, onDelta, timeoutMs, signal }) {
  const controller = new AbortController();
  const onOuterAbort = () => { reason = reason || 'client_gone'; controller.abort(); };
  let text = '';
  let reason = null;
  let stopReason = null;
  let timer = null;
  if (signal) {
    if (signal.aborted) return { text: '', reason: 'client_gone' };
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const arm = (ms, why) => {
    clearTimeout(timer);
    timer = setTimeout(() => { reason = reason || why; controller.abort(); }, ms);
  };
  const hard = setTimeout(() => { reason = reason || 'deadline'; controller.abort(); }, timeoutMs);
  arm(Math.min(FIRST_TOKEN_MS, timeoutMs), 'first_token_timeout');
  try {
    const res = await start(controller.signal);
    if (!res.ok) {
      reason = `http_${res.status}`;
      console.error(`[${name}:stream] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { text: '', reason };
    }
    await readSse(res.body, (evt) => {
      const p = pick(evt) || {};
      if (p.error) { reason = reason || p.error; controller.abort(); return; }
      if (p.stop) stopReason = p.stop;
      if (p.text) {
        text += p.text;
        arm(IDLE_MS, 'idle_timeout');
        onDelta(p.text);
      }
    });
  } catch (err) {
    if (!reason) reason = `error: ${err.message}`;
  } finally {
    clearTimeout(timer);
    clearTimeout(hard);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
  if (!text) return { text: '', reason: reason || 'empty' };
  // A cut by max_tokens is also an incomplete answer; say so.
  if (!reason && (stopReason === 'max_tokens' || stopReason === 'MAX_TOKENS')) reason = 'max_tokens';
  if (reason) console.error(`[${name}:stream] cut after ${text.length} chars: ${reason}`);
  return { text, truncated: !!reason, reason };
}

function streamAnthropic(system, user, onDelta, timeoutMs, signal) {
  if (!ANTHROPIC_KEY) return null;
  const messages = Array.isArray(user)
    ? user.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: user }];
  return runStream({
    name: 'Anthropic', onDelta, timeoutMs, signal,
    start: (sig) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: sig,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        system,
        messages,
        max_tokens: 4096,
        stream: true,
        ...(ANTHROPIC_IS_HAIKU ? { temperature: 0.7 } : { thinking: { type: 'disabled' } }),
      }),
    }),
    pick: (evt) => {
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') return { text: evt.delta.text };
      if (evt.type === 'message_delta' && evt.delta?.stop_reason) return { stop: evt.delta.stop_reason };
      if (evt.type === 'error') return { error: `api_error: ${evt.error?.type || 'unknown'}` };
      return null;
    },
  });
}

function streamGemini(system, user, onDelta, timeoutMs, signal) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
  return runStream({
    name: 'Gemini', onDelta, timeoutMs, signal,
    start: (sig) => fetch(url, {
      method: 'POST',
      signal: sig,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: Array.isArray(user)
          ? user.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
          : [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }),
    pick: (evt) => {
      if (evt.error) return { error: `api_error: ${evt.error.status || evt.error.code || 'unknown'}` };
      const c = evt.candidates?.[0];
      const t = (c?.content?.parts || []).map(p => p.text || '').join('');
      return { text: t, stop: c?.finishReason && c.finishReason !== 'STOP' ? c.finishReason : null };
    },
  });
}

export async function streamAI(systemPrompt, userPrompt, onDelta, { budgetMs = DEFAULT_BUDGET_MS, signal } = {}) {
  const deadline = Date.now() + budgetMs;
  const reasons = [];
  const chain = [
    ['anthropic', streamAnthropic, true],
    ['gemini', streamGemini, true],
    ['groq', callGroq, false],
    ['openrouter', callOpenRouter, false],
  ];
  for (const [name, fn, streams] of chain) {
    if (signal && signal.aborted) { reasons.push('client_gone'); break; }
    const left = deadline - Date.now();
    if (left < MIN_PROVIDER_MS) { reasons.push('budget_exhausted'); break; }
    const timeoutMs = Math.min(PROVIDER_CAP_MS[name], left);
    try {
      if (streams) {
        const r = await fn(systemPrompt, userPrompt, onDelta, timeoutMs, signal);
        if (!r) continue; // provider not configured
        if (r.text) return { text: r.text, providerUsed: name, truncated: !!r.truncated, reason: r.reason };
        reasons.push(`${name}:${r.reason}`);
      } else {
        // Non-streaming fallbacks: deliver the whole answer as one chunk.
        const r = await fn(systemPrompt, userPrompt, timeoutMs);
        if (r && r.text) {
          onDelta(r.text);
          return { text: r.text, providerUsed: name, truncated: false, reason: null };
        }
      }
    } catch (err) {
      reasons.push(`${name}:${err.message}`);
    }
  }
  return { text: '', providerUsed: null, truncated: false, reason: reasons.join(' | ') || 'all_providers_failed' };
}

// Server-Sent Events writer for a Node/Vercel response. Events:
//   delta {t}                              : next piece of the answer
//   done  {providerUsed, truncated, ...}   : finished (truncated => partial)
//   error {reason}                         : nothing usable was produced
export function openSse(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': open\n\n');
  const controller = new AbortController();
  // The learner closed the tab or navigated away: stop paying for tokens.
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const send = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return {
    signal: controller.signal,
    delta: (t) => send('delta', { t }),
    done: (data) => { send('done', data); if (!res.writableEnded) res.end(); },
    error: (data) => { send('error', data); if (!res.writableEnded) res.end(); },
  };
}

// One call for both protocol endpoints: stream the answer, finish honestly.
// `extra` is merged into the done event (e.g. the transcript for stage 2).
export async function streamToClient(res, systemPrompt, userPrompt, extra = {}) {
  const sse = openSse(res);
  const r = await streamAI(systemPrompt, userPrompt, sse.delta, { signal: sse.signal });
  if (!r.text) {
    console.error(`[stream] no answer: ${r.reason}`);
    sse.error({ reason: 'all_providers_failed' });
    return;
  }
  sse.done({ providerUsed: r.providerUsed, truncated: !!r.truncated, ...extra });
}
