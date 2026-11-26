#!/usr/bin/env node
// Builds api/_game/index.json: what api/game-coach.js needs to know about
// every lesson of the practice game, in one file the server reads once.
//
//   node tools/build-game-server-data.mjs
//
// Reads (whatever exists):
//   js/game-data-m<N>.js      level 1   window.GAME_MODULE_<N>
//   js/game-data-l2-m<N>.js   level 2   window.GAME_L2_<N>
//   js/game-data-l3-m<N>.js   level 3   window.GAME_L3_<N>
//
// Writes, per lessonKey (keys sorted, so a re-run gives no diff):
//   title, moduleId
//   paragraphs   the reading text (fallback grounding when the transcript
//                cannot be decrypted)
//   terms        [{ term, definition }]
//   quotes       unique src.quote strings of level 1 + level 2. These were
//                checked word for word against the transcript by
//                tools/check-game-quotes.mjs / check-game-levels.mjs, so they
//                are the only lines the coach may present as lesson quotes.
//   l1           one compact entry per level 1 and level 2 exercise, in file
//                order: { level, type, question, answer, guard }
//                answer = the correct answer as text (a string, or a list for
//                multi-part exercises). guard = the strings a hint must never
//                contain. Used only for hints.
//   tasks        the 3 level 3 tasks: { kind, title, prompt, persona?, opening? }
//
// The level 3 rubrics stay in api/_game/l3-m<N>.json and are not copied here.
// No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const OUT = rel('api', '_game', 'index.json');

function evalWindow(file) {
  const win = {};
  new Function('window', fs.readFileSync(file, 'utf8'))(win);
  return win;
}

const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const normKey = (s) => String(s)
  .replace(/[֑-ׇ]/g, '')
  .replace(/[.,!?:;"'״׳\-–—()]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// The question as the learner sees it, in one line.
function questionText(ex) {
  const parts = [];
  if (isStr(ex.context)) parts.push(clean(ex.context));
  if (isStr(ex.question)) parts.push(clean(ex.question));
  if (isStr(ex.template)) parts.push(clean(ex.template));
  if (isStr(ex.original)) parts.push(`הניסוח המקורי: ${clean(ex.original)}`);
  if (ex.optionA && ex.optionB) parts.push(`${clean(ex.optionA.label || 'א')}: ${clean(ex.optionA.text)} / ${clean(ex.optionB.label || 'ב')}: ${clean(ex.optionB.text)}`);
  if (Array.isArray(ex.steps)) parts.push(ex.steps.map(s => clean(s.prompt)).join(' / '));
  return parts.join(' ');
}

// Returns { answer, guard } or null when the exercise has no usable answer.
function answerOf(ex) {
  const opt = (list, i) => (Array.isArray(list) && isStr(list[i]) ? clean(list[i]) : null);
  switch (ex.type) {
    case 'multiple-choice':
    case 'fill-blank':
    case 'improve':
    case 'scenario':
    case 'quote-cloze': {
      const a = opt(ex.options, ex.correct);
      return a ? { answer: a, guard: [a] } : null;
    }
    case 'compare': {
      const o = ex.correct === 0 ? ex.optionA : ex.optionB;
      return o && isStr(o.text) ? { answer: clean(o.text), guard: [clean(o.text)] } : null;
    }
    case 'match':
    case 'memory': {
      if (!Array.isArray(ex.pairs)) return null;
      return {
        answer: ex.pairs.map(p => `${clean(p.left)}: ${clean(p.right)}`),
        guard: ex.pairs.map(p => clean(p.right)),
      };
    }
    case 'order': {
      if (!Array.isArray(ex.items) || !Array.isArray(ex.correctOrder)) return null;
      const ordered = ex.correctOrder.map(i => opt(ex.items, i)).filter(Boolean);
      return { answer: ordered, guard: ordered };
    }
    case 'sort': {
      if (!Array.isArray(ex.items) || !Array.isArray(ex.buckets)) return null;
      return {
        answer: ex.items.map(i => `${clean(i.text)}: ${clean(ex.buckets[i.bucket])}`),
        guard: ex.items.map(i => clean(i.text)),
      };
    }
    case 'true-false': {
      if (!Array.isArray(ex.statements)) return null;
      return {
        answer: ex.statements.map(s => `${clean(s.text)}: ${s.answer ? 'נכון' : 'לא נכון'}`),
        guard: ex.statements.flatMap(s => [clean(s.text), clean(s.why || '')]).filter(Boolean),
      };
    }
    case 'spot-error': {
      const wrong = opt(ex.sentences, ex.wrong);
      if (!wrong) return null;
      const fix = isStr(ex.fix) ? clean(ex.fix) : '';
      return { answer: [`המשפט השגוי: ${wrong}`, fix ? `הגרסה הנכונה: ${fix}` : ''].filter(Boolean), guard: [wrong, fix].filter(Boolean) };
    }
    case 'decision': {
      if (!Array.isArray(ex.steps)) return null;
      const picks = ex.steps.map(s => opt(s.options, s.correct)).filter(Boolean);
      return { answer: picks, guard: picks };
    }
    default:
      return null;
  }
}

function compact(ex, level) {
  const a = answerOf(ex || {});
  return {
    level,
    type: (ex && ex.type) || 'unknown',
    question: questionText(ex || {}),
    answer: a ? a.answer : '',
    guard: a ? a.guard : [],
  };
}

function main() {
  const lessons = {};
  const stats = { modules: [], l1: 0, l2: 0, l3: 0, quotes: 0 };

  for (let n = 1; n <= 8; n++) {
    const l1File = rel('js', `game-data-m${n}.js`);
    if (!fs.existsSync(l1File)) continue;
    const mod = evalWindow(l1File)[`GAME_MODULE_${n}`];
    if (!mod || !Array.isArray(mod.lessons)) throw new Error(`GAME_MODULE_${n} missing in ${l1File}`);
    stats.modules.push(n);

    const l2File = rel('js', `game-data-l2-m${n}.js`);
    const l3File = rel('js', `game-data-l3-m${n}.js`);
    const l2 = fs.existsSync(l2File) ? (evalWindow(l2File)[`GAME_L2_${n}`] || {}).lessons || {} : {};
    const l3 = fs.existsSync(l3File) ? (evalWindow(l3File)[`GAME_L3_${n}`] || {}).lessons || {} : {};

    for (const lesson of mod.lessons) {
      const key = lesson.lessonKey;
      if (!/^m\d+-\d+-\d+$/.test(key || '')) throw new Error(`bad lessonKey "${key}" in module ${n}`);
      if (lessons[key]) throw new Error(`duplicate lessonKey ${key}`);

      const level1 = Array.isArray(lesson.exercises) ? lesson.exercises : [];
      const level2 = Array.isArray(l2[key]) ? l2[key] : [];
      const seen = new Set();
      const quotes = [];
      for (const ex of [...level1, ...level2]) {
        const q = ex && ex.src && isStr(ex.src.quote) ? clean(ex.src.quote) : null;
        if (!q) continue;
        const k = normKey(q);
        if (seen.has(k)) continue;
        seen.add(k);
        quotes.push(q);
      }

      const reading = lesson.reading || {};
      const entry = {
        title: clean(lesson.title || ''),
        moduleId: n,
        paragraphs: (reading.paragraphs || []).filter(isStr).map(clean),
        terms: (reading.keyTerms || [])
          .filter(t => t && isStr(t.term) && isStr(t.definition))
          .map(t => ({ term: clean(t.term), definition: clean(t.definition) })),
        quotes,
        l1: [...level1.map(ex => compact(ex, 1)), ...level2.map(ex => compact(ex, 2))],
        tasks: (Array.isArray(l3[key]) ? l3[key] : []).map(t => {
          const out = { kind: t.kind, title: clean(t.title || ''), prompt: clean(t.prompt || '') };
          if (isStr(t.persona)) out.persona = clean(t.persona);
          if (isStr(t.opening)) out.opening = clean(t.opening);
          return out;
        }),
      };
      lessons[key] = entry;
      stats.l1 += level1.length;
      stats.l2 += level2.length;
      stats.l3 += entry.tasks.length;
      stats.quotes += quotes.length;
    }
  }

  // Natural order of lesson keys (m0-0-0, m0-1-0, ... m7-2-4), fixed field
  // order inside each entry: the output is byte-identical between runs.
  const ordered = {};
  const num = (k) => k.slice(1).split('-').map(Number);
  for (const key of Object.keys(lessons).sort((a, b) => {
    const x = num(a), y = num(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  })) ordered[key] = lessons[key];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(ordered, null, 1) + '\n';
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (before !== json) fs.writeFileSync(OUT, json);
  console.log(`modules: ${stats.modules.join(',')} · lessons: ${Object.keys(ordered).length} · level 1 exercises: ${stats.l1} · level 2: ${stats.l2} · level 3 tasks: ${stats.l3} · verified quotes: ${stats.quotes}`);
  console.log(`${before === json ? 'unchanged' : 'written'}: ${path.relative(ROOT, OUT)} (${(json.length / 1024).toFixed(0)} KB)`);
}

main();
