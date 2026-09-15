/* ==========================================================================
   suggest-lesson-titles.mjs — draft a descriptive title for every lesson.

   Why: 115 of the portal's lessons are called "יום 1".."יום 5" on a loop. The
   only thing distinguishing them in the library is the module/week subtitle, so
   the list cannot be scanned, search is worthless ("יום" matches everything),
   and a learner cannot return to "the one about pricing".

   This script ONLY writes a proposal file. It never touches js/course-data.js —
   the titles are reviewed by a human first.

     node tools/suggest-lesson-titles.mjs            # all lessons missing a title
     node tools/suggest-lesson-titles.mjs --all      # regenerate everything
     node tools/suggest-lesson-titles.mjs --limit 10 # smoke run

   Model: Groq (free tier). The Anthropic and Gemini keys in .secrets are both
   out of credit as of 2026-09-15, which is why this does not use the portal's
   own provider chain.
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* fileURLToPath, not new URL(...).pathname: this project lives under a Hebrew
   path, and .pathname hands back percent-encoded text that fs cannot open. */
const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KB_DIR   = path.join(ROOT, 'api', '_kb');
const OUT_JSON = path.join(ROOT, 'tools', 'lesson-titles.proposal.json');

const GROQ_KEY = fs.readFileSync('C:/Users/saraa/.secrets/free-llm-gateway.env', 'utf8')
  .match(/GROQ_API_KEY=(.+)/)[1].trim();
/* qwen over gpt-oss-120b: gpt-oss is a reasoning model, so it burned ~3,000
   tokens per title and the free tier allows only 8,000 tokens PER MINUTE. qwen
   answers directly at ~1,350 tokens and its titles name concrete artefacts from
   the lesson ("לבנות טבלת CPBG של אמונות הלקוחות") instead of paraphrasing the
   module. The binding limit here is tokens-per-minute, not requests-per-day. */
const MODEL = 'qwen/qwen3.8-27b';
const TPM_BUDGET  = 8000;
const EST_TOKENS  = 1400;

const SYSTEM = `אתה עורך תוכן של קורס עסקי בעברית. לכל שיעור אתה כותב כותרת קצרה שמופיעה ברשימת השיעורים בפורטל.

חוקים:
- 4 עד 7 מילים. עברית פשוטה ומדוברת, לא שיווקית.
- הכותרת מתארת מה הלומד ייצא איתו, לא על מה מדברים. "לזהות את הלקוח שמשלם הכי הרבה" ולא "על תמחור".
- ספציפית לשיעור הזה בלבד. אם אותה כותרת מתאימה גם לחמישה שיעורים אחרים בקורס, היא גרועה.
- בלי מרכאות, בלי נקודה בסוף, ובלי המילים "שיעור", "יום", "מודול", "אטומי", "אטומית".
- אסור להשתמש בשם הקורס "עסק ללא מתחרים" ככותרת. זו כותרת של כל הקורס, לא של שיעור.
- חייבת להופיע מילה קונקרטית מהשיעור עצמו: מה בדיוק בונים, מזהים, מחשבים או כותבים.
- מותר ורצוי להתחיל בפועל בשם הפועל.
החזר אך ורק את הכותרת, שורה אחת.`;

/** The opening minutes are greetings and recap. The substance sits in the body. */
function sampleTranscript(text) {
  const n = text.length;
  if (n < 3000) return text;
  return text.slice(Math.floor(n * 0.15), Math.floor(n * 0.15) + 2200) +
         '\n[...]\n' +
         text.slice(Math.floor(n * 0.55), Math.floor(n * 0.55) + 1600);
}

function cleanTitle(raw) {
  return String(raw || '')
    .split('\n').map(s => s.trim()).filter(Boolean).pop() // reasoning models trail the answer
    .replace(/^["'״׳]|["'״׳]$/g, '')
    .replace(/[.。]\s*$/, '')
    .trim();
}

/** Groq answers a 429 with "try again in 7.2s" — obey it instead of guessing. */
function waitFromMessage(msg, attempt) {
  var m = /try again in ([\d.]+)s/i.exec(msg || '');
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 500;
  return 4000 * attempt;
}

async function askGroq(user, attempt = 1) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + GROQ_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 80, temperature: 0.5,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
      })
    });
    const d = await r.json();
    if (d.error) {
      // 429 / transient: back off and retry, otherwise give up on this lesson
      if (attempt < 7 && /rate|limit|overload|timeout|503|502/i.test(d.error.message || '')) {
        await new Promise(res => setTimeout(res, waitFromMessage(d.error.message, attempt)));
        return askGroq(user, attempt + 1);
      }
      return { error: d.error.message.slice(0, 120) };
    }
    return { title: cleanTitle(d.choices[0].message.content) };
  } catch (e) {
    if (attempt < 7) { await new Promise(res => setTimeout(res, 4000 * attempt)); return askGroq(user, attempt + 1); }
    return { error: e.message };
  }
}

/* ---- Work list: every module lesson whose current title ends in a bare "יום N" ---- */
const all = fs.readdirSync(KB_DIR).filter(f => /^m\d+-\d+-\d+\.json$/.test(f));
const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;

let work = all.map(f => JSON.parse(fs.readFileSync(path.join(KB_DIR, f), 'utf8')))
  .filter(j => wantAll || /·\s*יום \d+\s*$/.test(j.title || ''));
work.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
if (Number.isFinite(limit)) work = work.slice(0, limit);

console.log(`${all.length} module transcripts on disk · ${work.length} need a title`);

/* Checkpoint after every lesson. The first version of this script only wrote
   the file at the very end; a run that reached 90/106 and was then interrupted
   lost all 90. A long free-tier job must be resumable, not atomic. */
function save() {
  results.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const failed = results.filter(r => !r.suggested);
  const dupes = {};
  results.forEach(r => { if (r.suggested) (dupes[r.suggested] ||= []).push(r.key); });
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    model: MODEL,
    total: results.length,
    failed: failed.length,
    repeatedTitles: Object.entries(dupes).filter(([, v]) => v.length > 1)
      .map(([t, keys]) => ({ title: t, keys })),
    titles: results
  }, null, 2), 'utf8');
}

/* Resume: anything already answered in the proposal file is not asked again. */
const results = [];
if (fs.existsSync(OUT_JSON) && !process.argv.includes('--fresh')) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    const seen = new Set();
    (prev.titles || []).filter(t => t.suggested).forEach(t => {
      if (seen.has(t.key)) return;      // an earlier run appended the same key twice
      seen.add(t.key); results.push(t);
    });
  } catch (e) { /* corrupt checkpoint: start over */ }
}
const already = new Set(results.map(r => r.key));

const CONCURRENCY = 1;
/* Pace to the tokens-per-minute ceiling rather than firing and retrying:
   60s / (8000 / 1400) ~= 10.5s between calls. */
const PAUSE_MS    = Math.ceil(60000 / (TPM_BUDGET / EST_TOKENS)) + 500;
let done = 0;

async function worker(queue) {
  while (queue.length) {
    const j = queue.shift();
    const moduleName = (j.title || '').split('·')[0].trim();
    const user = `המודול: ${moduleName}\nתמלול השיעור:\n${sampleTranscript(j.text)}`;
    const out = await askGroq(user);
    results.push({ key: j.key, currentTitle: j.title, chars: j.chars,
                   suggested: out.title || null, error: out.error || null });
    done++;
    save();
    await new Promise(res => setTimeout(res, PAUSE_MS));
    if (done % 10 === 0 || done === work.length) console.log(`  ${done}/${work.length}  (${j.key})`);
  }
}

const queue = work.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

results.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
const failed = results.filter(r => !r.suggested);
const dupes = {};
results.forEach(r => { if (r.suggested) (dupes[r.suggested] ||= []).push(r.key); });
const repeated = Object.entries(dupes).filter(([, v]) => v.length > 1);

fs.writeFileSync(OUT_JSON, JSON.stringify({
  model: MODEL,
  total: results.length,
  failed: failed.length,
  repeatedTitles: repeated.map(([t, keys]) => ({ title: t, keys })),
  titles: results
}, null, 2), 'utf8');

console.log(`\nwrote ${OUT_JSON}`);
console.log(`failed: ${failed.length}${failed.length ? ' -> ' + failed.map(f => f.key).join(', ') : ''}`);
console.log(`titles reused across lessons: ${repeated.length}`);
