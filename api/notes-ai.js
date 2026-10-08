// מסמכים חיים — שני שירותי AI להערות של הלומד.
//
// Added 2026-10-08 at Hillel's request: notes used to be one textarea per
// lesson, but what a learner really builds is a handful of documents that grow
// across the whole course ("customer LTV", "avatar", "value proposition").
//
//   POST { action: 'suggest', note: { body, lessonTitle }, docs: [{ id, title, sample? }] }
//     -> { ok, suggestion: { type: 'existing', docId, title }
//                        | { type: 'new', title }
//                        | { type: 'none' }, reason, providerUsed }
//     Proposes ONE home for a note. It never assigns anything: the client
//     shows the proposal and the learner confirms or changes it.
//
//   POST { action: 'draft', title, notes: [{ lesson, time?, body }] }
//     -> { ok, draft, providerUsed }
//     Turns a document's raw notes into one clean, copyable draft, built only
//     from the learner's own words.
//
// Auth: Supabase JWT required, plus the same origin allowlist + per-IP rate
// limit as every other endpoint (_lib/guard.js). The notes themselves are not
// stored here; the server is stateless and keeps nothing.

import { callAI } from './_lib/providers.js';
import { passesGuard, requireAuth } from './_lib/guard.js';

const MAX_NOTE_CHARS = 4000;
const MAX_DOCS = 60;
const MAX_TITLE_CHARS = 80;
const MAX_SAMPLE_CHARS = 160;
const MAX_DRAFT_NOTES = 120;
const MAX_DRAFT_CHARS = 30000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

// The model is asked for bare JSON, but may wrap it in prose or a code fence.
function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// No em dashes in anything the learner reads (house style).
// An en dash is usually a range ("3–5"), so it becomes a plain hyphen.
const noEmDash = (s) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/–/g, '-');

const SUGGEST_SYSTEM = [
  'אתה ממיין הערות של לומד בקורס עסקי "עסק ללא מתחרים" למסמכים חיים לפי נושא.',
  'מסמך חי הוא נושא עסקי שהלומד בונה לאורך הקורס, למשל "לקוח LTV", "אווטאר", "הצעת ערך", "תמחור".',
  'תקבל הערה אחת, את שם השיעור שבו נכתבה, ואת רשימת המסמכים הקיימים של הלומד (מזהה, כותרת, ולפעמים קטע מהערה שכבר שויכה).',
  '',
  'החלט על בית אחד להערה:',
  '1. אם ההערה שייכת בבירור לנושא של מסמך קיים, החזר את המזהה שלו.',
  '2. אחרת, אם ההערה עוסקת בנושא עסקי מוגדר שאין לו מסמך, הצע כותרת חדשה קצרה (2 עד 4 מילים, בעברית, בלי מרכאות ובלי סימני פיסוק).',
  '3. אם ההערה כללית מדי, אישית, או לא עוסקת בנושא עסקי (למשל "לחזור לזה", "שיעור מעולה"), אל תציע כלום.',
  'העדף מסמך קיים על פני פתיחת מסמך חדש כשהנושא קרוב. אל תמציא נושא שלא מופיע בהערה.',
  '',
  'החזר JSON בלבד, בלי טקסט נוסף, במבנה:',
  '{"match": "<מזהה מסמך קיים או null>", "new_title": "<כותרת חדשה או null>", "reason": "<משפט קצר בעברית: למה>"}',
  'לכל היותר אחד מהשדות match ו-new_title מלא.',
].join('\n');

async function suggest(body, res) {
  const note = body.note || {};
  const text = clean(note.body, MAX_NOTE_CHARS);
  if (!text) {
    res.status(400).json({ ok: false, reason: 'empty_note' });
    return;
  }
  const lessonTitle = clean(note.lessonTitle, 160);
  const docs = (Array.isArray(body.docs) ? body.docs : [])
    .filter((d) => d && UUID_RE.test(String(d.id || '')) && clean(d.title, MAX_TITLE_CHARS))
    .slice(0, MAX_DOCS)
    .map((d) => ({ id: String(d.id), title: clean(d.title, MAX_TITLE_CHARS), sample: clean(d.sample, MAX_SAMPLE_CHARS) }));

  const docList = docs.length
    ? docs.map((d) => `- ${d.id} | ${d.title}${d.sample ? ` | לדוגמה: "${d.sample}"` : ''}`).join('\n')
    : '(אין עדיין מסמכים)';

  const user = [
    `שיעור: ${lessonTitle || 'לא ידוע'}`,
    '',
    'ההערה:',
    text,
    '',
    'המסמכים הקיימים:',
    docList,
  ].join('\n');

  const result = await callAI(SUGGEST_SYSTEM, user);
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }
  const parsed = extractJson(result.text) || {};
  const reason = noEmDash(clean(parsed.reason, 200));

  // Only trust an id we actually sent. A hallucinated id becomes "none".
  const match = docs.find((d) => d.id === String(parsed.match || ''));
  let suggestion = { type: 'none' };
  if (match) {
    suggestion = { type: 'existing', docId: match.id, title: match.title };
  } else {
    const title = noEmDash(clean(parsed.new_title, 60)).replace(/^["'״׳]+|["'״׳.]+$/g, '').trim();
    if (title && title.toLowerCase() !== 'null') {
      // The model sometimes "invents" a title that already exists verbatim.
      const same = docs.find((d) => d.title.trim() === title);
      suggestion = same ? { type: 'existing', docId: same.id, title: same.title } : { type: 'new', title };
    }
  }

  res.status(200).json({ ok: true, suggestion, reason, providerUsed: result.providerUsed });
}

const DRAFT_SYSTEM = [
  'אתה עורך שמסדר את ההערות של לומד בקורס עסקי למסמך עבודה אחד, נקי וקריא.',
  'החומר היחיד שלך הוא ההערות שהלומד כתב בעצמו לאורך כמה שיעורים. זה המסמך שלו, לא שלך.',
  '',
  'חוקים:',
  '- אל תוסיף עובדות, מספרים, דוגמאות או עצות שלא מופיעים בהערות. אם משהו חסר, כתוב "טרם הוגדר" ולא תמלא בעצמך.',
  '- אל תכתוב משפטי פתיחה, הסבר, הקשר או מעבר משלך. כל משפט במסמך חייב להישען על משפט מההערות.',
  '- השורות שמתחילות ב"מקור:" הן רק שם השיעור והדקה. הן לא תוכן: אל תהפוך אותן לכותרות פרקים ואל תסיק מהן דבר. השתמש בהן רק לרשימת המקורות.',
  '- שמור על הניסוח של הלומד ככל האפשר. מותר לאחד כפילויות, לתקן שגיאות כתיב ולסדר לפי נושאי משנה.',
  '- מבנה: כותרת ראשית עם שם המסמך, ואחריה פרקים קצרים לפי נושאי משנה שעולים מתוכן ההערות עצמן.',
  '- בסוף: "שאלות פתוחות" עם מה שנראה לא סגור בהערות, אם יש. ואחריו "מקורות" עם רשימת השיעורים שמהם נאסף החומר.',
  '- Markdown פשוט: כותרות # ו-##, רשימות עם -. בלי טבלאות.',
  '- עברית, בלי מקף ארוך.',
].join('\n');

async function draft(body, res) {
  const title = clean(body.title, MAX_TITLE_CHARS);
  const notes = (Array.isArray(body.notes) ? body.notes : [])
    .slice(0, MAX_DRAFT_NOTES)
    .map((n) => ({
      lesson: clean(n && n.lesson, 160),
      time: clean(n && n.time, 12),
      body: String((n && n.body) || '').trim().slice(0, MAX_NOTE_CHARS),
    }))
    .filter((n) => n.body);

  if (!title || !notes.length) {
    res.status(400).json({ ok: false, reason: 'nothing_to_draft' });
    return;
  }

  let used = 0;
  const parts = [];
  for (const n of notes) {
    const block = `מקור: ${n.lesson || 'שיעור'}${n.time ? ` (${n.time})` : ''}\n${n.body}`;
    if (used + block.length > MAX_DRAFT_CHARS) break;
    used += block.length;
    parts.push(block);
  }

  const user = `שם המסמך: ${title}\n\nההערות של הלומד, לפי סדר הקורס:\n\n${parts.join('\n\n---\n\n')}`;
  const result = await callAI(DRAFT_SYSTEM, user);
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }
  res.status(200).json({
    ok: true,
    draft: noEmDash(result.text.trim()),
    truncated: parts.length < notes.length,
    providerUsed: result.providerUsed,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }
  if (!passesGuard(req, res)) return;
  if (!(await requireAuth(req, res))) return;

  const body = await readJsonBody(req);
  if (body.action === 'suggest') return suggest(body, res);
  if (body.action === 'draft') return draft(body, res);
  res.status(400).json({ ok: false, reason: 'unknown_action' });
}
