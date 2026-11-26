#!/usr/bin/env node
// Local harness for api/game-coach.js: a tiny HTTP server (Node http, no
// dependencies) that mounts the real handler behind a Vercel-like
// res.status().json() shim. LOCAL TESTING ONLY.
//
//   node --env-file=<file with ANTHROPIC_API_KEY> tools/run-game-coach-local.mjs <port>
//
// Env it needs (it refuses to start otherwise):
//   GAME_COACH_TEST_USER   any uuid; the user id the test token resolves to
//   VERCEL                 must be UNSET (Vercel sets it on every deployment,
//                          so this file cannot serve as a back door there)
// Env it sets if missing: GAME_AI_ENABLED=1, QUOTA_MODE=memory, GAME_AI_DEBUG=1.
//
// How auth works here without weakening api/_lib/guard.js: the guard verifies
// a token by calling <SUPABASE_URL>/auth/v1/user. Before the handler is
// imported, the harness points SUPABASE_URL at ITSELF and answers that call:
// only the test token (GAME_COACH_TEST_TOKEN, default "local-test-token")
// resolves to GAME_COACH_TEST_USER, anything else gets 401. The same local
// stub answers the surprise-cache RPCs from memory with the limits of
// migration 016. So the real guard, the real quota module and the real RPC
// client code all run, and nothing can reach the production Supabase project.
//
// Fixtures: while js/game-data-l3-m1.js / api/_game/l3-m1.json do not exist,
// lesson m0-0-0 gets the level 3 tasks and rubrics written at the bottom of
// this file (test text, not course content). Real data wins when present.

import http from 'node:http';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('usage: node tools/run-game-coach-local.mjs <port>');
  process.exit(2);
}
if (process.env.VERCEL) {
  console.error('refusing to start: VERCEL is set. This harness is for a local machine only.');
  process.exit(2);
}
const TEST_USER = process.env.GAME_COACH_TEST_USER || '';
if (!/^[0-9a-f-]{36}$/i.test(TEST_USER)) {
  console.error('refusing to start: set GAME_COACH_TEST_USER to a uuid.');
  process.exit(2);
}
const TEST_TOKEN = process.env.GAME_COACH_TEST_TOKEN || 'local-test-token';

process.env.SUPABASE_URL = `http://127.0.0.1:${port}/__supabase`;
process.env.SUPABASE_ANON_KEY = 'local-anon-key';
process.env.GAME_AI_ENABLED ||= '1';
process.env.QUOTA_MODE ||= 'memory';
process.env.GAME_AI_DEBUG ||= '1';
// The cache needs a signing secret; a throwaway one is enough locally.
if (!process.env.GAME_CACHE_SECRET && !process.env.KB_SECRET) process.env.GAME_CACHE_SECRET = `local-${Date.now()}-${Math.random()}`;

// Imported only now: guard.js, quota.js and game-coach.js read the env once.
const { createHandler } = await import('../api/game-coach.js');
const fs = await import('node:fs');

// ------------------------------------------------------------- fixtures
const index = JSON.parse(fs.readFileSync(new URL('../api/_game/index.json', import.meta.url), 'utf8'));
const realRubrics = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../api/_game/l3-m1.json', import.meta.url), 'utf8')); } catch { return null; }
})();
const FIXTURE_KEY = 'm0-0-0';
const usingFixtureTasks = !(index[FIXTURE_KEY] && index[FIXTURE_KEY].tasks.length === 3);
const usingFixtureRubric = !(realRubrics && realRubrics[FIXTURE_KEY]);

// Optional: GAME_COACH_KB_FILE=<plain text transcript of m0-0-0>. Without
// KB_SECRET the endpoint grounds on the reading paragraphs; this lets the
// transcript path (selectPassages, the larger cached prefix) run locally too.
// The file stays wherever you keep it, nothing is written into api/_kb.
const kbFile = !process.env.KB_SECRET && process.env.GAME_COACH_KB_FILE ? process.env.GAME_COACH_KB_FILE : null;
const kbText = kbFile ? fs.readFileSync(kbFile, 'utf8') : null;

const handler = createHandler({
  ...(kbText ? { loadKb: (key) => (key === FIXTURE_KEY ? { text: kbText, title: FIXTURE_KEY } : null) } : {}),
  loadLesson(key) {
    const lesson = Object.prototype.hasOwnProperty.call(index, key) ? index[key] : null;
    if (lesson && key === FIXTURE_KEY && usingFixtureTasks) return { ...lesson, tasks: FIXTURE.tasks };
    return lesson;
  },
  loadRubrics(key, moduleId) {
    if (key === FIXTURE_KEY && usingFixtureRubric) return FIXTURE.rubrics;
    try {
      const file = JSON.parse(fs.readFileSync(new URL(`../api/_game/l3-m${moduleId}.json`, import.meta.url), 'utf8'));
      return Array.isArray(file[key]) ? file[key] : null;
    } catch { return null; }
  },
});

// ------------------------------------------- local stand-in for Supabase
const rounds = [];   // { lesson, exercises, by, at }
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
  });
}
async function supabaseStub(req, res, path) {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const token = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1];
  if (token !== TEST_TOKEN) return send(401, { message: 'invalid token' });
  if (path === '/auth/v1/user') return send(200, { id: TEST_USER });
  const body = await readBody(req);
  if (path === '/rest/v1/rpc/game_surprise_get') {
    const mine = rounds.filter(r => r.lesson === body.p_lesson);
    const pick = mine.length ? mine[Math.floor(Math.random() * mine.length)].exercises : null;
    return send(200, { count: mine.length, exercises: pick });
  }
  if (path === '/rest/v1/rpc/game_surprise_put') {
    const ex = body.p_exercises;
    if (!Array.isArray(ex) || ex.length < 4 || ex.length > 6) return send(400, { message: 'bad exercises' });
    if (rounds.filter(r => r.lesson === body.p_lesson).length >= 12) return send(200, false);
    if (rounds.filter(r => r.by === TEST_USER).length >= 20) return send(200, false);
    // Through JSON like jsonb would: the stored copy is detached.
    rounds.push({ lesson: body.p_lesson, exercises: JSON.parse(JSON.stringify(ex)), by: TEST_USER, at: Date.now() });
    return send(200, true);
  }
  return send(404, { message: 'not stubbed' });
}

// --------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/__supabase/')) return supabaseStub(req, res, url.pathname.slice('/__supabase'.length));
  if (url.pathname === '/__cache') {   // test helper: how many rounds are cached
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ rounds: rounds.length }));
  }
  if (url.pathname !== '/api/game-coach') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, reason: 'not_found' }));
  }
  // The Vercel Node helpers the handler uses.
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`[harness] handler threw: ${err.message}`);
    if (!res.writableEnded) res.status(500).json({ ok: false, reason: 'harness_error' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[harness] http://127.0.0.1:${port}/api/game-coach`);
  console.log(`[harness] anthropic key: ${process.env.ANTHROPIC_API_KEY ? 'present' : 'MISSING'} · model: ${process.env.GAME_AI_MODEL || 'claude-haiku-5-5'} · transcript key (KB_SECRET): ${process.env.KB_SECRET ? 'present' : kbText ? `missing, ${FIXTURE_KEY} transcript from GAME_COACH_KB_FILE (${kbText.length} chars)` : 'missing, reading-paragraph fallback'}`);
  console.log(`[harness] ${FIXTURE_KEY} level 3 tasks: ${usingFixtureTasks ? 'FIXTURE' : 'real'} · rubric: ${usingFixtureRubric ? 'FIXTURE' : 'real'}`);
});

// Test text for lesson m0-0-0, used only while the real level 3 data is missing.
const FIXTURE = {
  tasks: [
    {
      kind: 'explain',
      title: 'הסבירו במילים שלכם',
      prompt: 'הסבירו לחבר שמתלבט אם להצטרף לתוכנית למה בחודשים הראשונים לא עובדים על טקטיקה, ולמה לא רואים תוצאות מיד. כתבו שלושה עד חמישה משפטים במילים שלכם.',
    },
    {
      kind: 'roleplay',
      title: 'שיחה עם דנה',
      prompt: 'דנה נרשמה לתוכנית ורוצה תוצאות מהר. עזרו לה להבין, לפי השיעור, למה התוכנית בנויה אחרת ומה יעזור לה להתמיד. ענו לה כמו בשיחה אמיתית.',
      persona: 'דנה, מאמנת כושר עצמאית. נרשמה לתוכנית ורוצה להכפיל הכנסה בתוך שלושה חודשים.',
      opening: 'תגידו, נרשמתי לתוכנית כי אני חייבת להכפיל הכנסה בשלושה חודשים. למה לא נותנים לי כבר את הטקטיקות?',
    },
    {
      kind: 'apply',
      title: 'אצלכם בעסק',
      prompt: 'כתבו איך תיגשו לחודשים הראשונים בתוכנית: מה תעשו כשההתלהבות של ההתחלה תרד, ואיך תדעו שאתם מתקדמים גם בלי תוצאות מיידיות. תנו דוגמה אחת מהעסק שלכם.',
    },
  ],
  rubrics: [
    { criteria: [
      'מסבירים שבחודשים הראשונים בונים אסטרטגיה ולא עובדים על טקטיקה',
      'מסבירים שלא רואים תוצאות מיד כי מתחילים מהשורש',
      'מזכירים שנדרשת סבלנות או התמדה לאורך זמן, ולא התלהבות של התחלה',
    ] },
    {
      criteria: [
        'מכירים בלחץ של דנה בלי לזלזל בו ובלי להבטיח תוצאות מהירות',
        'מסבירים שבחודשים הראשונים בונים אסטרטגיה מהשורש ולכן התוצאות לא מיידיות',
        'מציעים דרך להתמיד: סבלנות, התקדמות הדרגתית, בלי לרדת על עצמה',
      ],
      stance: 'דנה לחוצה כלכלית וחסרת סבלנות. היא נרגעת רק אם מסבירים לה למה מתחילים מהאסטרטגיה ומהשורש, ומכירים בלחץ שלה בלי לזלזל בו. הבטחות לתוצאות מהירות או דיבור כללי על סבלנות לא משכנעים אותה.',
    },
    { criteria: [
      'מתארים מצב מוחשי מהעסק או מהשגרה שלהם',
      'מתארים מה יעשו כשההתלהבות תרד, בלי לרדת על עצמם',
      'מקשרים לרעיון מהשיעור: אסטרטגיה לפני טקטיקה, או סבלנות לאורך זמן',
    ] },
  ],
};
