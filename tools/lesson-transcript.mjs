#!/usr/bin/env node
// Prints the transcript of one lesson, or the lesson keys of a module.
//   node tools/lesson-transcript.mjs m1-0-2          the transcript text
//   node tools/lesson-transcript.mjs --keys 2        lesson keys of game module 2, grouped by week
//   node tools/lesson-transcript.mjs --find m1-0-2 "מילים לחיפוש"   lines of the transcript containing the words
// Source: kb-transcripts/module-N.md (same lookup as tools/check-game-levels.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(ROOT, ...p);
const MODULES = new Function('window', 'document', fs.readFileSync(rel('js', 'course-data.js'), 'utf8') +
  '\n;return (typeof MODULES !== "undefined") ? MODULES : window.MODULES;')({}, {});

function sections(mi) {
  const out = new Map();
  const file = rel('kb-transcripts', `module-${mi + 1}.md`);
  if (!fs.existsSync(file)) return out;
  const weeks = MODULES?.[mi]?.weeks || [];
  for (const part of fs.readFileSync(file, 'utf8').split(/^## +/m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = part.slice(0, nl).trim();
    const wi = weeks.findIndex(w => (w.title || '').trim() === heading.split('·')[0].trim());
    const dm = /יום\s+(\d+)/.exec(heading);
    if (wi >= 0) out.set(`m${mi}-${wi}-${dm ? +dm[1] - 1 : 0}`, part.slice(nl + 1).trim());
  }
  return out;
}
function gameKeys(n) {
  const win = {};
  new Function('window', fs.readFileSync(rel('js', `game-data-m${n}.js`), 'utf8'))(win);
  return win[`GAME_MODULE_${n}`].lessons.map(l => ({ key: l.lessonKey, title: l.title }));
}

const a = process.argv.slice(2);
if (a[0] === '--keys') {
  const byWeek = {};
  for (const l of gameKeys(Number(a[1]))) (byWeek[l.key.split('-')[1]] ||= []).push(l);
  for (const w of Object.keys(byWeek)) console.log(`week ${w}: ` + byWeek[w].map(l => `${l.key} (${l.title})`).join(' | '));
} else if (a[0] === '--find') {
  const mi = Number(/^m(\d+)-/.exec(a[1])[1]);
  const text = sections(mi).get(a[1]) || '';
  const needle = a.slice(2).join(' ');
  const flat = text.replace(/\s+/g, ' ');
  let i = -1, n = 0;
  while ((i = flat.indexOf(needle, i + 1)) !== -1 && n++ < 10) console.log('...' + flat.slice(Math.max(0, i - 120), i + needle.length + 160) + '...\n');
  if (!n) console.log('(not found)');
} else {
  const mi = Number(/^m(\d+)-/.exec(a[0] || '')?.[1]);
  const text = Number.isFinite(mi) ? sections(mi).get(a[0]) : null;
  if (!text) { console.error('no transcript for ' + a[0]); process.exit(1); }
  console.log(text);
}
