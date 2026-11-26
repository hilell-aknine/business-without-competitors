#!/usr/bin/env node
// Builds the level 2 / level 3 data files of a module from its part files.
//   node tools/assemble-game-levels.mjs 2 3      modules 2 and 3 (default: every module that has parts)
// Source: tools/levels-parts/m<N>-w<W>.json  { "l2": { key: [6 exercises] }, "l3": { key: [3 tasks] }, "rubric": { key: [3 rubrics] } }
// Output: js/game-data-l2-m<N>.js, js/game-data-l3-m<N>.js, api/_game/l3-m<N>.json
// Lessons are written in the order of js/game-data-m<N>.js. Module 1 was written by hand and has no parts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const dir = rel('tools', 'levels-parts');
const want = process.argv.slice(2).map(Number).filter(Boolean);
const mods = (want.length ? want : [2, 3, 4, 5, 6, 7, 8]).filter(n => fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.startsWith(`m${n}-w`) && f.endsWith('.json')));
let bad = 0;
for (const n of mods) {
  const win = {};
  new Function('window', fs.readFileSync(rel('js', `game-data-m${n}.js`), 'utf8'))(win);
  const keys = win[`GAME_MODULE_${n}`].lessons.map(l => l.lessonKey);
  const all = { l2: {}, l3: {}, rubric: {} };
  for (const f of fs.readdirSync(dir).filter(f => f.startsWith(`m${n}-w`) && f.endsWith('.json')).sort()) {
    let part;
    try { part = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { console.error(`FAIL ${f}: not valid JSON (${e.message})`); bad++; continue; }
    for (const k of ['l2', 'l3', 'rubric']) Object.assign(all[k], part[k] || {});
  }
  const pick = (src) => Object.fromEntries(keys.filter(k => src[k]).map(k => [k, src[k]]));
  const js = (name, head, obj) => `/* ${head} Built by tools/assemble-game-levels.mjs from tools/levels-parts/. Do not edit by hand. */\nwindow.${name} = ${JSON.stringify({ id: n, lessons: obj }, null, 2)};\n`;
  fs.writeFileSync(rel('js', `game-data-l2-m${n}.js`), js(`GAME_L2_${n}`, `Level 2 ("יישום") practice data, module ${n}.`, pick(all.l2)));
  fs.writeFileSync(rel('js', `game-data-l3-m${n}.js`), js(`GAME_L3_${n}`, `Level 3 ("שליטה") tasks, module ${n}. The rubric is in api/_game/l3-m${n}.json.`, pick(all.l3)));
  fs.mkdirSync(rel('api', '_game'), { recursive: true });
  fs.writeFileSync(rel('api', '_game', `l3-m${n}.json`), JSON.stringify(pick(all.rubric), null, 2) + '\n');
  console.log(`module ${n}: level 2 ${Object.keys(pick(all.l2)).length}/${keys.length} lessons · level 3 ${Object.keys(pick(all.l3)).length}/${keys.length} · rubric ${Object.keys(pick(all.rubric)).length}/${keys.length}`);
}
process.exit(bad ? 1 : 0);
