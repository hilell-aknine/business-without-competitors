#!/usr/bin/env node
// Validates the level 2 and level 3 practice data against the transcripts.
//
//   node tools/check-game-levels.mjs            all modules that have files
//   node tools/check-game-levels.mjs 1 3        only modules 1 and 3
//
// Level 1 (js/game-data-m*.js) is covered by tools/check-game-quotes.mjs.
//
// Level 2  js/game-data-l2-m<N>.js   window.GAME_L2_<N> = { id, lessons: { <lessonKey>: [6 exercises] } }
// Level 3  js/game-data-l3-m<N>.js   window.GAME_L3_<N> = { id, lessons: { <lessonKey>: [3 tasks] } }
//          api/_game/l3-m<N>.json    { <lessonKey>: [3 rubrics] }   (server only, never sent to the page)
//
// Every lesson of the module's level 1 file must be present in each level
// file, with the same keys. Exits non-zero on any failure. No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);

export const L2_TYPES = ['sort', 'true-false', 'quote-cloze', 'spot-error', 'memory', 'decision'];
export const L3_KINDS = ['explain', 'roleplay', 'apply'];

function norm(s) {
  return String(s)
    .replace(/&(rlm|lrm|nbsp);/g, ' ')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/[.,!?:;"'״׳\-–—()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s) => norm(s).split(' ').filter(Boolean).length;
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
// LEVELS_PARTIAL=1: a module that is still being written. Lessons that are
// not there yet are skipped instead of failing; everything present is checked.
const PARTIAL = process.env.LEVELS_PARTIAL === '1';
const RAM = /(^|[^א-ת])רם($|[^א-ת])/;

function loadCourse() {
  const src = fs.readFileSync(rel('js', 'course-data.js'), 'utf8');
  return new Function('window', 'document', src +
    '\n;return (typeof MODULES !== "undefined") ? MODULES : window.MODULES;')({}, {});
}
const MODULES = loadCourse();

function courseLesson(key) {
  const m = /^m(\d+)-(\d+)-(\d+)$/.exec(key || '');
  if (!m) return null;
  const day = MODULES?.[+m[1]]?.weeks?.[+m[2]]?.days?.[+m[3]];
  return day ? { mi: +m[1], wi: +m[2], di: +m[3] } : null;
}

const mdCache = new Map();
function mdSections(mi) {
  if (mdCache.has(mi)) return mdCache.get(mi);
  const out = new Map();
  const file = rel('kb-transcripts', `module-${mi + 1}.md`);
  if (fs.existsSync(file)) {
    const weeks = MODULES?.[mi]?.weeks || [];
    for (const part of fs.readFileSync(file, 'utf8').split(/^## +/m).slice(1)) {
      const nl = part.indexOf('\n');
      const heading = part.slice(0, nl).trim();
      const wi = weeks.findIndex(w => (w.title || '').trim() === heading.split('·')[0].trim());
      const dm = /יום\s+(\d+)/.exec(heading);
      if (wi >= 0) out.set(`m${mi}-${wi}-${dm ? +dm[1] - 1 : 0}`, part.slice(nl + 1));
    }
  }
  mdCache.set(mi, out);
  return out;
}
const txCache = new Map();
function transcript(key) {
  if (txCache.has(key)) return txCache.get(key);
  let text = null;
  const jf = rel('api', '_kb', `${key}.json`);
  if (process.env.KB_SOURCE !== 'md' && fs.existsSync(jf)) {
    try { text = JSON.parse(fs.readFileSync(jf, 'utf8')).text; } catch { /* fall through */ }
  }
  if (!text) { const cl = courseLesson(key); if (cl) text = mdSections(cl.mi).get(key) || null; }
  const res = text ? norm(text) : null;
  txCache.set(key, res);
  return res;
}

function evalWindow(file) {
  const win = {};
  new Function('window', fs.readFileSync(file, 'utf8'))(win);
  return win;
}

function strings(v, p, out) {
  if (typeof v === 'string') out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${p}[${i}]`, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], `${p}.${k}`, out);
  return out;
}
function textRules(obj, label, E) {
  for (const [p, s] of strings(obj, label, [])) {
    if (/[—–]/.test(s)) E(`em/en dash in ${p}: "${s.slice(0, 50)}"`);
    if (RAM.test(s)) E(`standalone "רם" in ${p}: "${s.slice(0, 50)}"`);
  }
}

function checkL2Exercise(ex, key, E) {
  if (!ex || !L2_TYPES.includes(ex.type)) { E(`unknown type "${ex && ex.type}"`); return; }
  if (!isStr(ex.question)) E('missing question');
  if (!isStr(ex.explanation)) E('missing explanation');

  if (ex.type === 'sort') {
    if (!Array.isArray(ex.buckets) || ex.buckets.length !== 2 || !ex.buckets.every(isStr)) E('sort: buckets must be 2 names');
    const it = ex.items;
    if (!Array.isArray(it) || it.length < 4 || it.length > 6) E('sort: 4-6 items');
    else {
      if (!it.every(i => i && isStr(i.text) && (i.bucket === 0 || i.bucket === 1))) E('sort: each item needs text + bucket 0|1');
      const n0 = it.filter(i => i.bucket === 0).length;
      if (n0 < 2 || it.length - n0 < 2) E('sort: at least 2 items in each bucket');
      if (new Set(it.map(i => norm(i.text))).size !== it.length) E('sort: duplicate items');
    }
  }
  if (ex.type === 'true-false') {
    const st = ex.statements;
    if (!Array.isArray(st) || st.length !== 4) E('true-false: exactly 4 statements');
    else {
      if (!st.every(s => s && isStr(s.text) && typeof s.answer === 'boolean' && isStr(s.why))) E('true-false: each statement needs text, answer (boolean), why');
      const t = st.filter(s => s.answer === true).length;
      if (t === 0 || t === st.length) E('true-false: needs both true and false statements');
    }
  }
  if (ex.type === 'quote-cloze') {
    if (!isStr(ex.template) || (ex.template.match(/___/g) || []).length !== 1) E('quote-cloze: template needs exactly one ___');
    const o = ex.options;
    if (!Array.isArray(o) || o.length !== 4 || !o.every(isStr) || new Set(o.map(norm)).size !== 4) E('quote-cloze: 4 unique options');
    else if (!Number.isInteger(ex.correct) || ex.correct < 0 || ex.correct > 3) E('quote-cloze: correct out of range');
    else {
      const we = ex.wrongExplanations;
      if (!Array.isArray(we) || we.length !== 4) E('quote-cloze: wrongExplanations needs 4 entries');
      else we.forEach((w, i) => {
        if (i === ex.correct ? w !== null : !isStr(w)) E(`quote-cloze: wrongExplanations[${i}] must be ${i === ex.correct ? 'null' : 'a string'}`);
      });
      const tx = transcript(key);
      if (tx && isStr(ex.template)) {
        const filled = norm(ex.template.replace('___', ex.options[ex.correct]));
        if (!tx.includes(filled)) E(`quote-cloze: the completed sentence is not in the transcript word for word: "${filled.slice(0, 70)}"`);
      }
    }
  }
  if (ex.type === 'spot-error') {
    const s = ex.sentences;
    if (!Array.isArray(s) || s.length !== 4 || !s.every(isStr)) E('spot-error: exactly 4 sentences');
    else if (!Number.isInteger(ex.wrong) || ex.wrong < 0 || ex.wrong > 3) E('spot-error: wrong index out of range');
    if (!isStr(ex.fix)) E('spot-error: missing fix (the true version of the wrong sentence)');
  }
  if (ex.type === 'memory') {
    const p = ex.pairs;
    if (!Array.isArray(p) || p.length !== 4) E('memory: exactly 4 pairs');
    else {
      if (!p.every(x => x && isStr(x.left) && isStr(x.right))) E('memory: each pair needs left + right');
      else {
        if (p.some(x => words(x.left) > 5)) E('memory: left side is at most 5 words');
        if (p.some(x => words(x.right) > 14)) E('memory: right side is at most 14 words');
        if (new Set(p.map(x => norm(x.left))).size !== 4 || new Set(p.map(x => norm(x.right))).size !== 4) E('memory: duplicate card text');
      }
    }
  }
  if (ex.type === 'decision') {
    if (!isStr(ex.context)) E('decision: missing context');
    const st = ex.steps;
    if (!Array.isArray(st) || st.length < 2 || st.length > 3) E('decision: 2-3 steps');
    else st.forEach((s, i) => {
      if (!s || !isStr(s.prompt)) { E(`decision: step ${i} missing prompt`); return; }
      if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 3 || !s.options.every(isStr)) { E(`decision: step ${i} needs 2-3 options`); return; }
      if (!Number.isInteger(s.correct) || s.correct < 0 || s.correct >= s.options.length) E(`decision: step ${i} correct out of range`);
      if (!Array.isArray(s.why) || s.why.length !== s.options.length || !s.why.every(isStr)) E(`decision: step ${i} needs one "why" per option`);
    });
  }

  const src = ex.src;
  if (!src || !isStr(src.quote)) { E('missing src.quote'); return; }
  if (src.lessonKey !== key) E(`src.lessonKey ${src.lessonKey} != ${key}`);
  const w = words(src.quote);
  if (w < 8 || w > 30) E(`src.quote has ${w} words (needs 8-30)`);
  const tx = transcript(key);
  if (!tx) E(`no transcript for ${key}`);
  else if (!tx.includes(norm(src.quote))) E(`src.quote not in transcript: "${src.quote.slice(0, 70)}"`);
}

function checkL3(tasks, rubrics, E) {
  if (!Array.isArray(tasks) || tasks.length !== 3) { E('level 3: exactly 3 tasks'); return; }
  tasks.forEach((t, i) => {
    if (!t || t.kind !== L3_KINDS[i]) { E(`level 3: task ${i} must be kind "${L3_KINDS[i]}"`); return; }
    if (!isStr(t.title) || words(t.title) > 7) E(`level 3: task ${i} title is 1-7 words`);
    const pw = isStr(t.prompt) ? words(t.prompt) : 0;
    if (pw < 12 || pw > 70) E(`level 3: task ${i} prompt has ${pw} words (needs 12-70)`);
    if (t.kind === 'roleplay') {
      if (!isStr(t.persona) || words(t.persona) > 30) E('level 3: roleplay persona is 1-30 words');
      if (!isStr(t.opening) || words(t.opening) > 40) E('level 3: roleplay opening is 1-40 words');
    }
    if ('criteria' in t || 'stance' in t) E(`level 3: task ${i} carries rubric fields, they belong in api/_game only`);
  });
  if (!Array.isArray(rubrics) || rubrics.length !== 3) { E('level 3: api/_game needs exactly 3 rubrics for the lesson'); return; }
  rubrics.forEach((r, i) => {
    if (!r || !Array.isArray(r.criteria) || r.criteria.length !== 3 || !r.criteria.every(isStr)) E(`level 3: rubric ${i} needs exactly 3 criteria`);
    if (i === 1 && !isStr(r && r.stance)) E('level 3: roleplay rubric needs a stance');
  });
}

function main() {
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  let failures = 0, quotes = 0, lessonsChecked = 0;
  const typeTotals = Object.fromEntries(L2_TYPES.map(t => [t, 0]));
  const seen = [];

  for (let n = 1; n <= 8; n++) {
    if (only.length && !only.includes(n)) continue;
    const l1File = rel('js', `game-data-m${n}.js`);
    const l2File = rel('js', `game-data-l2-m${n}.js`);
    const l3File = rel('js', `game-data-l3-m${n}.js`);
    const rubFile = rel('api', '_game', `l3-m${n}.json`);
    if (!fs.existsSync(l2File) && !fs.existsSync(l3File)) continue;
    seen.push(n);
    const errs = [];
    const E = (m) => errs.push(m);

    const keys = evalWindow(l1File)[`GAME_MODULE_${n}`].lessons.map(l => l.lessonKey);
    const l1Quotes = new Set();
    evalWindow(l1File)[`GAME_MODULE_${n}`].lessons.forEach(l => l.exercises.forEach(e => e.src && l1Quotes.add(norm(e.src.quote))));

    let l2 = null, l3 = null, rub = null;
    try { l2 = fs.existsSync(l2File) ? evalWindow(l2File)[`GAME_L2_${n}`] : null; } catch (e) { E(`level 2 file does not evaluate: ${e.message}`); }
    try { l3 = fs.existsSync(l3File) ? evalWindow(l3File)[`GAME_L3_${n}`] : null; } catch (e) { E(`level 3 file does not evaluate: ${e.message}`); }
    try { rub = fs.existsSync(rubFile) ? JSON.parse(fs.readFileSync(rubFile, 'utf8')) : null; } catch (e) { E(`api/_game/l3-m${n}.json is not valid JSON: ${e.message}`); }

    if (fs.existsSync(l2File) && (!l2 || !l2.lessons)) E(`window.GAME_L2_${n}.lessons missing`);
    if (fs.existsSync(l3File) && (!l3 || !l3.lessons)) E(`window.GAME_L3_${n}.lessons missing`);
    if (l3 && !rub) E(`api/_game/l3-m${n}.json missing`);

    if (l2 && l2.lessons) {
      textRules(l2, `GAME_L2_${n}`, E);
      for (const k of Object.keys(l2.lessons)) if (!keys.includes(k)) E(`level 2: unknown lesson key ${k}`);
      for (const key of keys) {
        const LE = (m) => E(`[L2 ${key}] ${m}`);
        const list = l2.lessons[key];
        if (!Array.isArray(list)) { if (!PARTIAL) LE('lesson missing'); continue; }
        lessonsChecked++;
        if (list.length !== 6) LE(`has ${list.length} exercises (needs 6)`);
        const counts = {};
        const lessonQuotes = new Set();
        list.forEach((ex, i) => {
          checkL2Exercise(ex, key, (m) => LE(`#${i + 1} ${ex && ex.type}: ${m}`));
          if (ex && L2_TYPES.includes(ex.type)) { counts[ex.type] = (counts[ex.type] || 0) + 1; typeTotals[ex.type]++; }
          if (ex && ex.src && isStr(ex.src.quote)) {
            quotes++;
            const q = norm(ex.src.quote);
            if (lessonQuotes.has(q)) LE(`#${i + 1}: the same quote is used twice in this lesson`);
            lessonQuotes.add(q);
          }
        });
        if (Object.keys(counts).length < 4) LE(`uses ${Object.keys(counts).length} exercise types (needs at least 4)`);
        for (const [t, c] of Object.entries(counts)) if (c > 2) LE(`type ${t} appears ${c} times (max 2)`);
        const reused = [...lessonQuotes].filter(q => l1Quotes.has(q)).length;
        if (reused > 2) LE(`${reused} quotes are copied from level 1 (max 2, find new lines in the transcript)`);
      }
    }

    if (l3 && l3.lessons) {
      textRules(l3, `GAME_L3_${n}`, E);
      if (rub) textRules(rub, `l3-m${n}.json`, E);
      for (const k of Object.keys(l3.lessons)) if (!keys.includes(k)) E(`level 3: unknown lesson key ${k}`);
      for (const key of keys) {
        if (!l3.lessons[key]) { if (!PARTIAL) E(`[L3 ${key}] lesson missing`); continue; }
        checkL3(l3.lessons[key], rub && rub[key], (m) => E(`[L3 ${key}] ${m}`));
      }
    }

    console.log(`module ${n}: ${keys.length} lessons · level 2 ${l2 ? 'present' : 'absent'} · level 3 ${l3 ? 'present' : 'absent'} · ${errs.length} failures`);
    errs.forEach(e => console.log('  FAIL  ' + e));
    failures += errs.length;
  }

  if (!seen.length) { console.log('no level 2 / level 3 files found'); process.exit(only.length ? 1 : 0); }
  console.log(`\ntypes: ${L2_TYPES.map(t => `${t}=${typeTotals[t]}`).join('  ')}`);
  console.log(`modules: ${seen.join(',')} · lessons with level 2: ${lessonsChecked} · quotes checked: ${quotes} · failures: ${failures}`);
  console.log(`RESULT: ${failures ? 'FAIL' : 'PASS'}`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
