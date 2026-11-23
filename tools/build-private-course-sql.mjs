#!/usr/bin/env node
// Builds the seed SQL for one private course (migration 015) from a local
// lessons JSON that lives OUTSIDE this repo. The output carries the course
// content, so write it to a scratch folder and never commit it.
//
//   node tools/build-private-course-sql.mjs <lessons.json> <course-id> "<title>" \
//        [--vimeo <vimeo-catalog.json>] [--grant <user-uuid>] [--subtitle "<text>"] > seed.sql
//
// lessons.json shape: { stages:[{order,name,modules:[{order,name,lesson_orders}]}],
//                       lessons:[{order,stage_order,module_order,title,video_type,
//                                 video_id,content_status,summary,key_points,
//                                 practice_questions,workbook,tutor_grounding}] }
// vimeo catalog (optional): { videos:[{link:"https://vimeo.com/<id>/<hash>"}] }
// gives the unlisted-link hash the player needs (?h=). Nothing else is used.
//
// Idempotent: upserts by primary key, never deletes. Only private_* tables.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const vimeoPath = flag('--vimeo');
const grant = flag('--grant');
const subtitle = flag('--subtitle');
const [jsonPath, courseId, title] = args;
if (!jsonPath || !courseId || !title) {
  console.error('usage: build-private-course-sql.mjs <lessons.json> <course-id> "<title>" [--vimeo f] [--grant uuid] [--subtitle s]');
  process.exit(1);
}
if (!/^[a-z0-9-]{2,40}$/.test(courseId)) throw new Error('bad course id');
if (grant && !/^[0-9a-f-]{36}$/.test(grant)) throw new Error('bad grant uuid');

const src = JSON.parse(readFileSync(jsonPath, 'utf8'));
const hashes = {};
if (vimeoPath) {
  for (const v of JSON.parse(readFileSync(vimeoPath, 'utf8')).videos || []) {
    const m = String(v.link || '').match(/vimeo\.com\/(\d+)(?:\/([0-9a-f]+))?/);
    if (m && m[2]) hashes[m[1]] = m[2];
  }
}

// Dollar-quoting with a tag that cannot appear in the text.
const TAG = '$pc$';
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v);
  if (s.includes(TAG)) throw new Error('text contains the quote tag');
  return TAG + s + TAG;
}
const json = (v) => (v === null || v === undefined ? 'NULL' : lit(JSON.stringify(v)) + '::jsonb');

const structure = (src.stages || []).map((s) => ({
  ord: s.order,
  title: s.name,
  modules: (s.modules || []).map((m) => ({ ord: m.order, title: m.name, lessons: m.lesson_orders || [] })),
}));

const out = [];
out.push('BEGIN;');
out.push(
  `INSERT INTO public.private_courses (id, title, subtitle, structure) VALUES (${lit(courseId)}, ${lit(title)}, ${lit(subtitle)}, ${json(structure)})` +
  ' ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, structure = EXCLUDED.structure;'
);

const counts = { lessons: 0, ready: 0, pending: 0, youtube: 0, vimeo: 0, none: 0, unavailable: 0, vimeoNoHash: 0 };
for (const l of src.lessons || []) {
  let type = l.video_type;
  if (type !== 'youtube' && type !== 'vimeo' && type !== 'none') type = l.video_id ? 'unavailable' : 'none';
  const hash = type === 'vimeo' ? (hashes[l.video_id] || null) : null;
  if (type === 'vimeo' && !hash) counts.vimeoNoHash++;
  const status = l.content_status === 'ready' ? 'ready' : 'pending';
  counts.lessons++; counts[status]++; counts[type]++;
  out.push(
    'INSERT INTO public.private_course_lessons (course_id, ord, stage_ord, module_ord, title, video_type, video_id, video_hash, content_status, summary, key_points, practice_questions, workbook, tutor_grounding) VALUES (' +
    [lit(courseId), l.order | 0, l.stage_order | 0, l.module_order | 0, lit(l.title), lit(type),
      type === 'none' ? 'NULL' : lit(l.video_id), lit(hash), lit(status), lit(l.summary || null),
      json(l.key_points || []), json(l.practice_questions || []), json(l.workbook || null), lit(l.tutor_grounding || null)].join(', ') +
    ') ON CONFLICT (course_id, ord) DO UPDATE SET stage_ord = EXCLUDED.stage_ord, module_ord = EXCLUDED.module_ord, title = EXCLUDED.title,' +
    ' video_type = EXCLUDED.video_type, video_id = EXCLUDED.video_id, video_hash = EXCLUDED.video_hash, content_status = EXCLUDED.content_status,' +
    ' summary = EXCLUDED.summary, key_points = EXCLUDED.key_points, practice_questions = EXCLUDED.practice_questions,' +
    ' workbook = EXCLUDED.workbook, tutor_grounding = EXCLUDED.tutor_grounding;'
  );
}
if (grant) {
  out.push(`INSERT INTO public.private_course_access (course_id, user_id) VALUES (${lit(courseId)}, ${lit(grant)}::uuid) ON CONFLICT DO NOTHING;`);
}
out.push('COMMIT;');
process.stdout.write(out.join('\n') + '\n');
console.error(JSON.stringify(counts));
