# Supabase — עסק ללא מתחרים

הגדרת בסיס הנתונים לפרויקט.

## פרטי הפרויקט

- **Project ref:** `hiosnmkszdktirpfzjqi`
- **URL:** `https://hiosnmkszdktirpfzjqi.supabase.co`
- **Dashboard:** https://supabase.com/dashboard/project/hiosnmkszdktirpfzjqi

## איך מפעילים את המיגרציה הראשונה (פעם אחת בלבד)

1. פותחים את ה-Dashboard בכתובת שלמעלה.
2. בתפריט שמאלי בוחרים **SQL Editor** → **+ New query**.
3. פותחים את הקובץ `supabase/migrations/001_initial_schema.sql` ומעתיקים את כל התוכן.
4. מדביקים בעורך, לוחצים **Run** (או `Ctrl+Enter`).
5. אמורות להופיע ההודעות `Success. No rows returned`.

### מה המיגרציה יוצרת
- **5 טבלאות:** `profiles`, `course_progress`, `user_notes`, `quiz_scores`, `practice_stats`.
- **RLS** (Row Level Security) מופעל על כל טבלה — כל משתמש רואה רק את עצמו; הערות אישיות לא נחשפות אפילו לאדמין.
- **טריגר** `on_auth_user_created` — בכל פעם שמשתמש נרשם דרך Supabase Auth, נוצרת לו אוטומטית שורה בטבלת `profiles`.
- **פונקציה** `touch_last_seen()` — להעדכון `last_seen_at` בכניסה לאתר (יקרא מה-JS בשלב 2).

## איך בודקים שזה עובד

לאחר הרצת המיגרציה:

1. פותחים בדפדפן את `supabase-test.html` שבשורש הפרויקט (file://, או לחיצה כפולה בסייר הקבצים).
2. הדף ירוץ אוטומטית 9 בדיקות ויראה אילו עברו ואילו לא.
3. כל 9 הבדיקות צריכות להיות ירוקות. במיוחד הבדיקה האחרונה (RLS) — היא וודאת שהאבטחה פועלת.

> הקובץ `supabase-test.html` מקומי בלבד — לא מועלה ל-Vercel/GitHub. אחרי שכל הבדיקות עוברות אפשר למחוק אותו.

## איך מגדירים אדמין (פעם אחת — אחרי שאתה נרשם בעצמך)

בשלב 2 כשתיבנה מערכת הרשמה — תירשם דרך הטופס באתר ברגיל. אחר כך פותחים את ה-Dashboard:
**Table Editor** → טבלת `profiles` → מאתרים את השורה שלך → משנים את העמודה `role` מ-`user` ל-`admin`.

## איך מוסיפים מיגרציה חדשה בעתיד

- שם הקובץ: `00X_short_description.sql` (מספר רץ + תיאור באנגלית).
- מומלץ לעטוף שינויים מסוכנים ב-`BEGIN; ... COMMIT;`.
- אם משתמשים ב-Supabase CLI: `npx supabase db push` (דורש `supabase login` + `supabase link --project-ref hiosnmkszdktirpfzjqi` חד-פעמי).

## מבנה הטבלאות (תקציר)

| טבלה | מטרה | מפתח |
|------|------|------|
| `profiles` | פרטי משתמש + תפקיד (user/admin) | `id` UUID = `auth.users.id` |
| `course_progress` | מי השלים איזה שיעור | `(user_id, lesson_key)` |
| `user_notes` | הערות פר-שיעור | `(user_id, lesson_key)` |
| `quiz_scores` | תוצאות 8 המבחנים | `(user_id, module_idx)` |
| `practice_stats` | XP, streak, אתגרים שהושלמו | `user_id` (שורה אחת לכל משתמש) |

## ביטחון — מה הציבור יכול לעשות עם anon key?

- ה-anon key מופיע בקוד הצד-לקוח (`js/supabase-config.js`). זה תקין — Supabase תוכננה ככה.
- בלי התחברות, כל ניסיון לקרוא/לכתוב יחזיר שגיאה כי RLS חוסם.
- אחרי התחברות, המשתמש רואה רק את השורות עם `user_id = auth.uid()`.
- אדמין רואה את כל ה-profiles + course_progress + quiz_scores + practice_stats. **לא** את `user_notes` (פרטיות).
