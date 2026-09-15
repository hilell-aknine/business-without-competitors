/* ==========================================================================
   apply-lesson-titles.mjs — write the approved titles into js/course-data.js.

   Matching is done on videoId, not on position. course-data.js is hand-authored
   and full of comments; walking it by index would break the first time a lesson
   moves. Every videoId in the file is unique (asserted below), so each line is
   rewritten exactly once and nothing else in the file is touched.

   The original "יום N" label is kept as `seq` — it still carries the order of
   the week, which the descriptive title deliberately does not.

     node tools/apply-lesson-titles.mjs --dry     # report only
     node tools/apply-lesson-titles.mjs           # write
   ========================================================================== */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'js', 'course-data.js');
const PROP = path.join(ROOT, 'tools', 'lesson-titles.proposal.json');
const dry  = process.argv.includes('--dry');

/* ---- key -> videoId, straight from the data file itself ---- */
const src = fs.readFileSync(DATA, 'utf8');
globalThis.window = {};
new Function(src + '\nglobalThis.__M = typeof MODULES !== "undefined" ? MODULES : [];')();
const MODULES = globalThis.__M;

const byKey = {};
const videoIdCount = {};
MODULES.forEach((mod, mi) => (mod.weeks || []).forEach((w, wi) => (w.days || []).forEach((d, di) => {
  if (!d.videoId) return;
  byKey[`m${mi}-${wi}-${di}`] = { videoId: d.videoId, oldTitle: d.title };
  videoIdCount[d.videoId] = (videoIdCount[d.videoId] || 0) + 1;
})));

const dupIds = Object.entries(videoIdCount).filter(([, n]) => n > 1);
if (dupIds.length) {
  console.error('ABORT: videoId is not unique, cannot match safely:', dupIds.map(([id]) => id).join(', '));
  process.exit(1);
}

const proposal = JSON.parse(fs.readFileSync(PROP, 'utf8'));
let out = src, applied = 0, skipped = [], notFound = [];

for (const t of proposal.titles) {
  if (!t.suggested) continue;
  const entry = byKey[t.key];
  if (!entry) { notFound.push(t.key); continue; }

  // Only rewrite lessons still carrying a bare "יום N" label; anything already
  // given a real title by hand is left exactly as it is.
  if (!/^יום \d+$/.test(entry.oldTitle || '')) { skipped.push(t.key); continue; }

  /* Anchor on `title` + `videoId` only. Two lessons carry a `variants` array
     after the videoId, so requiring a closing brace here silently skipped them.
     videoId is unique across the file, so this pair identifies one lesson. */
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`title:\\s*'${esc(entry.oldTitle)}'\\s*,\\s*videoId:\\s*'${esc(entry.videoId)}'`);
  if (!re.test(out)) { notFound.push(t.key + ' (no literal match)'); continue; }

  const safeTitle = t.suggested.replace(/'/g, "\\'");
  out = out.replace(re, `title: '${safeTitle}', seq: '${entry.oldTitle}', videoId: '${entry.videoId}'`);
  applied++;
}

console.log(`lessons in file: ${Object.keys(byKey).length}`);
console.log(`titles applied : ${applied}`);
console.log(`already named  : ${skipped.length}`);
if (notFound.length) console.log(`NOT MATCHED    : ${notFound.length} -> ${notFound.join(', ')}`);

if (dry) { console.log('\n--dry: nothing written'); process.exit(0); }
if (notFound.length) { console.error('\nABORT: some lessons did not match; file left untouched.'); process.exit(1); }

/* Prove the rewrite did what it claims before overwriting anything. */
const before = (src.match(/title:\s*'יום \d+'/g) || []).length;
const after  = (out.match(/title:\s*'יום \d+'/g) || []).length;
const seqs   = (out.match(/seq:\s*'יום \d+'/g) || []).length;
console.log(`"יום N" as a title: ${before} -> ${after}   ·   preserved as seq: ${seqs}`);
if (after !== before - applied || seqs !== applied) {
  console.error('ABORT: the delta does not match the number of replacements.');
  process.exit(1);
}

fs.writeFileSync(DATA, out, 'utf8');
console.log(`\nwrote ${DATA}`);
