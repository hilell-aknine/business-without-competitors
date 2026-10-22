// עוזר היישום השבועי — the agent that turns watching into doing.
// Methodology: Project-100 workshops 2+3 — a structured interview over the
// five building blocks of a knowledge base, applied to the learner's OWN
// business task, framed by the module they just finished.
//
// Input:  POST { moduleIdx: 0-7, history: [{role,content}...], finalize?: bool }
// Output: { ok, reply, providerUsed, done }
// Auth:   Supabase JWT required.
//
// Iron rule from Project-100: the learner's knowledge is the source; the
// module transcript is only the frame. The coach never injects external
// know-how that contradicts the learner's own method.
//
// The conversation state lives on the client (localStorage) and is sent whole
// on every turn; the final document is saved by the client to the
// `application_docs` table (migration 005) under the learner's own RLS row.

import { callAI } from './_lib/providers.js';
import { passesGuard, requireAuth } from './_lib/guard.js';
import { loadKb } from './_lib/kb.js';

const MAX_TURNS = 40;
// 2026-10-22: 3,000 -> 10,000 per answer (the old cap silently cut long
// answers). The whole conversation is still bounded so one call can't grow
// without limit; the guard (origin + rate limit) and the JWT stay in front.
const MAX_TURN_CHARS = 10000;
const MAX_HISTORY_TOTAL_CHARS = 60000; // newest messages kept

function buildSystem(mod, finalize) {
  const base = [
    'אתה עוזר היישום של הקורס "עסק ללא מתחרים". תפקידך להפוך צפייה ליישום:',
    `הלומד סיים את מודול "${mod.title}", ואתה מלווה אותו לבנות מסמך יישום אישי לעסק שלו.`,
    '',
    'הקשר המודול (לשימושך בלבד, אל תצטט ממנו באריכות):',
    mod.description || '',
    '',
    'המבנה המחייב של הראיון — חמש אבני הבניין, שלב אחרי שלב:',
    '1. הגדרות בסיס — מה המשימה העסקית שהלומד רוצה ליישם מהמודול? מה המושגים, מי המעורבים, איפה זה קורה?',
    '2. עקרונות חשיבה — לפי מה הוא מקבל החלטות במשימה הזאת? על מה הוא לא מתפשר?',
    '3. מדדי תוצאה — איך יידע שהצליח? כאן אתה אוכף את כלל הספציפיות: אסור לקבל תשובה כללית כמו "לשפר מכירות" או "שיהיה טוב יותר". דחוף לתשובה מדידה: כמה, עד מתי, לפי איזה קריטריון.',
    '4. אתגרים נפוצים — מה משתבש כשהוא ממהר, עייף או מחפף? מה הפתרון לכל אתגר?',
    '5. דוגמה טובה ודוגמה רעה — אחת מכל סוג, ולמה. ההסבר "למה" חשוב מהדוגמה עצמה.',
    '',
    'חוקים:',
    '- שאלה אחת ממוקדת בכל תור. אל תציף.',
    '- הידע יוצא מהלומד, לא ממך. אל תציע לו שיטות חיצוניות ואל תמציא עובדות על העסק שלו.',
    '- אם תשובה כללית מדי — שקף לו את זה בעדינות ובקש דיוק ("מה זה אומר בפועל? תן דוגמה מהשבוע האחרון").',
    '- פתח את השיחה בהסבר קצר של התהליך ובשאלה הראשונה: איזו משימה מהמודול הוא רוצה ליישם בעסק.',
    '- עברית, טון חם וישיר, בלי מקף ארוך. תשובות קצרות.',
  ];
  if (finalize) {
    base.push(
      '',
      'הלומד ביקש לסכם עכשיו. הפק את "מסמך היישום האישי" המלא על בסיס כל מה שנאמר בשיחה בלבד:',
      'כותרת: מסמך יישום — [שם המשימה] · מודול ' + mod.title,
      'ואז חמישה פרקים לפי אבני הבניין, בפורמט Markdown נקי, כל פרק עם הנקודות שהלומד עצמו נתן (מנוסחות בבהירות).',
      'בסוף: "הצעד הבא שלך השבוע" — פעולה אחת קונקרטית שנגזרת ממה שנאמר.',
      'אם שלב מסוים לא כוסה בשיחה — כתוב בו "טרם הוגדר" במקום להמציא.'
    );
  }
  return base.join('\n');
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Keep the newest messages that fit in `budget` characters.
function trimHistory(msgs, budget) {
  const out = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    used += msgs[i].content.length;
    if (used > budget) break;
    out.unshift(msgs[i]);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }
  if (!passesGuard(req, res)) return;
  if (!(await requireAuth(req, res))) return;

  const body = await readJsonBody(req);
  const moduleIdx = Number(body.moduleIdx);
  if (!Number.isInteger(moduleIdx) || moduleIdx < 0 || moduleIdx > 7) {
    res.status(400).json({ ok: false, reason: 'bad_module' });
    return;
  }

  const mod = loadKb(`apply-m${moduleIdx}`);
  if (!mod) {
    res.status(500).json({ ok: false, reason: 'kb_read_failed' });
    return;
  }

  const finalize = body.finalize === true;
  const raw = Array.isArray(body.history)
    ? body.history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    : [];
  // The newest answer is never cut silently: too long is a clear 400.
  const newest = raw[raw.length - 1];
  if (!finalize && newest && newest.role === 'user' && newest.content.length > MAX_TURN_CHARS) {
    res.status(400).json({ ok: false, reason: 'answer_too_long', max: MAX_TURN_CHARS });
    return;
  }
  const history = trimHistory(
    raw.slice(-MAX_TURNS).map(m => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) })),
    MAX_HISTORY_TOTAL_CHARS
  );

  // The model expects the last message to be from the user.
  const messages = history.length ? [...history] : [{ role: 'user', content: 'שלום, אני מוכן להתחיל.' }];
  if (finalize) messages.push({ role: 'user', content: 'סיימנו. הפק עכשיו את מסמך היישום האישי המלא.' });
  else if (messages[messages.length - 1].role !== 'user') {
    res.status(400).json({ ok: false, reason: 'last_message_must_be_user' });
    return;
  }

  const result = await callAI(buildSystem(mod, finalize), messages);
  if (!result.text) {
    res.status(503).json({ ok: false, reason: 'all_providers_failed' });
    return;
  }

  res.status(200).json({ ok: true, reply: result.text, providerUsed: result.providerUsed, done: finalize });
}
