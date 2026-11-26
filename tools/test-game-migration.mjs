#!/usr/bin/env node
// Runs migrations 013 + 014 + 016 on an in-memory Postgres (PGlite) and checks
// what 016 promises. Nothing here touches a real database.
//
//   node tools/test-game-migration.mjs [dir-with-node_modules]
//
// PGlite is NOT a dependency of this repo. Install it once in a scratch
// folder outside the repo and point the test at it (argument or PGLITE_DIR;
// the default is <os tmp>/bnc-pglite):
//   mkdir %TEMP%\bnc-pglite && cd %TEMP%\bnc-pglite && npm init -y && npm i @electric-sql/pglite
//
// The Supabase parts the migrations lean on are stubbed: roles anon /
// authenticated, auth.users, auth.uid() (reads a session setting), profiles,
// is_admin(), and Supabase's habit of granting everything on new public
// objects to both roles. That last stub matters: it makes the test fail if
// 016 forgets a REVOKE.
//
// Three orders are tested, because 014 has not been run in production yet:
//   A  014 then 016        B  016 alone        C  016 then 014

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIG = (n) => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', n), 'utf8');
const dir = process.argv[2] || process.env.PGLITE_DIR || path.join(os.tmpdir(), 'bnc-pglite');
const entry = path.join(dir, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
if (!fs.existsSync(entry)) {
  console.error(`PGlite not found at ${entry}\nInstall it outside the repo (see the header of this file).`);
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(entry).href);

const STUB = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Supabase default privileges: new tables and functions are open to both roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE FUNCTION public.is_admin(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const U3 = '33333333-3333-3333-3333-333333333333';
const ROUND = JSON.stringify([{ type: 'multiple-choice', n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}`); }
}

async function fresh(migrations) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const u of [U1, U2, U3]) {
    await db.query('INSERT INTO auth.users VALUES ($1)', [u]);
    await db.query('INSERT INTO public.profiles VALUES ($1)', [u]);
  }
  for (const m of migrations) await db.exec(MIG(m));
  return db;
}

// Runs one statement as a role with a JWT subject, like PostgREST does.
async function as(db, role, uid, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid || ''}', false); SET ROLE ${role};`);
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (err) {
    return { error: err.message, code: err.code };
  } finally {
    await db.exec('RESET ROLE;');
  }
}
const val = (r) => (r.rows && r.rows[0] ? Object.values(r.rows[0])[0] : undefined);

async function suite(name, migrations, has014) {
  console.log(`\n${name}: ${migrations.join(' -> ')}`);
  const db = await fresh(migrations);
  const L = (m) => `[${name}] ${m}`;

  // ---- levels column
  const col = await db.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='game_players' AND column_name='levels'`);
  ok(col.rows.length === 1 && col.rows[0].data_type === 'jsonb' && col.rows[0].is_nullable === 'NO', L('levels column is jsonb not null'));
  await as(db, 'authenticated', U1, 'INSERT INTO public.game_players (user_id) VALUES ($1)', [U1]);
  const lv = await as(db, 'authenticated', U1, 'SELECT levels FROM public.game_players WHERE user_id = $1', [U1]);
  ok(lv.rows && JSON.stringify(lv.rows[0].levels) === '{}', L('levels defaults to {}'));
  const up = await as(db, 'authenticated', U1, `UPDATE public.game_players SET levels = '{"m0-0-0":{"l2":true}}' WHERE user_id = $1`, [U1]);
  ok(up.affected === 1, L('owner can update levels'));

  // ---- caps for the new kinds
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(val(await as(db, 'authenticated', U1, `SELECT public.game_consume('game_hint', 3)`)));
  ok(JSON.stringify(seen) === '[2,1,0,-1,-1]', L(`game_hint counts 2,1,0 then stops at -1 (got ${JSON.stringify(seen)})`));
  ok(val(await as(db, 'authenticated', U1, `SELECT public.game_consume('game_judge', 30)`)) === 29, L('game_judge has its own counter'));
  ok(val(await as(db, 'authenticated', U2, `SELECT public.game_consume('game_hint', 3)`)) === 2, L('another learner has a separate counter'));
  const row = await db.query(`SELECT count FROM public.sandbox_usage WHERE user_id = $1 AND kind = 'game_hint'`, [U1]);
  ok(row.rows[0].count === 3, L('the counter is not raised past the cap'));

  // ---- the learner cannot reset the counter
  const del = await as(db, 'authenticated', U1, `DELETE FROM public.sandbox_usage WHERE user_id = $1`, [U1]);
  ok(!!del.error || del.affected === 0, L('learner cannot delete the usage row'));
  const upd = await as(db, 'authenticated', U1, `UPDATE public.sandbox_usage SET count = 0 WHERE user_id = $1`, [U1]);
  ok(!!upd.error || upd.affected === 0, L('learner cannot update the usage row'));
  const ins = await as(db, 'authenticated', U1, `INSERT INTO public.sandbox_usage (user_id, day, kind, count) VALUES ($1, current_date + 1, 'game_hint', 0)`, [U1]);
  ok(!!ins.error, L('learner cannot insert a usage row'));
  ok(val(await as(db, 'authenticated', U1, `SELECT public.game_consume('game_hint', 3)`)) === -1, L('still at the cap after the reset attempts'));
  const own = await as(db, 'authenticated', U1, `SELECT count(*)::int FROM public.sandbox_usage`);
  ok(val(own) === 2, L('learner reads only the own usage rows'));

  // ---- argument checks and anon
  ok(!!(await as(db, 'authenticated', U1, `SELECT public.game_consume('sandbox', 40)`)).error, L('game_consume rejects a kind that is not a game kind'));
  ok(!!(await as(db, 'authenticated', U1, `SELECT public.game_consume('game_hint', 0)`)).error, L('game_consume rejects cap 0'));
  ok(!!(await as(db, 'authenticated', '', `SELECT public.game_consume('game_hint', 3)`)).error, L('game_consume needs a signed-in user'));
  for (const call of [`public.game_consume('game_hint', 3)`, `public.game_surprise_get('m0-0-0')`, `public.game_surprise_put('m0-0-0', '${ROUND}'::jsonb)`]) {
    const r = await as(db, 'anon', U1, `SELECT ${call}`);
    ok(!!r.error && /permission denied/i.test(r.error), L(`anon cannot execute ${call.split('(')[0]}`));
  }

  // ---- 014's own function keeps its behaviour
  if (has014) {
    ok(val(await as(db, 'authenticated', U1, `SELECT public.sandbox_consume('sandbox', 40)`)) === 39, L('014 sandbox_consume still counts sandbox'));
    ok(val(await as(db, 'authenticated', U1, `SELECT public.sandbox_consume('transcribe', 1)`)) === 0, L('014 sandbox_consume still counts transcribe'));
    ok(val(await as(db, 'authenticated', U1, `SELECT public.sandbox_consume('transcribe', 1)`)) === -1, L('014 sandbox_consume still stops at the cap'));
    ok(!!(await as(db, 'authenticated', U1, `SELECT public.sandbox_consume('nope', 5)`)).error, L('014 sandbox_consume still rejects unknown kinds'));
  }
  const badKind = await db.query(`INSERT INTO public.sandbox_usage VALUES ($1, current_date, 'nope', 0)`, [U1]).then(() => null, e => e);
  ok(!!badKind, L('the kind check still rejects unknown kinds'));

  // ---- RLS on the cache table
  const sel = await as(db, 'authenticated', U1, `SELECT * FROM public.game_surprise_rounds`);
  ok(!!sel.error && /permission denied/i.test(sel.error), L('direct select on game_surprise_rounds is denied'));
  const dins = await as(db, 'authenticated', U1, `INSERT INTO public.game_surprise_rounds (lesson_key, exercises, created_by) VALUES ('m0-0-0', '${ROUND}'::jsonb, $1)`, [U1]);
  ok(!!dins.error, L('direct insert on game_surprise_rounds is denied'));
  const asel = await as(db, 'anon', '', `SELECT * FROM public.game_surprise_rounds`);
  ok(!!asel.error, L('anon select on game_surprise_rounds is denied'));
  // Even with the table grants given back, RLS without a policy shows nothing.
  await db.exec('GRANT SELECT, INSERT ON public.game_surprise_rounds TO authenticated;');
  await db.query(`INSERT INTO public.game_surprise_rounds (lesson_key, exercises) VALUES ('zz', '${ROUND}'::jsonb)`);
  ok(val(await as(db, 'authenticated', U1, `SELECT count(*)::int FROM public.game_surprise_rounds`)) === 0, L('RLS hides every row even with a table grant'));
  ok(!!(await as(db, 'authenticated', U1, `INSERT INTO public.game_surprise_rounds (lesson_key, exercises, created_by) VALUES ('m0-0-0', '${ROUND}'::jsonb, $1)`, [U1])).error, L('RLS blocks an insert even with a table grant'));
  await db.exec(`REVOKE ALL ON public.game_surprise_rounds FROM authenticated; DELETE FROM public.game_surprise_rounds;`);

  // ---- put / get round trip
  const empty = val(await as(db, 'authenticated', U1, `SELECT public.game_surprise_get('m0-0-0')`));
  ok(empty && empty.count === 0 && empty.exercises === null, L('get on an empty lesson returns count 0 and null'));
  ok(val(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-0-0', $1::jsonb)`, [ROUND])) === true, L('put stores a round'));
  const got = val(await as(db, 'authenticated', U2, `SELECT public.game_surprise_get('m0-0-0')`));
  ok(got && got.count === 1 && got.exercises.length === 4 && got.exercises[0].type === 'multiple-choice' &&
    got.exercises.map(e => e.n).join() === '1,2,3,4', L('another learner gets the stored round back'));
  const author = await db.query(`SELECT created_by FROM public.game_surprise_rounds`);
  ok(author.rows[0].created_by === U1, L('the row is written for auth.uid()'));

  // ---- validation of p_exercises
  const bad = [
    ['an object', '{"a":1}'],
    ['3 items', '[{},{},{}]'],
    ['7 items', '[{},{},{},{},{},{},{}]'],
    ['a non-object item', '[{},{},{},1]'],
    ['a string', '"x"'],
  ];
  for (const [what, json] of bad) {
    ok(!!(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-0-0', $1::jsonb)`, [json])).error, L(`put rejects ${what}`));
  }
  ok(!!(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('bad key!', $1::jsonb)`, [ROUND])).error, L('put rejects a bad lesson key'));
  ok(!!(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-0-0', NULL)`)).error, L('put rejects null'));
  ok(!!(await as(db, 'authenticated', '', `SELECT public.game_surprise_put('m0-0-0', $1::jsonb)`, [ROUND])).error, L('put needs a signed-in user'));

  // ---- 12 rounds per lesson
  const perLesson = [];
  for (let i = 0; i < 12; i++) perLesson.push(val(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-0-0', $1::jsonb)`, [ROUND])));
  ok(perLesson.slice(0, 11).every(v => v === true) && perLesson[11] === false, L('the 13th round of a lesson is refused (12 kept)'));
  ok(val(await as(db, 'authenticated', U2, `SELECT public.game_surprise_put('m0-0-0', $1::jsonb)`, [ROUND])) === false, L('the lesson limit holds for another learner too'));
  ok(val(await as(db, 'authenticated', U2, `SELECT public.game_surprise_get('m0-0-0')`)).count === 12, L('get reports 12'));

  // ---- 20 inserts per learner per day (U1 has 12 so far)
  const perDay = [];
  for (let i = 0; i < 9; i++) perDay.push(val(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-1-0', $1::jsonb)`, [ROUND])));
  ok(perDay.slice(0, 8).every(v => v === true) && perDay[8] === false, L('the 21st insert of a learner in one day is refused'));
  ok(val(await as(db, 'authenticated', U2, `SELECT public.game_surprise_put('m0-1-0', $1::jsonb)`, [ROUND])) === true, L('another learner can still insert'));
  await db.exec(`UPDATE public.game_surprise_rounds SET created_at = now() - interval '2 days' WHERE created_by = '${U1}'`);
  ok(val(await as(db, 'authenticated', U1, `SELECT public.game_surprise_put('m0-2-0', $1::jsonb)`, [ROUND])) === true, L('the daily limit resets on a new day'));

  // ---- random pick: with several different rounds, more than one comes back
  for (const n of [1, 2, 3]) {
    await as(db, 'authenticated', U3, `SELECT public.game_surprise_put('m1-0-0', $1::jsonb)`, [JSON.stringify([{ id: n }, {}, {}, {}])]);
  }
  const ids = new Set();
  for (let i = 0; i < 40; i++) ids.add(val(await as(db, 'authenticated', U3, `SELECT public.game_surprise_get('m1-0-0')`)).exercises[0].id);
  ok(ids.size >= 2, L(`get picks at random (saw ${ids.size} of 3 rounds in 40 calls)`));

  // ---- deleting a user is not blocked by the cache
  const gone = await db.query(`DELETE FROM auth.users WHERE id = $1`, [U3]).then(() => null, e => e);
  ok(!gone, L('a user with cached rounds can be deleted'));

  // ---- idempotent
  const again = await db.exec(MIG('016_game_levels.sql')).then(() => null, e => e);
  ok(!again, L(`016 can be run twice${again ? ` (${again.message})` : ''}`));
  ok(val(await as(db, 'authenticated', U2, `SELECT public.game_consume('game_hint', 3)`)) === 1, L('counters survive a second run'));
  const pol = await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='game_surprise_rounds'`);
  ok(pol.rows[0].n === 0, L('game_surprise_rounds has no policy'));
  const fn = await db.query(`SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname IN ('game_consume','game_surprise_get','game_surprise_put')`);
  ok(fn.rows.length === 3 && fn.rows.every(f => f.prosecdef && (f.proconfig || []).some(c => /^search_path=/.test(c))), L('the three functions are SECURITY DEFINER with a fixed search_path'));

  await db.close();
}

await suite('A', ['013_game_players.sql', '014_sandbox.sql', '016_game_levels.sql'], true);
await suite('B', ['013_game_players.sql', '016_game_levels.sql'], false);
await suite('C', ['013_game_players.sql', '016_game_levels.sql', '014_sandbox.sql'], true);

console.log(`\npassed: ${pass} · failed: ${fail}`);
console.log(`RESULT: ${fail ? 'FAIL' : 'PASS'}`);
process.exit(fail ? 1 : 0);
