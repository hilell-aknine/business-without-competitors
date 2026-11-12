// tools/validate-game.mjs — structural check for the practice game data.
//
// Loads js/game-data-m1.js ... -m8.js the way the browser does (each sets
// window.GAME_MODULE_<n>) and checks every lesson and exercise against the
// contract of js/game.js. Read-only. Missing module files are skipped.
//
//   node tools/validate-game.mjs            real data (falls back to the
//                                           fixture when no module exists)
//   node tools/validate-game.mjs --fixture  the test fixture only
//   node tools/validate-game.mjs --strict   warnings also fail the run
//
// Exit code 1 when a gameplay-breaking error is found (or, with --strict,
// any warning), so it can gate a commit.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const JS = path.join(ROOT, 'js');
const FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'game-data-fixture.js');
const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const TOTAL_MODULES = 8;
const EXERCISES_PER_LESSON = 6;
const VALID_TYPES = new Set([
  'multiple-choice', 'scenario', 'improve', 'fill-blank', 'compare', 'order', 'match'
]);
const LESSON_KEY = /^m\d+-\d+-\d+$/;

const problems = [];
const err = (loc, msg) => problems.push({ level: 'ERROR', loc, msg });
const warn = (loc, msg) => problems.push({ level: 'WARN', loc, msg });

function runFile(file, ctx) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.basename(file) });
}

function newCtx() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}

function loadReal() {
  const ctx = newCtx();
  const found = [];
  for (let n = 1; n <= TOTAL_MODULES; n++) {
    const f = path.join(JS, `game-data-m${n}.js`);
    if (!fs.existsSync(f)) continue;
    try {
      runFile(f, ctx);
    } catch (e) {
      err(`game-data-m${n}.js`, `file does not parse or throws: ${e.message}`);
      continue;
    }
    const mod = ctx[`GAME_MODULE_${n}`];
    if (!mod) { err(`game-data-m${n}.js`, `does not set window.GAME_MODULE_${n}`); continue; }
    if (mod.id !== n) err(`game-data-m${n}.js`, `module id is ${JSON.stringify(mod.id)}, expected ${n}`);
    found.push(mod);
  }
  return found;
}

function loadFixture() {
  const ctx = newCtx();
  runFile(FIXTURE, ctx);
  return Array.isArray(ctx.GAME_FIXTURE_MODULES) ? ctx.GAME_FIXTURE_MODULES : [];
}

// Known lesson keys from js/course-data.js, so a typo in lessonKey is caught.
function loadCourseKeys() {
  try {
    const src = fs.readFileSync(path.join(JS, 'course-data.js'), 'utf8');
    const MODULES = new Function(src + '\n;return typeof MODULES !== "undefined" ? MODULES : null;')();
    if (!Array.isArray(MODULES)) return null;
    const keys = new Set();
    MODULES.forEach((m, mi) => (m.weeks || []).forEach((w, wi) =>
      (w.days || w.lessons || []).forEach((_, di) => keys.add(`m${mi}-${wi}-${di}`))));
    return keys.size ? keys : null;
  } catch (e) {
    return null;
  }
}

function isPerm(arr, n) {
  if (!Array.isArray(arr) || arr.length !== n) return false;
  const seen = new Set(arr);
  if (seen.size !== n) return false;
  for (let i = 0; i < n; i++) if (!seen.has(i)) return false;
  return true;
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function checkWrongExplanations(ex, loc, optionCount) {
  const we = ex.wrongExplanations;
  if (we === undefined) { warn(loc, 'no wrongExplanations (generic feedback on a wrong pick)'); return; }
  if (!Array.isArray(we)) { err(loc, 'wrongExplanations must be an array'); return; }
  if (we.length !== optionCount) {
    err(loc, `wrongExplanations has ${we.length} entries, options has ${optionCount}`);
    return;
  }
  if (we[ex.correct] !== null) err(loc, `wrongExplanations[correct=${ex.correct}] must be null`);
  we.forEach((w, i) => {
    if (i !== ex.correct && !isText(w)) warn(loc, `wrongExplanations[${i}] is empty`);
  });
}

function validateExercise(ex, loc, isFixture, courseKeys) {
  if (!ex || typeof ex !== 'object') { err(loc, 'exercise is not an object'); return; }
  if (!VALID_TYPES.has(ex.type)) { err(loc, `unknown type ${JSON.stringify(ex.type)}`); return; }
  if (!isText(ex.question)) err(loc, 'missing question');
  if (!isText(ex.explanation)) warn(loc, 'missing explanation (shown after the answer)');

  if (['multiple-choice', 'scenario', 'improve', 'fill-blank'].includes(ex.type)) {
    if (!Array.isArray(ex.options) || ex.options.length !== 4) {
      err(loc, `options must be an array of exactly 4 (got ${Array.isArray(ex.options) ? ex.options.length : typeof ex.options})`);
    } else {
      ex.options.forEach((o, i) => { if (!isText(o)) err(loc, `options[${i}] is empty`); });
      if (new Set(ex.options).size !== ex.options.length) err(loc, 'options contains duplicates (the engine matches a word by its text)');
      if (!Number.isInteger(ex.correct) || ex.correct < 0 || ex.correct >= ex.options.length)
        err(loc, `correct index ${ex.correct} is out of range`);
      else checkWrongExplanations(ex, loc, ex.options.length);
    }
  }

  if (ex.type === 'scenario' && !isText(ex.context)) warn(loc, 'scenario has no context');
  if (ex.type === 'improve' && !isText(ex.original)) err(loc, 'improve has no original sentence');

  if (ex.type === 'fill-blank') {
    if (typeof ex.template !== 'string' || !ex.template.includes('___'))
      err(loc, 'fill-blank template has no "___" placeholder, the blank never renders');
    else if (ex.template.split('___').length !== 2)
      warn(loc, 'fill-blank template has more than one "___", only the first is filled');
  }

  if (ex.type === 'compare') {
    for (const k of ['optionA', 'optionB']) {
      if (!ex[k] || !isText(ex[k].text) || !isText(ex[k].label)) err(loc, `compare ${k} must be {label, text}`);
    }
    if (ex.correct !== 0 && ex.correct !== 1) err(loc, `compare correct must be 0 or 1 (got ${ex.correct})`);
    else checkWrongExplanations(ex, loc, 2);
  }

  if (ex.type === 'order') {
    if (!Array.isArray(ex.items) || ex.items.length < 2) err(loc, 'order items must be an array of 2 or more');
    else {
      ex.items.forEach((o, i) => { if (!isText(o)) err(loc, `items[${i}] is empty`); });
      if (!isPerm(ex.correctOrder, ex.items.length))
        err(loc, `correctOrder must be a permutation of 0..${ex.items.length - 1} (got ${JSON.stringify(ex.correctOrder)})`);
    }
  }

  if (ex.type === 'match') {
    if (!Array.isArray(ex.pairs) || ex.pairs.length < 2) err(loc, 'match pairs must be an array of 2 or more');
    else {
      ex.pairs.forEach((p, i) => {
        if (!p || !isText(p.left) || !isText(p.right)) err(loc, `pairs[${i}] must be {left, right} strings`);
      });
      const rights = ex.pairs.map(p => p && p.right);
      const lefts = ex.pairs.map(p => p && p.left);
      if (new Set(rights).size !== rights.length || new Set(lefts).size !== lefts.length)
        warn(loc, 'match has duplicate texts, a learner cannot tell the pairs apart');
    }
  }

  if (ex.type === 'order' || ex.type === 'match') {
    if (ex.wrongExplanations !== undefined &&
        !(Array.isArray(ex.wrongExplanations) && ex.wrongExplanations.length === 1 && ex.wrongExplanations[0] === null))
      warn(loc, 'wrongExplanations for order/match should be [null]');
  }

  // src: the quote shown in the feedback panel + the link back to the lesson.
  if (!ex.src || typeof ex.src !== 'object') {
    err(loc, 'missing src {quote, lessonKey}');
  } else {
    if (!isText(ex.src.quote)) err(loc, 'src.quote is empty');
    if (!isText(ex.src.lessonKey)) err(loc, 'src.lessonKey is empty');
    else if (!isFixture) {
      if (!LESSON_KEY.test(ex.src.lessonKey)) err(loc, `src.lessonKey "${ex.src.lessonKey}" is not m{module}-{week}-{day}`);
      else if (courseKeys && !courseKeys.has(ex.src.lessonKey)) err(loc, `src.lessonKey "${ex.src.lessonKey}" is not a lesson in js/course-data.js`);
    }
  }

  // House style: no em dashes in learner-facing copy.
  const texts = [ex.question, ex.explanation, ex.context, ex.original, ex.template,
    ...(ex.options || []), ...(ex.items || []), ...((ex.wrongExplanations || []).filter(Boolean))];
  if (texts.some(t => typeof t === 'string' && /[—–]/.test(t))) warn(loc, 'contains an em/en dash');
}

function validateModules(name, modules, isFixture, courseKeys) {
  const stats = { modules: 0, lessons: 0, exercises: 0, byType: {} };
  if (!Array.isArray(modules) || !modules.length) { err(name, 'no modules found'); return stats; }
  const seenKeys = new Map();

  modules.forEach((m, mi) => {
    if (!m) { err(`${name} module#${mi}`, 'module is null'); return; }
    stats.modules++;
    const mloc = `M${m.id ?? '?'}`;
    if (!Number.isInteger(m.id) || m.id < 1 || m.id > TOTAL_MODULES) err(mloc, `id must be 1..${TOTAL_MODULES}`);
    if (!Number.isInteger(m.moduleIdx) || m.moduleIdx < 0) err(mloc, 'moduleIdx must be a non-negative integer');
    else if (!isFixture && Number.isInteger(m.id) && m.moduleIdx !== m.id - 1) warn(mloc, `moduleIdx ${m.moduleIdx} is not id-1`);
    if (!isText(m.title)) err(mloc, 'missing title');
    if (!isText(m.description)) warn(mloc, 'missing description');
    if (!isText(m.icon) || !/^fa-/.test(m.icon)) warn(mloc, 'icon should be a Font Awesome class such as "fa-rocket"');
    if (m.image !== undefined && !isText(m.image)) warn(mloc, 'image is set but empty');
    if (!Array.isArray(m.lessons) || !m.lessons.length) { err(mloc, 'module has no lessons'); return; }

    m.lessons.forEach((l, li) => {
      stats.lessons++;
      const lloc = `${mloc} · lesson ${l && l.id !== undefined ? l.id : li + 1}`;
      if (!l || typeof l !== 'object') { err(lloc, 'lesson is not an object'); return; }
      if (l.id !== li + 1) err(lloc, `id must be the 1-based position (expected ${li + 1}, got ${JSON.stringify(l.id)})`);
      if (!isText(l.title)) err(lloc, 'missing title');

      if (!isText(l.lessonKey)) err(lloc, 'missing lessonKey');
      else {
        if (seenKeys.has(l.lessonKey)) err(lloc, `lessonKey "${l.lessonKey}" is already used by ${seenKeys.get(l.lessonKey)}`);
        seenKeys.set(l.lessonKey, lloc);
        if (!isFixture) {
          const mm = LESSON_KEY.exec(l.lessonKey);
          if (!mm) err(lloc, `lessonKey "${l.lessonKey}" is not m{module}-{week}-{day}`);
          else {
            if (Number.isInteger(m.moduleIdx) && !l.lessonKey.startsWith(`m${m.moduleIdx}-`))
              err(lloc, `lessonKey "${l.lessonKey}" does not belong to moduleIdx ${m.moduleIdx}`);
            if (courseKeys && !courseKeys.has(l.lessonKey)) err(lloc, `lessonKey "${l.lessonKey}" is not a lesson in js/course-data.js`);
          }
        }
      }

      const r = l.reading;
      if (!r || typeof r !== 'object') err(lloc, 'missing reading');
      else {
        if (!Array.isArray(r.paragraphs) || !r.paragraphs.length || !r.paragraphs.every(isText))
          err(lloc, 'reading.paragraphs must be a non-empty array of strings');
        if (r.keyTerms !== undefined) {
          if (!Array.isArray(r.keyTerms)) err(lloc, 'reading.keyTerms must be an array');
          else r.keyTerms.forEach((k, ki) => {
            if (!k || typeof k !== 'object' || !isText(k.term) || !isText(k.definition))
              err(lloc, `reading.keyTerms[${ki}] must be {term, definition}`);
            else if (Array.isArray(r.paragraphs) && !r.paragraphs.some(p => typeof p === 'string' && p.includes(k.term)))
              warn(lloc, `key term "${k.term}" does not appear word for word in the reading (it is reachable from the key-terms list only)`);
          });
        }
      }

      if (!Array.isArray(l.exercises) || !l.exercises.length) { err(lloc, 'lesson has no exercises'); return; }
      if (!isFixture && l.exercises.length !== EXERCISES_PER_LESSON)
        warn(lloc, `has ${l.exercises.length} exercises, expected ${EXERCISES_PER_LESSON}`);
      l.exercises.forEach((ex, ei) => {
        stats.exercises++;
        if (ex && ex.type) stats.byType[ex.type] = (stats.byType[ex.type] || 0) + 1;
        validateExercise(ex, `${lloc} · ex#${ei + 1}`, isFixture, courseKeys);
      });
    });
  });
  return stats;
}

function report(name, stats) {
  const errors = problems.filter(p => p.level === 'ERROR');
  const warns = problems.filter(p => p.level === 'WARN');
  console.log(`\n== ${name} ==`);
  console.log(`modules=${stats.modules}  lessons=${stats.lessons}  exercises=${stats.exercises}`);
  console.log('by type:', JSON.stringify(stats.byType));
  console.log(`ERRORS=${errors.length}  WARNINGS=${warns.length}`);
  if (errors.length) {
    console.log('\n--- ERRORS (break gameplay) ---');
    errors.forEach(p => console.log(`  x [${p.loc}] ${p.msg}`));
  }
  if (warns.length) {
    console.log('\n--- WARNINGS (quality) ---');
    warns.slice(0, 80).forEach(p => console.log(`  ! [${p.loc}] ${p.msg}`));
    if (warns.length > 80) console.log(`  ... +${warns.length - 80} more`);
  }
  if (!errors.length) console.log(`\nOK ${name}: no gameplay-breaking errors.`);
  return { errors: errors.length, warns: warns.length };
}

let failed = false;
function run(name, modules, isFixture, courseKeys) {
  const stats = validateModules(name, modules, isFixture, courseKeys);
  const r = report(name, stats);
  if (r.errors || (STRICT && r.warns)) failed = true;
  problems.length = 0;
}

if (args.has('--fixture')) {
  run('FIXTURE (tools/fixtures/game-data-fixture.js)', loadFixture(), true, null);
} else {
  const real = loadReal();
  if (real.length || problems.length) {
    const courseKeys = loadCourseKeys();
    if (!courseKeys) console.log('note: could not read lesson keys from js/course-data.js, key existence is not checked.');
    run('GAME DATA (js/game-data-m*.js)', real, false, courseKeys);
  } else {
    console.log('note: no js/game-data-m*.js file exists yet, validating the test fixture instead.');
    run('FIXTURE (tools/fixtures/game-data-fixture.js)', loadFixture(), true, null);
  }
}

process.exit(failed ? 1 : 0);
