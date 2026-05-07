// Multi-provider AI fallback chain: Gemini -> Groq -> OpenRouter.
// All three accept the same system + user prompt. First success wins.

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

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

async function callGemini(system, user) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
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
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
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
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
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
  const providers = [callGemini, callGroq, callOpenRouter];
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
    gemini: !!GEMINI_KEY,
    groq: !!GROQ_KEY,
    openrouter: !!OPENROUTER_KEY,
  };
}
