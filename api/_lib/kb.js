// Server-side KB loader with at-rest encryption.
//
// WHY ENCRYPTED (2026-08-02): the GitHub repo is PUBLIC. Anything committed
// is readable in the repo browser regardless of .vercelignore or Jekyll
// underscore rules. The course transcripts are Ram & Zvika's property, so
// they are committed ONLY as AES-256-GCM ciphertext (api/_kb/*.json.enc).
// The key lives in the KB_SECRET env var (Vercel project settings + local
// dev shell), never in the repo.
//
// File format: base64( 12-byte IV || 16-byte GCM tag || ciphertext )
// Plaintext *.json files, when present locally, take precedence (dev mode);
// they are gitignored and never reach the public repo.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const KB_DIR = path.join(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))), '_kb');

function key() {
  const hex = process.env.KB_SECRET || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

export function decryptKb(b64) {
  const k = key();
  if (!k) throw new Error('KB_SECRET missing or malformed');
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

export function encryptKb(plaintext) {
  const k = key();
  if (!k) throw new Error('KB_SECRET missing or malformed');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

// Returns the parsed KB object for a name like "m0-0-0" or "apply-m3",
// or null when the entry doesn't exist / can't be read.
export function loadKb(name) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return null;
  try {
    const plain = path.join(KB_DIR, `${name}.json`);
    if (fs.existsSync(plain)) return JSON.parse(fs.readFileSync(plain, 'utf8'));
    const enc = path.join(KB_DIR, `${name}.json.enc`);
    if (fs.existsSync(enc)) return JSON.parse(decryptKb(fs.readFileSync(enc, 'utf8')));
    return null;
  } catch (err) {
    console.error(`[kb] load failed for ${name}: ${err.message}`);
    return null;
  }
}
