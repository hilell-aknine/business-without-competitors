// tools/build-workbook-kb.mjs — the synthesis step that was never built.
//
// The printed workbook (tools/workbook-builder/build_workbook.mjs) has always
// expected a hand-authored workbooks/<slug>/content.json. Only one existed, and
// it was a placeholder: two lessons keyed "demo-1"/"demo-2" whose own intro says
// "ייכתב מתוך התמלולים בשלב הסינתזה". This is that step.
//
// Reads the real plaintext transcripts in api/_kb/<lessonKey>.json (local only,
// gitignored) and writes one api/_kb/workbook-m<idx>.json per module:
//   - principles: the module's actual concepts, each tagged with the lesson it
//     came from, so nothing in the workbook is unattributable.
//   - sections:   the five building blocks of the apply-coach interview
//     (migration 005 / api/apply-coach.js), turned into fillable fields that
//     are phrased around THIS module's content instead of generic prompts.
//
// One source, two surfaces: the same file feeds the in-portal fillable workbook
// (api/workbook.js) and can be rendered to the print/PDF layout.
//
// Two stages, because a whole module of transcripts (~100K chars) in one prompt
// is both unreliable and close to the context ceiling:
//   A. per lesson  -> a compact concept card        (cached on disk, resumable)
//   B. per module  -> the workbook, from the cards  (small, high-quality input)
//
// Usage:
//   GROQ_API_KEY=... node tools/build-workbook-kb.mjs            # all 8 modules
//   GROQ_API_KEY=... node tools/build-workbook-kb.mjs 0 3        # only 0 and 3
//   ... --force        rebuild the per-lesson cards too (default: reuse cache)
//
// After running:
//   KB_SECRET=<hex64> node tools/encrypt-kb.mjs --verify
// because api/_kb/*.json is gitignored and only the .enc ciphertext ships.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { callAI } from '../api/_lib/providers.js';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const KB_DIR = path.join(ROOT, 'api', '_kb');
const CACHE_DIR = path.join(ROOT, 'tools', '.workbook-cache');

const LESSON_CHARS = 22000;   // same budget the lesson coach gives a transcript
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.slice(2).filter(a => /^[0-7]$/.test(a)).map(Number);

// The five building blocks, in the order the apply-coach interviews them.
// Keeping the ids stable matters: they are the keys inside workbook_entries.answers.
const BLOCKS = [
  { id: 'basics',     title: 'הגדרות בסיס',            ask: 'מה המשימה העסקית מהמודול הזה שהלומד רוצה ליישם, מי המעורבים, ואיפה זה קורה' },
  { id: 'principles', title: 'עקרונות חשיבה',           ask: 'לפי מה הלומד מחליט במשימה הזאת, ועל מה הוא לא מתפשר' },
  { id: 'metrics',    title: 'מדדי תוצאה',              ask: 'איך הלומד יידע שהצליח, במספרים ובתאריכים' },
  { id: 'pitfalls',   title: 'אתגרים נפוצים',           ask: 'מה משתבש כשהלומד ממהר או מחפף, ומה הפתרון' },
  { id: 'examples',   title: 'דוגמה טובה ודוגמה רעה',   ask: 'דוגמה אחת מכל סוג מהעסק של הלומד עצמו, והסבר למה' },
];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// MODULES lives in a browser file with no module system. Evaluating it in a
// throwaway scope is how tools/assemble-game-data.mjs already reads it.
function loadModules() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'course-data.js'), 'utf8');
  const scope = { window: {} };
  const fn = new Function('window', `${src}; return typeof MODULES !== 'undefined' ? MODULES : window.MODULES;`);
  return fn(scope.window);
}

// m{mi}-{wi}-{di} — the same key shape the whole portal uses.
function moduleLessonKeys(mod, mi) {
  const keys = [];
  (mod.weeks || []).forEach((w, wi) => {
    (w.days || w.lessons || []).forEach((_, di) => keys.push(`m${mi}-${wi}-${di}`));
  });
  return keys;
}

function stripFence(s) {
  return String(s || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// Models sometimes wrap valid JSON in prose. Take the outermost {...}.
function parseJsonLoose(text) {
  const t = stripFence(text);
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch {}
  }
  return null;
}

async function askJson(system, user, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callAI(system, user);
    if (!res.text) {
      console.warn(`  [${label}] no provider answered (attempt ${attempt})`);
      continue;
    }
    const parsed = parseJsonLoose(res.text);
    if (parsed) return { parsed, providerUsed: res.providerUsed };
    console.warn(`  [${label}] unparseable JSON (attempt ${attempt})`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage A — one compact concept card per lesson.

const CARD_SYSTEM = [
  'אתה מזקק תמלול של שיעור עסקי לכרטיס מושגים קומפקטי.',
  'החוק העליון: כל מילה שאתה כותב חייבת להיות מעוגנת בתמלול. אסור להוסיף ידע חיצוני, אסור להמציא דוגמאות שלא נאמרו.',
  'אם השיעור דל בתוכן מתודי, החזר מערך מושגים קצר או ריק. עדיף ריק על המצאה.',
  '',
  'החזר JSON בלבד, בלי טקסט לפני או אחרי, במבנה:',
  '{"concepts":[{"name":"שם המושג","explanation":"משפט או שניים שמסבירים מה זה, בלשון השיעור","application":"מה הלומד עושה עם זה בפועל"}],',
  ' "tasks":["משימת יישום קונקרטית שנגזרת מהשיעור"]}',
  '',
  'עד 4 מושגים ועד 3 משימות. עברית. בלי מקף ארוך. בלי סופרלטיבים שיווקיים.',
].join('\n');

async function buildCard(key, title, text) {
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (!FORCE && fs.existsSync(cachePath)) {
    const cached = readJson(cachePath);
    if (cached) return cached;
  }
  const user = [
    `כותרת השיעור: ${title}`,
    '',
    'תמלול השיעור:',
    text.slice(0, LESSON_CHARS),
  ].join('\n');

  const got = await askJson(CARD_SYSTEM, user, key);
  const card = {
    key,
    title,
    concepts: Array.isArray(got?.parsed?.concepts) ? got.parsed.concepts.slice(0, 4) : [],
    tasks: Array.isArray(got?.parsed?.tasks) ? got.parsed.tasks.slice(0, 3) : [],
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(card, null, 1), 'utf8');
  return card;
}

// ---------------------------------------------------------------------------
// Stage B — the module workbook, written from the cards.

function buildWorkbookSystem(mod, mi) {
  return [
    `אתה בונה חוברת עבודה למודול "${mod.title}" בקורס "עסק ללא מתחרים".`,
    'חוברת עבודה היא לא סיכום. היא טופס שהלומד ממלא על העסק שלו, ובסופו יש לו מסמך יישום אישי.',
    '',
    'המבנה מחייב וקבוע — חמש אבני הבניין, בסדר הזה:',
    ...BLOCKS.map((b, i) => `${i + 1}. ${b.id} · ${b.title} — ${b.ask}`),
    '',
    'החוקים:',
    '- כל שאלה חייבת להיות מנוסחת סביב התוכן של המודול הזה ספציפית, לא שאלה גנרית שמתאימה לכל קורס.',
    '- הידע יוצא מהלומד. אתה שואל, לא מלמד, ולא מניח עובדות על העסק שלו.',
    '- ב-metrics אכוף ספציפיות: השאלה עצמה צריכה לדרוש מספר, תאריך או קריטריון.',
    '- כל שאלה מקבלת hint קצר שמסביר מה תשובה טובה נראית, ו-source עם מפתח השיעור שממנו הנושא הגיע.',
    '- source חייב להיות אחד מהמפתחות שקיבלת. אם אין התאמה ברורה, החזר source ריק.',
    '- עברית. בלי מקף ארוך. בלי שפה שיווקית.',
    '',
    'החזר JSON בלבד, בלי טקסט לפני או אחרי:',
    '{"subtitle":"שורה אחת שאומרת מה הלומד ייצא איתו",',
    ' "intro":"שתי פסקאות קצרות: מה המודול הזה מלמד ומה החוברת עושה עם זה",',
    ' "principles":[{"name":"","explanation":"","source":"מפתח שיעור"}],',
    ' "sections":[{"id":"basics","intro":"משפט שממסגר את הבלוק","fields":[{"id":"basics-1","label":"השאלה","hint":"","rows":3,"source":"מפתח שיעור"}]}]}',
    '',
    'עד 6 principles. בכל section בין 2 ל-3 fields. מזהי ה-id של ה-sections חייבים להיות בדיוק: '
      + BLOCKS.map(b => b.id).join(', ') + '.',
    'מזהי ה-fields בפורמט <sectionId>-<מספר רץ>.',
  ].join('\n');
}

function cardsToPrompt(cards) {
  const parts = [];
  for (const c of cards) {
    if (!c.concepts.length && !c.tasks.length) continue;
    parts.push(`### ${c.key} — ${c.title}`);
    for (const k of c.concepts) {
      parts.push(`- ${k.name}: ${k.explanation}${k.application ? ` (יישום: ${k.application})` : ''}`);
    }
    for (const t of c.tasks) parts.push(`  * משימה: ${t}`);
  }
  return parts.join('\n');
}

// The model is asked for a fixed shape; this makes sure we ship that shape even
// when it drifts, instead of writing a half-broken workbook to the KB.
function normalize(raw, mod, mi, cards, version) {
  const validKeys = new Set(cards.map(c => c.key));
  const cleanSource = s => (typeof s === 'string' && validKeys.has(s) ? s : '');

  const byId = new Map();
  for (const s of (Array.isArray(raw?.sections) ? raw.sections : [])) {
    if (s && typeof s.id === 'string') byId.set(s.id, s);
  }

  const sections = BLOCKS.map(block => {
    const got = byId.get(block.id) || {};
    const fields = (Array.isArray(got.fields) ? got.fields : [])
      .filter(f => f && typeof f.label === 'string' && f.label.trim())
      .slice(0, 3)
      .map((f, i) => ({
        id: typeof f.id === 'string' && /^[a-z]+-\d+$/.test(f.id) ? f.id : `${block.id}-${i + 1}`,
        label: String(f.label).trim(),
        hint: typeof f.hint === 'string' ? f.hint.trim() : '',
        rows: Number.isInteger(f.rows) ? Math.min(Math.max(f.rows, 2), 8) : 3,
        source: cleanSource(f.source),
      }));
    return {
      id: block.id,
      title: block.title,
      intro: typeof got.intro === 'string' ? got.intro.trim() : '',
      fields,
    };
  });

  const principles = (Array.isArray(raw?.principles) ? raw.principles : [])
    .filter(p => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, 6)
    .map(p => ({
      name: String(p.name).trim(),
      explanation: typeof p.explanation === 'string' ? p.explanation.trim() : '',
      source: cleanSource(p.source),
    }));

  return {
    moduleIdx: mi,
    version,
    title: mod.title,
    subtitle: typeof raw?.subtitle === 'string' && raw.subtitle.trim()
      ? raw.subtitle.trim()
      : (mod.shortDescription || ''),
    intro: typeof raw?.intro === 'string' && raw.intro.trim() ? raw.intro.trim() : (mod.description || ''),
    principles,
    sections,
    // Which lessons actually contributed. Shown in the UI and in the export so
    // the learner can always walk back to the source.
    lessons: cards.filter(c => c.concepts.length || c.tasks.length).map(c => ({ key: c.key, title: c.title })),
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const MODULES = loadModules();
  const version = new Date().toISOString().slice(0, 10);
  const targets = ONLY.length ? ONLY : MODULES.map((_, i) => i);

  let built = 0;
  for (const mi of targets) {
    const mod = MODULES[mi];
    if (!mod) { console.warn(`[wb] no module ${mi}`); continue; }
    console.log(`\n[wb] module ${mi} — ${mod.title}`);

    const cards = [];
    for (const key of moduleLessonKeys(mod, mi)) {
      const lesson = readJson(path.join(KB_DIR, `${key}.json`));
      if (!lesson || !lesson.text) { console.warn(`  [${key}] no transcript, skipped`); continue; }
      const card = await buildCard(key, lesson.title || key, lesson.text);
      console.log(`  [${key}] ${card.concepts.length} concepts · ${card.tasks.length} tasks`);
      cards.push(card);
    }

    const withContent = cards.filter(c => c.concepts.length || c.tasks.length);
    if (!withContent.length) { console.error(`[wb] module ${mi}: nothing extracted, not writing`); continue; }

    const got = await askJson(buildWorkbookSystem(mod, mi), cardsToPrompt(withContent), `wb-m${mi}`);
    if (!got) { console.error(`[wb] module ${mi}: workbook synthesis failed, not writing`); continue; }

    const wb = normalize(got.parsed, mod, mi, cards, version);
    const fieldCount = wb.sections.reduce((a, s) => a + s.fields.length, 0);
    const thin = wb.sections.filter(s => s.fields.length < 2).map(s => s.id);
    if (thin.length) console.warn(`  ! thin sections (under 2 fields): ${thin.join(', ')}`);

    fs.writeFileSync(path.join(KB_DIR, `workbook-m${mi}.json`), JSON.stringify(wb, null, 1), 'utf8');
    console.log(`  -> api/_kb/workbook-m${mi}.json · ${wb.principles.length} principles · ${fieldCount} fields · ${wb.lessons.length} source lessons (${got.providerUsed})`);
    built++;
  }

  console.log(`\n[wb] built ${built}/${targets.length} modules`);
  if (built) console.log('[wb] next: KB_SECRET=<hex64> node tools/encrypt-kb.mjs --verify');
}

main().catch(e => { console.error(e); process.exit(1); });
