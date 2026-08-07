// tools/split-kb.mjs — one-time prep: split the course transcript KB into
// per-lesson JSON files under api/_kb/ (server-side only).
//
// Why api/_kb/:
//   - Vercel: files under api/ are never served statically; the functions read
//     them from disk (vercel.json functions.includeFiles bundles them).
//   - GitHub Pages mirror: Jekyll is active (no .nojekyll), so any dir starting
//     with "_" is NOT published. Verified live 2026-08-02: /api/_lib/*.js -> 404.
//   => The transcripts (property of Ram & Zvika) are never exposed statically.
//
// Source KB: kb-transcripts/ at the repo root (built 2026-06-01, 131/133
// lessons; the 2 missing module-7 lessons are marked "תמלול חסר").
// 2026-08-07: the KB used to live only in C:\Users\saraa\.claude\tmp-audit\kb\,
// a temp dir that gets cleaned — one cleanup and this script could never run
// again. It now lives in-repo (gitignored: public repo + paid content), with
// the old temp path kept as a fallback.
//
// Usage: node tools/split-kb.mjs [--kb <dir>]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const KB_FALLBACK = 'C:/Users/saraa/.claude/tmp-audit/kb';
const KB_IN_REPO = path.join(ROOT, 'kb-transcripts');
const KB_DIR = process.argv.includes('--kb')
  ? process.argv[process.argv.indexOf('--kb') + 1]
  : (fs.existsSync(KB_IN_REPO) ? KB_IN_REPO : KB_FALLBACK);
const OUT_DIR = path.join(ROOT, 'api', '_kb');

// ---- load course-data.js (browser-style file) ----
const courseSrc = fs.readFileSync(path.join(ROOT, 'js', 'course-data.js'), 'utf8');
const sandboxWindow = {};
new Function('window', courseSrc)(sandboxWindow);
const MODULES = sandboxWindow.MODULES;
const SEMINARS = sandboxWindow.SEMINARS;
if (!MODULES || !SEMINARS) throw new Error('course-data.js did not expose window.MODULES/SEMINARS');

fs.mkdirSync(OUT_DIR, { recursive: true });

const index = []; // manifest of all lesson keys
let written = 0, missing = 0;

function writeLesson(key, title, text) {
  const clean = text.trim();
  if (!clean || /תמלול חסר/.test(clean.slice(0, 200))) {
    missing++;
    return;
  }
  fs.writeFileSync(
    path.join(OUT_DIR, `${key}.json`),
    JSON.stringify({ key, title, chars: clean.length, text: clean }),
    'utf8'
  );
  index.push({ key, title, chars: clean.length });
  written++;
}

function splitSections(md, level) {
  // returns [{header, body}] for headers of the given level ("## " or "### ")
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm');
  const out = [];
  let m, prev = null;
  while ((m = re.exec(md)) !== null) {
    if (prev) out.push({ header: prev.header, body: md.slice(prev.end, m.index) });
    prev = { header: m[1].trim(), end: m.index + m[0].length };
  }
  if (prev) out.push({ header: prev.header, body: md.slice(prev.end) });
  return out;
}

// ---- modules ----
MODULES.forEach((mod, mi) => {
  const md = fs.readFileSync(path.join(KB_DIR, `module-${mi + 1}.md`), 'utf8');
  const sections = splitSections(md, 2);
  // flatten the real lesson order from course-data
  const flat = [];
  mod.weeks.forEach((week, wi) => {
    week.days.forEach((day, di) => {
      flat.push({ key: `m${mi}-${wi}-${di}`, title: `${mod.title} · ${week.title} · ${day.title}` });
    });
  });
  if (sections.length !== flat.length) {
    console.warn(`[module ${mi + 1}] section count ${sections.length} != lesson count ${flat.length} — mapping by order, verify manually`);
  }
  const n = Math.min(sections.length, flat.length);
  for (let i = 0; i < n; i++) writeLesson(flat[i].key, flat[i].title, sections[i].body);
});

// ---- seminars ----
{
  const md = fs.readFileSync(path.join(KB_DIR, 'seminars.md'), 'utf8');
  const seminarSections = splitSections(md, 2);
  if (seminarSections.length !== SEMINARS.length) {
    console.warn(`[seminars] section count ${seminarSections.length} != seminar count ${SEMINARS.length}`);
  }
  seminarSections.forEach((sec, si) => {
    const sem = SEMINARS[si];
    if (!sem) return;
    const parts = splitSections(sec.body, 3);
    parts.forEach((part, pi) => {
      const p = sem.parts[pi];
      writeLesson(`s${si}-${pi}`, `${sem.title} · ${p ? p.title : part.header}`, part.body);
    });
  });
}

// ---- apply-coach module summaries (compact KB for the application agent) ----
MODULES.forEach((mod, mi) => {
  const gamePath = path.join(KB_DIR, `game-module-${mi + 1}.txt`);
  const summary = fs.existsSync(gamePath) ? fs.readFileSync(gamePath, 'utf8') : '';
  fs.writeFileSync(
    path.join(OUT_DIR, `apply-m${mi}.json`),
    JSON.stringify({
      moduleIdx: mi,
      title: mod.title,
      description: mod.description || mod.shortDescription || '',
      gameSummary: summary.slice(0, 20000),
    }),
    'utf8'
  );
});

fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(index, null, 1), 'utf8');
console.log(`written: ${written} lessons, skipped-missing: ${missing}, apply KBs: ${MODULES.length}`);
console.log(`output: ${OUT_DIR}`);
