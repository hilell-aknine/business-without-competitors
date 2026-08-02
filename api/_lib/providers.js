// Multi-provider AI fallback chain: Anthropic -> Gemini -> Groq -> OpenRouter.
// All accept the same system + user prompt. First success wins.
// Anthropic (claude-haiku-4-5) was added 2026-08-02 as the default model for
// the learning agents (cheap + strong Hebrew). If ANTHROPIC_API_KEY is not set
// in the Vercel env, the chain silently falls through to the older providers.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL = 'deepseek/deepseek-r1-distill-llama-70b:free';

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

async function callAnthropic(system, user) {
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
      temperature: 0.7,
    }),
  });
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

async function callGemini(system, user) {
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
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    console.error(`[Gemini] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? { text, providerUsed: 'gemini' } : null;
}

async function callGroq(system, user) {
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
  });
  if (!res.ok) {
    console.error(`[Groq] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return text ? { text, providerUsed: 'groq' } : null;
}

async function callOpenRouter(system, user) {
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
  });
  if (!res.ok) {
    console.error(`[OpenRouter] ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return text ? { text, providerUsed: 'openrouter' } : null;
}

export async function callAI(systemPrompt, userPrompt) {
  const providers = [callAnthropic, callGemini, callGroq, callOpenRouter];
  for (const provider of providers) {
    try {
      const result = await provider(systemPrompt, userPrompt);
      if (result && result.text) return result;
    } catch (err) {
      console.error(`[Provider] error: ${err.message}`);
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
