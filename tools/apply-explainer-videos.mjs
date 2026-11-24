#!/usr/bin/env node
// Swap the removed original lesson videos for the NotebookLM explainer videos.
// usage: node tools/apply-explainer-videos.mjs <workdir with jobs.json + uploaded.json> [--dry]
// Rerunnable: lessons already swapped are skipped. The original id is kept as
// `origVideoId` next to the new one, so a swap can be undone by hand.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const [W, flag] = process.argv.slice(2);
if (!W) { console.error('usage: apply-explainer-videos.mjs <workdir> [--dry]'); process.exit(1); }
const dry = flag === '--dry';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const jobs = read(path.join(W, 'jobs.json'));
const uploaded = read(path.join(W, 'uploaded.json'));

const FILE = new URL('../js/course-data.js', import.meta.url);
let src = fs.readFileSync(FILE, 'utf8');
const ctx = {};
vm.runInNewContext(src + '\nthis.MODULES = MODULES;', ctx);

let swapped = 0, skipped = 0;
const problems = [];
for (const job of jobs) {
  const up = uploaded[String(job.n)];
  if (!up || !up.vid) continue;
  const m = /^m(\d+)-(\d+)-(\d+)$/.exec(job.key);
  const day = m && ctx.MODULES[+m[1]]?.weeks[+m[2]]?.days[+m[3]];
  if (!day) { problems.push(`${job.key}: no such lesson`); continue; }
  if (day.videoId === up.vid) { skipped++; continue; }
  const old = day.videoId;
  if (!old) { problems.push(`${job.key}: lesson has no videoId`); continue; }
  const needle = `videoId: '${old}'`;
  const lines = src.split('\n');
  const hits = lines.map((l, i) => (l.includes(needle) ? i : -1)).filter((i) => i >= 0);
  // The lesson itself carries no key; any other line using the same id must be a
  // track entry for this very lesson (e.g. Tamar's leadership track), or we stop.
  const keyed = hits.filter((i) => lines[i].includes(`key: '${job.key}'`));
  if (hits.length - keyed.length !== 1) {
    problems.push(`${job.key}: '${old}' found ${hits.length} times (${keyed.length} keyed), not swapped`);
    continue;
  }
  for (const i of hits) lines[i] = lines[i].replace(needle, `videoId: '${up.vid}', origVideoId: '${old}'`);
  src = lines.join('\n');
  swapped++;
  console.log(`${job.key}  ${old} -> ${up.vid}`);
}
if (!dry && swapped) fs.writeFileSync(FILE, src);
console.log(`\nswapped ${swapped}, already done ${skipped}${dry ? ' (dry run, nothing written)' : ''}`);
if (problems.length) { console.log('problems:\n  ' + problems.join('\n  ')); process.exitCode = 2; }
