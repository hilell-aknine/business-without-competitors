#!/usr/bin/env node
// Validates js/game-data-m*.js against the lesson transcripts.
//
//   node tools/check-game-quotes.mjs
//
// For every exercise: src.quote must appear (after normalising whitespace,
// niqqud and punctuation) inside the transcript of src.lessonKey. The
// transcript comes from api/_kb/<key>.json when that file exists, otherwise
// from the matching "## ..." section of kb-transcripts/module-N.md.
// Structural checks: 6 exercises per lesson, wrongExplanations shape,
// correctOrder is a permutation, template has ___, correct in range,
// no standalone "רם", no em/en dashes, lessonKey exists in js/course-data.js.
// Exits non-zero on any failure. No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);

const TYPES = ['multiple-choice', 'scenario', 'improve', 'fill-blank', 'compare', 'order', 'match'];
const CHOICE_TYPES = ['multiple-choice', 'scenario', 'improve', 'fill-blank'];

// ---------- normalisation ----------
function norm(s) {
  return String(s)
    .replace(/&(rlm|lrm|nbsp);/g, ' ')
    .replace(/[֑-ׇ]/g, '')            // niqqud + cantillation
    .replace(/[‎‏‪-‮]/g, '') // bidi marks
    .replace(/[.,!?:;"'״׳\-–—()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- course data ----------
function loadModules() {
  const src = fs.readFileSync(rel('js', 'course-data.js'), 'utf8');
  const fakeWindow = {};
  const fn = new Function('window', 'document', src +
    '\n;return (typeof MODULES !== "undefined") ? MODULES : window.MODULES;');
  return fn(fakeWindow, {});
}
const MODULES = loadModules();

function courseLesson(key) {
  const m = /^m(\d+)-(\d+)-(\d+)$/.exec(key || '');
  if (!m) return null;
  const day = MODULES?.[+m[1]]?.weeks?.[+m[2]]?.days?.[+m[3]];
  return day ? { mi: +m[1], wi: +m[2], di: +m[3], title: day.title } : null;
}

// ---------- transcripts ----------
const mdCache = new Map();
function mdSections(mi) {
  if (mdCache.has(mi)) return mdCache.get(mi);
  const out = new Map();
  const file = rel('kb-transcripts', `module-${mi + 1}.md`);
  if (fs.existsSync(file)) {
    const parts = fs.readFileSync(file, 'utf8').split(/^## +/m).slice(1);
    const weeks = MODULES?.[mi]?.weeks || [];
    for (const part of parts) {
      const nl = part.indexOf('\n');
      const heading = part.slice(0, nl).trim();
      const body = part.slice(nl + 1);
      const weekName = heading.split('·')[0].trim();
      const wi = weeks.findIndex(w => (w.title || '').trim() === weekName);
      const dm = /יום\s+(\d+)/.exec(heading);
      const di = dm ? +dm[1] - 1 : 0;
      if (wi >= 0) out.set(`m${mi}-${wi}-${di}`, body);
    }
  }
  mdCache.set(mi, out);
  return out;
}
const txCache = new Map();
function transcript(key) {
  if (txCache.has(key)) return txCache.get(key);
  let text = null, from = null;
  const jf = rel('api', '_kb', `${key}.json`);
  // KB_SOURCE=md forces the .md fallback (useful where api/_kb is encrypted only).
  if (process.env.KB_SOURCE !== 'md' && fs.existsSync(jf)) {
    try { text = JSON.parse(fs.readFileSync(jf, 'utf8')).text; from = 'json'; } catch { /* fall through */ }
  }
  if (!text) {
    const cl = courseLesson(key);
    if (cl) { text = mdSections(cl.mi).get(key) || null; from = text ? 'md' : null; }
  }
  const res = text ? { norm: norm(text), from } : null;
  txCache.set(key, res);
  return res;
}

// ---------- game data ----------
function loadGameModules() {
  const dir = rel('js');
  const files = fs.readdirSync(dir).filter(f => /^game-data-m\d+\.js$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const mods = [];
  for (const f of files) {
    const win = {};
    try {
      new Function('window', fs.readFileSync(path.join(dir, f), 'utf8'))(win);
    } catch (e) {
      mods.push({ file: f, error: `does not evaluate: ${e.message}` });
      continue;
    }
    const names = Object.keys(win).filter(k => /^GAME_MODULE_\d+$/.test(k));
    if (!names.length) { mods.push({ file: f, error: 'no window.GAME_MODULE_N found' }); continue; }
    for (const n of names) mods.push({ file: f, name: n, data: win[n] });
  }
  return mods;
}

function strings(v, pathStr, out) {
  if (typeof v === 'string') out.push([pathStr, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${pathStr}[${i}]`, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], `${pathStr}.${k}`, out);
  return out;
}
const RAM = /(^|[^א-ת])רם($|[^א-ת])/;
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;

function checkExercise(ex, lesson, errs) {
  const E = (msg) => errs.push(msg);
  if (!TYPES.includes(ex.type)) { E(`unknown type "${ex.type}"`); return false; }
  if (!isStr(ex.question)) E('missing question');
  if (!isStr(ex.explanation)) E('missing explanation');
  const we = ex.wrongExplanations;
  if (!Array.isArray(we)) E('wrongExplanations is not an array');

  const nullOnlyAt = (n, correct) => {
    if (!Array.isArray(we)) return;
    if (we.length !== n) { E(`wrongExplanations length ${we.length} != ${n}`); return; }
    we.forEach((w, i) => {
      if (i === correct && w !== null) E(`wrongExplanations[${i}] must be null (correct answer)`);
      if (i !== correct && !isStr(w)) E(`wrongExplanations[${i}] must be a non-empty string`);
    });
  };

  if (CHOICE_TYPES.includes(ex.type)) {
    if (!Array.isArray(ex.options) || ex.options.length !== 4 || !ex.options.every(isStr)) E('options must be 4 non-empty strings');
    else if (new Set(ex.options).size !== 4) E('duplicate options');
    const n = Array.isArray(ex.options) ? ex.options.length : 0;
    if (!Number.isInteger(ex.correct) || ex.correct < 0 || ex.correct >= n) E(`correct (${ex.correct}) out of range`);
    else nullOnlyAt(n, ex.correct);
    if (ex.type === 'scenario' && !isStr(ex.context)) E('scenario without context');
    if (ex.type === 'improve' && !isStr(ex.original)) E('improve without original');
    if (ex.type === 'fill-blank' && !(isStr(ex.template) && ex.template.includes('___'))) E('template must contain ___');
  } else if (ex.type === 'compare') {
    for (const k of ['optionA', 'optionB']) if (!ex[k] || !isStr(ex[k].label) || !isStr(ex[k].text)) E(`${k} needs label + text`);
    if (ex.correct !== 0 && ex.correct !== 1) E(`correct (${ex.correct}) must be 0 or 1`);
    else nullOnlyAt(2, ex.correct);
  } else if (ex.type === 'order') {
    const n = Array.isArray(ex.items) ? ex.items.length : 0;
    if (n < 3 || n > 5 || !ex.items.every(isStr)) E('items must be 3-5 non-empty strings');
    const co = ex.correctOrder;
    const perm = Array.isArray(co) && co.length === n && [...co].sort((a, b) => a - b).every((v, i) => v === i);
    if (!perm) E('correctOrder is not a permutation of the item indices');
    else if (co.every((v, i) => v === i)) E('items are displayed already in the correct order (not shuffled)');
    if (Array.isArray(we) && !(we.length === 1 && we[0] === null)) E('order: wrongExplanations must be [null]');
  } else if (ex.type === 'match') {
    const n = Array.isArray(ex.pairs) ? ex.pairs.length : 0;
    if (n < 3 || n > 5 || !ex.pairs.every(p => p && isStr(p.left) && isStr(p.right))) E('pairs must be 3-5 {left, right}');
    else if (new Set(ex.pairs.map(p => p.left)).size !== n || new Set(ex.pairs.map(p => p.right)).size !== n) E('duplicate left/right in pairs');
    if (Array.isArray(we) && !(we.length === 1 && we[0] === null)) E('match: wrongExplanations must be [null]');
  }

  // source quote
  let found = false;
  const src = ex.src;
  if (!src || !isStr(src.quote) || !isStr(src.lessonKey)) { E('missing src.quote / src.lessonKey'); return false; }
  if (src.lessonKey !== lesson.lessonKey) E(`src.lessonKey ${src.lessonKey} != lesson ${lesson.lessonKey}`);
  if (!courseLesson(src.lessonKey)) E(`src.lessonKey ${src.lessonKey} not in course-data.js`);
  const words = norm(src.quote).split(' ').filter(Boolean).length;
  if (words < 8 || words > 30) E(`quote has ${words} words (need 8-30)`);
  const tx = transcript(src.lessonKey);
  if (!tx) E(`no transcript for ${src.lessonKey}`);
  else if (tx.norm.includes(norm(src.quote))) found = true;
  else E(`quote NOT FOUND in transcript of ${src.lessonKey}: "${src.quote}"`);
  return found;
}

// ---------- run ----------
const mods = loadGameModules();
if (!mods.length) { console.error('No js/game-data-m*.js files found.'); process.exit(1); }

let failures = 0, warnings = 0, totalQuotes = 0, foundQuotes = 0;
for (const mod of mods) {
  console.log(`\n=== ${mod.file}${mod.name ? ' · ' + mod.name : ''} ===`);
  if (mod.error) { console.log(`  FAIL ${mod.error}`); failures++; continue; }
  const d = mod.data;
  const modErrs = [];
  if (!Number.isInteger(d.moduleIdx) || !MODULES?.[d.moduleIdx]) modErrs.push(`moduleIdx ${d.moduleIdx} not in course-data.js`);
  if (d.id !== d.moduleIdx + 1) modErrs.push(`id ${d.id} != moduleIdx + 1`);
  for (const k of ['title', 'description', 'icon', 'image']) if (!isStr(d[k])) modErrs.push(`missing ${k}`);
  if (!Array.isArray(d.lessons) || !d.lessons.length) modErrs.push('no lessons');

  for (const [p, s] of strings(d, mod.name, [])) {
    if (/[—–]/.test(s)) modErrs.push(`em/en dash in ${p}: "${s.slice(0, 60)}"`);
    if (RAM.test(s)) modErrs.push(`standalone "רם" in ${p}: "${s.slice(0, 60)}"`);
    if (!/\.src\.quote$/.test(p) && /, ו[א-ת]/.test(s)) { console.log(`  warn  comma before vav in ${p}`); warnings++; }
  }

  const typeTotals = Object.fromEntries(TYPES.map(t => [t, 0]));
  const rows = [];
  const seenKeys = new Set();
  (d.lessons || []).forEach((lesson, li) => {
    const errs = [];
    const cl = courseLesson(lesson.lessonKey);
    if (!cl) errs.push(`lessonKey ${lesson.lessonKey} not in course-data.js`);
    else {
      if (cl.mi !== d.moduleIdx) errs.push(`lessonKey ${lesson.lessonKey} belongs to another module`);
      if (cl.title !== lesson.title) errs.push(`title differs from course-data.js ("${cl.title}")`);
    }
    if (seenKeys.has(lesson.lessonKey)) errs.push('duplicate lessonKey');
    seenKeys.add(lesson.lessonKey);
    if (lesson.id !== li + 1) errs.push(`id ${lesson.id} should be ${li + 1}`);

    const r = lesson.reading || {};
    const paras = Array.isArray(r.paragraphs) ? r.paragraphs : [];
    if (paras.length < 3 || paras.length > 4 || !paras.every(isStr)) errs.push('reading.paragraphs must be 3-4 strings');
    const kt = Array.isArray(r.keyTerms) ? r.keyTerms : [];
    if (kt.length < 3 || kt.length > 5 || !kt.every(t => t && isStr(t.term) && isStr(t.definition))) errs.push('reading.keyTerms must be 3-5 {term, definition}');
    const readWords = paras.join(' ').split(/\s+/).filter(Boolean).length;
    if (readWords < 60 || readWords > 110) { console.log(`  warn  ${lesson.lessonKey}: reading is ${readWords} words (target 60-110)`); warnings++; }

    const exs = Array.isArray(lesson.exercises) ? lesson.exercises : [];
    if (exs.length !== 6) errs.push(`has ${exs.length} exercises (need exactly 6)`);
    let found = 0;
    const types = new Set();
    exs.forEach((ex, ei) => {
      const exErrs = [];
      totalQuotes++;
      if (checkExercise(ex, lesson, exErrs)) { found++; foundQuotes++; }
      if (TYPES.includes(ex.type)) { types.add(ex.type); typeTotals[ex.type]++; }
      exErrs.forEach(m => errs.push(`ex ${ei + 1} (${ex.type}): ${m}`));
    });
    if (types.size < 4) { console.log(`  warn  ${lesson.lessonKey}: only ${types.size} exercise types (target >= 4)`); warnings++; }
    rows.push({ lesson, exs: exs.length, types: types.size, found, readWords, src: transcript(lesson.lessonKey)?.from || '-', errs });
  });

  console.log('  #   key      ex  types  quotes  read  src   status  title');
  for (const r of rows) {
    const st = r.errs.length ? 'FAIL' : 'ok';
    console.log(`  ${String(r.lesson.id).padStart(2)}  ${String(r.lesson.lessonKey).padEnd(7)}  ${String(r.exs).padStart(2)}  ${String(r.types).padStart(5)}  ${(r.found + '/' + r.exs).padStart(6)}  ${String(r.readWords).padStart(4)}  ${r.src.padEnd(4)}  ${st.padEnd(6)}  ${r.lesson.title}`);
    r.errs.forEach(m => console.log(`        - ${m}`));
    failures += r.errs.length;
  }
  modErrs.forEach(m => console.log(`  FAIL ${m}`));
  failures += modErrs.length;

  console.log('  types: ' + TYPES.map(t => `${t}=${typeTotals[t]}`).join('  '));
  for (const t of TYPES) if (typeTotals[t] < 6) { console.log(`  warn  type ${t} appears ${typeTotals[t]} times in the module (target >= 6)`); warnings++; }
}

console.log(`\nquotes found: ${foundQuotes}/${totalQuotes} · failures: ${failures} · warnings: ${warnings}`);
if (failures) { console.log('RESULT: FAIL'); process.exit(1); }
console.log('RESULT: PASS');
