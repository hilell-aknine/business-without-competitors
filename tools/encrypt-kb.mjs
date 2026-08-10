// tools/encrypt-kb.mjs — encrypt every api/_kb/*.json into *.json.enc.
// Run after tools/split-kb.mjs. Requires KB_SECRET env (64 hex chars).
// The plaintext files stay on disk for local dev but are gitignored;
// only the .enc ciphertext is committed (the repo is public).
//
//   KB_SECRET=<hex64> node tools/encrypt-kb.mjs [--verify] [name ...]
//
// Passing names encrypts only those entries (e.g. `_search-index`). Without
// them every KB file is re-encrypted, which produces a fresh IV per file and
// therefore a 137-file diff — correct, but unreviewable. Prefer the filter.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { encryptKb, decryptKb } from '../api/_lib/kb.js';

const KB_DIR = path.join(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))), 'api', '_kb');

const only = process.argv.slice(2).filter(a => !a.startsWith('--'));

let n = 0;
for (const f of fs.readdirSync(KB_DIR)) {
  if (!f.endsWith('.json') || f === '_index.json') continue;
  if (only.length && !only.includes(f.replace(/\.json$/, ''))) continue;
  const plain = fs.readFileSync(path.join(KB_DIR, f), 'utf8');
  const enc = encryptKb(plain);
  fs.writeFileSync(path.join(KB_DIR, f + '.enc'), enc, 'utf8');
  if (process.argv.includes('--verify') && decryptKb(enc) !== plain) {
    throw new Error(`roundtrip mismatch: ${f}`);
  }
  n++;
}
console.log(`encrypted ${n} KB files -> *.json.enc (verified roundtrip: ${process.argv.includes('--verify')})`);
