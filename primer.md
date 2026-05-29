# Primer — עסק ללא מתחרים
> Last updated: 2026-05-29 by Claude Code

## Current State
- **Last task (2026-05-29, STAGED — not committed, not deployed, migration not run):** **Browser UX report follow-up — 4 bugs.** Hillel ran a browser QA pass and filed a 4-bug report. Diagnosed each from code (not guesswork):
  1. **Sync failure (HIGH)** — `[sync] partial failure ... Array(3)` looping every sign-in. **Root cause is NOT missing columns** (schema matches sync code exactly). All 3 sync tables FK-reference `public.profiles(id)`; the auto-profile trigger only fires on `auth.users` INSERT, so any user without a profiles row (OAuth / pre-trigger account) → FK violation `23503` on every upsert. The real error was swallowed by `console.warn(..., results)`. **Fixes:** (a) `js/sync-localstorage.js` now calls `ensure_profile` RPC before syncing and logs each failed table's `{code,message,details,hint}`; (b) new `supabase/migrations/003_ensure_profile_rpc.sql` — SECURITY DEFINER, idempotent, self-heals the profiles row. **⚠️ Migration 003 must be run manually in the Supabase SQL editor** (same flow as 001/002) before the fix takes effect.
  2. **131 vs 132 lesson count (MEDIUM)** — `index.html buildFlat()` counts `day.videoId` only (131 videos); `library.js` includes the AI-tool item (132). Both internally consistent, count different things. **Awaiting Hillel's decision** on how to reconcile (treat AI tool as a lesson or not) — NOT yet changed.
  3. **`selectLesson` TypeError (LOW)** — `course-data.js` used top-level `const MODULES` (lexical global, not `window.MODULES`). **Fixed:** exposed `window.MODULES`/`window.SEMINARS` + optional-chaining guard in `selectLesson`.
  4. **Mark-complete button state (LOW)** — button always showed "סמן כהושלם". **Fixed:** `updateLessonNav()` now toggles `.is-done` + label "הושלם" + gold style + `aria-pressed` when the current lesson is completed.
  - Files changed (staged, local): `js/sync-localstorage.js`, `js/course-data.js`, `index.html`, `supabase/migrations/003_ensure_profile_rpc.sql` (new). Syntax-checked with `node --check`.

- **Status:** **LIVE on Vercel** at `https://business-without-competitors.vercel.app` (also live on GitHub Pages at `https://hilell-aknine.github.io/business-without-competitors/`)
- **Last task completed (2026-05-25, second round — pending push):** **Fixed 9 QA findings from browser UX pass.** Hillel ran an interactive QA pass on the live site and produced a 9-bug report — different from the 6-agent code audit earlier that day. 4 parallel agents fixed all 9 across disjoint files in one session. Changes:
  1. **Bugs 3+4 (HIGH) — Sidebar drawer extended to <1100px** in `index.html`. The 768px breakpoint for `.v1-fabs` (FAB stack with `#sidebarToggle`) and `.v1-side` drawer rules was extended to 1100px. Removed the broken `.v1-side{position:static;max-height:480px;order:2}` rule that was making the sidebar fall below main content at 769-1100px. Drawer width: 360px on tablets, 320px on phones.
  2. **Bug 4 (HIGH) — Sidebar list scroll cue.** `.v1-side__list` scrollbar widened to 8px with gold thumb (`rgba(230,198,90,.35)` → `.6` on hover), Firefox `scrollbar-color` added. New `.v1-side::after` bottom-fade gradient (36px) signals "more content below". `#sideList` got `tabindex="0"` + `aria-label`.
  3. **Bugs 1+5 (MEDIUM) — Deep link now opens player.** New `showPlayerNoAutoplay()` helper inside `index.html` DOMContentLoaded. After `selectLesson(...)` or `selectSeminar(...)` from URL params, deferred `setTimeout(..., 0)` hides `#hero`, adds `.show` to `#videoSection`, loads iframe WITHOUT `autoplay=1` (browser autoplay blockers require user gesture). Scrolls player into view after 80ms.
  4. **Bug 2 (MEDIUM) — Library search clear hardened.** `js/library.js applyFilters` now reads `state.query` fresh, computes `hasQuery = needle.length > 0`, and gates entire text-search block on it (defensive — original code looked correct but bug was reproducible). `renderList` empty-state toggle moved to unconditional `empty.hidden = !isEmpty`.
  5. **Bug 9 (LOW) — Avatar search now matches via tags + synonyms.** Search in `applyFilters` extended: after title+meta match fails, walks `item.tags`, and for each tag checks `TOPIC_KEYWORDS[tag]` synonyms. So "אווטאר" matches any lesson tagged 'קהל' (avatar is a listed synonym).
  6. **Bug 6 (MEDIUM) — Practice exit button via addEventListener.** `pages/practice.html` — removed inline `onclick` from #exitBtn / #cancelExitBtn / #confirmExitBtn. `js/practice.js` — bound them inside DOMContentLoaded. Globals `window.requestExit/confirmExit/cancelExit` kept for backwards compat.
  7. **Bug 8 (LOW) — Practice page no longer blank for 2s.** `js/practice.js` — `init()` now runs synchronously from localStorage. Supabase sync chain runs in background; new `refreshStats()` helper updates XP/streak/last-score after sync resolves (only if `state.view === 'menu'` — never interrupts mid-challenge).
  8. **Bug 7 (LOW) — Quiz breadcrumb hidden during active quiz.** `pages/quiz.html` — body class toggles `quiz-active` (on startQuiz/showQuiz) and `quiz-results` (on showResults). CSS hides breadcrumb when `body.quiz-active` and shows again when `body.quiz-active.quiz-results`. Both classes cleared on `showSelect()`.
  - Files changed: `index.html`, `js/library.js`, `js/practice.js`, `pages/practice.html`, `pages/quiz.html`. Plan file: `C:\Users\saraa\.claude\plans\parallel-squishing-scone.md`.

- **Previous task completed (2026-05-25, pushed in commits `981ddcd` + `b1abdd0`):** **Full portal audit + 3 production blockers fixed.** 6-agent parallel audit produced `audit-2026-05-25.md` (vercel-ignored). Findings: 3 BLOCKERs, 12 HIGH, 8 MEDIUM, 6 LOW. Hillel approved fixing all 3 blockers:
  1. **B1 — Mobile sidebar drawer unreachable.** All CSS/handlers were ready and waiting for `#sidebarToggle` button that didn't exist. Added hamburger button to `.v1-fabs` (mobile-only FAB stack, already positioned correctly). Mobile users can now open the lessons sidebar.
  2. **B2 — Progress dashboard showed 0/132 for everyone.** `bwc_completed` is `string[]` but `pages/progress.html` calc functions treated it as `object` (`completed['m0-0-0']` always undefined). Converted to `Set` at boundaries (`getLocalData` + `mergeCompleted`), use `.has()` in `calcTotalCompleted` + `calcModuleStats`. Defensive: still accepts legacy object shape.
  3. **B3 — Delete-account RPC missing.** `pages/profile.html:947` called `rpc('delete_user')` which didn't exist → every attempt failed. Created `supabase/migrations/002_delete_user_rpc.sql` — `SECURITY DEFINER` function that deletes from `auth.users` (cascade handles profiles + 4 child tables). Applied manually via Supabase SQL editor (same flow as migration 001).
  - Also: `js/practice-data.js` — pre-existing local copy polish for module 2 challenges, committed separately as `b1abdd0`.
  - Also: `.vercelignore` — added `/audit-*.md` so audit artifacts don't ship publicly.

- **Previous task (2026-05-15, commit `59d4e42`):** **Professionalization Phase 1 — repo cleanup + auth-aware hero copy.** Removed dead architecture and tightened landing UX. Specifically:
  1. **Deleted dead folders/files** (after `git tag pre-cleanup-2026-05-15` rollback point): `backend/` (FastAPI never deployed), `frontend/` (Next.js never deployed), `docker-compose.yml`, `css/navbar-more.css`, `js/navbar-more.js`, `index-classic.html`, `CLAUDE CODE INSTRUCTIONS.txt` (stale FastAPI spec).
  2. **Archived background docs:** PDF + ZIP moved from repo root → `docs-archive/` (gitignored + vercelignored).
  3. **`.gitignore`** now blocks `*.zip` and `docs-archive/`.
  4. **`.vercelignore`** cleaned — removed entries for deleted paths, kept what's still needed.
  5. **`CLAUDE.md` fully rewritten** to reflect the actual static stack (HTML/CSS/JS + Supabase + Vercel serverless `/api/*`). The previous version described a FastAPI+Next.js+SQLite+Docker architecture that never shipped and was misleading every AI agent loading this project.
  6. **Hero copy in `index.html`** now branches on progress state. Three states: `done === 0` → "השיעור הראשון שלך · התחל ללמוד"; `0 < done < total` → "המשך מהשיעור שעצרת בו · המשך ללמוד"; `done === total` → "סיימת את כל השיעורים 🎉 · תרגול ומבחנים" with CTA redirected to `pages/practice.html`. Previously the eyebrow was static "השיעור הבא שלך" and a completed user saw "next lesson = lesson 1" again.
  7. **All 9 pages** verified to mount `<header class="gnav" data-page="X">` correctly. No nav fixes needed.
- **Previous task (2026-05-11, NOT yet committed):** **דשבורד התקדמות.** New `pages/progress.html` — 3-stat header (lessons/quizzes/XP+streak), per-module progress bars with quiz badges, practice summary card. Immediate render from localStorage; Supabase merge for authenticated users. `js/global-nav.js` updated: "ההתקדמות שלי" + "הפרופיל שלי" added to More menu on all pages.
- **Previous task (2026-05-11, commit `c5c0088`):** **Supabase Phase 3 — bidirectional real-time sync + account pages.** 5 files changed in parallel:
  1. `js/practice.js` — full Supabase sync: on load merges remote `practice_stats` with localStorage (max XP, max streak, union of completed challenges); every `saveData()` upserts to Supabase fire-and-forget; `bwcAuth.onChange` handles login events.
  2. `pages/quiz.html` — `_fetchAndMergeFromSupabase()` on load + `_syncModuleToSupabase()` after every quiz completion. Merges by highest `best_score`, summed `attempts`, ORed `passed`.
  3. `js/library.js` + `pages/library.html` — `fetchRemoteCompleted()` + `mergeCompleted()` + `syncAndRefresh()` on load and on login. Script loading order fixed (all `defer`, Supabase chain before `library.js`).
  4. `pages/profile.html` (new) — account settings: change password, export data (localStorage + Supabase merged JSON), delete account (requires typing "מחק" to confirm). Auth guard: unauthenticated users see a locked gate with login button.
  5. `pages/reset-password.html` (new) — handles Supabase recovery links (`#access_token&type=recovery`). `js/auth-modal.js` — "שכחתי סיסמה" link added in login tab (calls `resetPasswordForEmail`, redirects to this page). `css/auth-modal.css` — forgot-password button styles.
- **⚠️ NEEDS COMMIT + DEPLOY** — all changes (Phase 1 cleanup + Phase 3 Supabase sync + progress dashboard) are local, not pushed to git/Vercel yet. Rollback point: `git tag pre-cleanup-2026-05-15` (created 2026-05-15).
- **Previous task (2026-05-11, commit `240a5d3`):** **Supabase Phase 2 — auth UI + one-time localStorage sync.**
- **Previous task (2026-05-11):** **Supabase Phase 1 — infrastructure connected.** New Supabase project provisioned (`hiosnmkszdktirpfzjqi`). Migration `001_initial_schema.sql` applied via SQL editor, all 9 tests in `supabase-test.html` passed. 5 tables created: `profiles`, `course_progress`, `user_notes`, `quiz_scores`, `practice_stats`. RLS enforced on every table (user sees own rows; admin sees all except `user_notes`). Auto-create-profile trigger on `auth.users` wired. `js/supabase-config.js` initialises `window.bwcSupabase` client. `/supabase/` and `supabase-test.html` added to `.vercelignore` so they don't ship publicly. Hindsight entry added: Hebrew in `--` SQL comments breaks Supabase editor (bidi reverses the marker) — keep SQL comments ASCII-only.
- **Previous task (2026-05-10):** **Site-wide navigation unification.** Built `js/global-nav.js` + `css/global-nav.css` — a single Liquid Glass navbar component used by all 7 active pages. Primary items (visible): בית · ספרייה · תרגול · מבחנים (gold accent). "More" menu (⋯): השיטה · מודולים · סמינרים · תמלולים מלאים. Active page highlighted with gold underline. Logo always returns to `index.html`. Mobile (<768px): primary items collapse to icons. RTL via logical properties; relative paths via `getBasePath()` so it works on Vercel + GitHub Pages + local file://. Each page now has `<header class="gnav" data-page="X"></header>` + linked css/js. Replaced 7 different navbars (each page had its own) with one.
  - **Page-specific changes alongside:** hub.html → repositioned as "השיטה האטומית" (title/meta/single CTA, removed duplicate "התחילו את המסע" buttons). quiz.html → 3 "back" buttons removed; module-specific breadcrumb extracted and kept. seminars.html → bottom "חזרה לדף הראשי" button removed (logo handles it). module.html + seminars.html → `assets/css/design-tokens.css` linked alongside legacy `shared.css`. `navbar-more.css/js` no longer loaded by any page (files kept in repo).
  - **Bundled with this commit:** Previous session's pending work — learning-order swap (modules before seminars in `buildFlat()`, `renderSidebar()`, `js/library.js`) + hindsight z-index entry. `css/navbar-more.css` z-index fix is now dead (file unloaded) but kept as documentation.
- **Previous task (committed in `47d4059`):** Wave 3 — Practice game expanded to all 8 modules. 72 challenges total in `js/practice-data.js` (9 per module: 3 Match / 3 Order / 3 Cloze). `UNLOCKED_MODULE_IDX` constant replaced with `isModuleUnlocked(idx)` data-derived helper.
- **Next planned task — pick from `audit-2026-05-25.md` (full backlog at repo root, vercel-ignored).** Hillel closed the 2026-05-25 session after the 3 blockers shipped. Remaining audit backlog: **12 HIGH · 8 MEDIUM · 6 LOW** organized into 4 fix packages (Quick Wins 30min · Supabase sync 1.5h · UX polish 1h · Misc 3h). Highest-leverage next move is **Package 3 (Supabase sync — H3/H4/H6/H7/H8)**: cross-device progress, notes, quiz-as-completion, streak ghost-resurrection, attempts double-counting. The Supabase sync gap is the most user-visible lie ("your progress is saved in the cloud" — it isn't, beyond first login). Awaiting Claude Chrome feedback (running separately in browser) to potentially re-prioritize. Phase 2 + Phase 3 from `staged-brewing-quasar.md` are now largely overlapping with the audit backlog — use the audit as the source of truth.
- **Pending external action:** `supabase/migrations/002_delete_user_rpc.sql` was committed and the SQL editor was opened with the SQL on clipboard at end of session — verify it was actually run before relying on the delete-account button. Test path: log in to a throwaway account on `business-without-competitors.vercel.app` → Profile → "מחק חשבון" → type "מחק" → confirm. If it still shows "לא ניתן למחוק" the migration didn't run; paste `supabase/migrations/002_delete_user_rpc.sql` into https://supabase.com/dashboard/project/hiosnmkszdktirpfzjqi/sql/new and Run.
- **Blocking issues:** None.

## Protocol Architecture (added 2026-05-07)
- **Endpoints:** `/api/transcript` (YouTube captions scraper, no key needed), `/api/protocol-extract` (Stage 1 methodology), `/api/protocol-active` (Stage 2 active learning), `/api/_test` (sanity check)
- **Provider chain:** `api/_lib/providers.js` — Gemini 2.5 Flash → Groq Llama 3.3 70B → OpenRouter `deepseek-r1-distill-llama-70b:free`. First success wins, returns `{ text, providerUsed }`.
- **Prompts:** `api/_lib/prompts.js` — Stage 1 + 3 Stage 2 modes (habit / sim / investigate). All Hebrew, business tone, no hype words.
- **Frontend:** `js/protocol.js` exposes `window.Protocol.render(panelEl, ctx)`. `css/protocol.css` matches frosted-glass theme.
- **Tab integration:** `index.html:1564-1577` updateAITab() now delegates to `Protocol.render()` with `{videoId, lessonKey, externalGptUrl}`.
- **vercel.json:** `functions: { "api/**/*.js": { "maxDuration": 30 } }` for AI calls. ESM enabled via `api/package.json` `{"type":"module"}`.
- **Cache key:** `localStorage["bwc_protocol_v1_" + lessonKey]` stores `{transcript, methodology, providerUsed, active: {habit, sim, investigate}, lastMode}`.

## Recent Changes
| Date | What Changed | Files Affected |
|------|-------------|----------------|
| 2026-05-25 | **Practice content overhaul — all 72 challenges rewritten (commit `cc7ea3e`).** 9 parallel audit agents found avg 7.8/10 quality with critical gaps: Module 5 taught "message cracking" instead of "leverage point" (its actual theme); Module 6 had 0 AI challenges despite "כלי AI" in title; Module 2 lacked "השפעה ללא מכירה" coverage; 5 typos ("וירטוז", "חוקנה", "סיסטומיזציה", "סיסמה", "הפיכה"); 4 cross-module leaks. 8 parallel rewrite agents wrote replacement blocks per module; assembled into one Write. All 72 IDs preserved → existing user progress in localStorage/Supabase intact. Sanity: 72 challenges, 9/module, 0 duplicates, all cloze valid. Engine `practice.js` NOT touched — 3 minor bugs flagged for separate session (sessionXP refresh, last-score showing average, dead code). | `js/practice-data.js` |
| 2026-05-25 | **Full portal audit + 3 production blockers fixed.** 6-agent parallel code audit produced `audit-2026-05-25.md`. Hillel approved fixing the 3 blockers. (1) Added `#sidebarToggle` hamburger button to mobile FAB stack so mobile users can open the lessons drawer. (2) Fixed `pages/progress.html` to treat `bwc_completed` as `Set` instead of object — dashboard previously showed `0/132` to every guest. (3) Created `delete_user()` RPC in Supabase (migration 002) so the profile page's delete-account button finally works. Practice-data copy polish for module 2 carried in a separate commit. `.vercelignore` updated to exclude audit-*.md. Commits `981ddcd` + `b1abdd0`. | `index.html`, `pages/progress.html`, `supabase/migrations/002_delete_user_rpc.sql` (new), `js/practice-data.js`, `.vercelignore`, `audit-2026-05-25.md` (new) |
| 2026-05-15 | **Professionalization Phase 1 — cleanup + auth-aware hero copy.** Deleted `backend/`, `frontend/`, `docker-compose.yml`, `css/navbar-more.css`, `js/navbar-more.js`, `index-classic.html`, `CLAUDE CODE INSTRUCTIONS.txt`. Moved PDF+ZIP to `docs-archive/`. Rewrote `CLAUDE.md` to reflect actual static stack. Hero eyebrow + CTA now state-aware (fresh/mid/done). Rollback tag: `pre-cleanup-2026-05-15`. | `CLAUDE.md` (rewrite), `index.html` (heroEyebrowText + heroCtaText + renderHero state logic), `.gitignore`, `.vercelignore`, `מה-זה.txt`, `primer.md` |
| 2026-05-11 | **Supabase Phase 2 — auth UI + one-time localStorage sync.** Login/signup modal in navbar (no separate page). Soft gating — guests can keep using the site. On first sign-in: best-effort upsert of `bwc_completed`, `bwc_quiz_scores`, `bwc_practice_v1` to Supabase, then a per-(device,user) flag prevents re-runs. All 7 pages wired with the same defer chain (Supabase CDN → config → auth → modal → sync → global-nav). Commit `240a5d3`. | `js/auth.js`, `js/auth-modal.js`, `js/sync-localstorage.js`, `css/auth-modal.css` (new) · `js/global-nav.js`, `css/global-nav.css` (auth button + dropdown) · `index.html`, `hub.html`, `pages/library.html`, `pages/module.html`, `pages/practice.html`, `pages/quiz.html`, `pages/seminars.html` (script chain wired) · `primer.md`, `מה-זה.txt` (status) |
| 2026-05-11 | **Supabase Phase 1 — infrastructure.** New project `hiosnmkszdktirpfzjqi`. Migration with 5 tables + RLS + auto-profile trigger applied. Browser client wrapper created but not yet wired to any page. Hebrew-in-SQL-comments pitfall documented in hindsight. | `supabase/migrations/001_initial_schema.sql` (new) · `supabase/README.md` (new) · `js/supabase-config.js` (new) · `supabase-test.html` (new, gitignored from Vercel) · `.vercelignore`, `hindsight.md`, `primer.md` (updated) |
| 2026-05-10 | **Site-wide navigation unification.** New `js/global-nav.js` + `css/global-nav.css` component renders one Liquid Glass navbar with active state + More menu, mounted into `<header class="gnav" data-page="X">` placeholders on all 7 pages. Each page's old custom nav was removed. hub.html repositioned as "השיטה האטומית" (single primary CTA). quiz.html lost 3 redundant "back" buttons (breadcrumb kept). seminars.html bottom CTA removed. module/seminars now also load `assets/css/design-tokens.css`. `navbar-more.css/js` no longer loaded anywhere. | `index.html`, `hub.html`, `pages/library.html`, `pages/practice.html`, `pages/quiz.html`, `pages/module.html`, `pages/seminars.html` (modified) · `js/global-nav.js`, `css/global-nav.css` (new) |
| 2026-05-10 | **Learning order swap (bundled with above).** Modules now precede seminars in `buildFlat()`, `renderSidebar()`, and library listing — first lesson for new student is Module 1 opening, not seminar 1. | `index.html`, `js/library.js`, `css/navbar-more.css` (z-index fix from previous round, now dead but kept), `hindsight.md` |
| 2026-05-09 | **Wave 3 — Practice expanded to all 8 modules.** 63 new challenges (9 per module × 7 modules) appended to `js/practice-data.js`, total 72. Generated by 7 parallel Opus agents per module-specific Atomic Method anchors. `js/practice.js` `UNLOCKED_MODULE_IDX` constant replaced with `isModuleUnlocked(idx)` data-derived helper — all 8 modules now unlocked in the practice menu. No regression on Module 1. | `js/practice-data.js`, `js/practice.js` (modified) · `primer.md`, `מה-זה.txt` (status) |
| 2026-05-08 | **Library page + Duolingo-style practice MVP (Module 1).** Library: flatten of all 132 lessons (115 module videos + 1 AI-tool placeholder + 16 seminar parts) into one searchable RTL page with Liquid Glass theme. Topic tags auto-derived from titles (mostly module-level; many day titles are bare "יום 1/2/3" so per-day tagging is weak — flagged for Hillel). Deep links use real `?module=&week=&day=` / `?seminar=&part=` query params (verified against existing `index.html` routing). Practice: 3-screen state machine (menu/play/done), 3 challenge types (Match 4-6 pairs, Order 5 items drag/arrows, Cloze 4 options), 9 challenges for Module 1 grounded in the Atomic Method (מיצוב/אווטאר/הצעה אטומית/בורות-סולמות/פיצוח/שיטה). XP + streak persisted in `bwc_practice_v1` with Asia/Jerusalem date logic. Modules 2-8 visibly locked. Cross-linked from `index.html` more-menu, `hub.html` navbar, `pages/quiz.html` top-nav. **NOT deployed.** | `pages/library.html`, `js/library.js`, `css/library.css`, `pages/practice.html`, `js/practice.js`, `js/practice-data.js`, `css/practice.css` (new) · `index.html`, `pages/quiz.html`, `hub.html` (nav links added) |
| 2026-05-06 | **Deployed to GitHub Pages.** Promoted Liquid Glass to landing: `index.html` (was classic) → `index-classic.html`; `index-glass.html` → `index.html`. Added full OG/Twitter meta to glass version. Hub.html links unchanged (already point to `index.html`). | `index.html`, `index-classic.html` (rename), `primer.md`, `מה-זה.txt` |
| 2026-04-28 | Liquid Glass portal V1 (Apple visionOS-style) — atmospheric mesh BG with floating blobs/grain, frosted glass cards, gold+petrol palette, Frank Ruhl Libre display + Heebo body. Wired to MODULES/SEMINARS/QUIZZES. Dark-only by design. Standalone file, doesn't affect existing portal. | `index-glass.html` (new) |
| 2026-04-28 | Quiz/game system: 8 module quizzes, 5 questions each, with explanations, scoring, retry, localStorage tracking. Nav link added in top-nav. Mobile: nav links collapse to icons. | `js/quiz-data.js` (new), `pages/quiz.html` (new), `index.html` (nav + mobile rule) |
| 2026-04-26 | Portal UX redesign — proposed version (continue hero, split view, stats, 3 tabs, focus mode, lesson end panel) | `index.html`, `css/theme.css`, `js/theme-toggle.js` |
| 2026-04-26 | Phase 1-5 features: tabs, notes, search, AI tab, dark mode, lesson counter, 45s completion | `index.html`, `css/theme.css` (new), `js/theme-toggle.js` (new) |
| 2026-04-26 | Project Brain installed | `CLAUDE.md`, `primer.md`, `hindsight.md` |

## Active Branches
- `master` — main branch (4 commits + uncommitted portal redesign)

## Architecture Quick Reference

### Static Portal (primary)
- `index.html` — **Live landing**. Liquid Glass V1 (Apple visionOS-style, dark-only, frosted cards, gold+petrol). Self-contained.
- `index-classic.html` — Previous version (split view, continue hero, stats, dark/light). Kept as fallback.
- `hub.html` — Marketing/landing page
- `pages/module.html` — Module detail page
- `pages/seminars.html` — Seminars page
- `pages/quiz.html` — Module-level quiz system (8 quizzes × 5 questions)
- `js/course-data.js` — All course content (8 modules, 7 seminars, 120+ videos)
- `js/quiz-data.js` — 40 quiz questions with explanations, indexed by `moduleIndex`
- `css/shared.css` — Design system tokens
- `css/theme.css` — Dark/light mode overrides
- `js/theme-toggle.js` — Theme toggle with localStorage

### AI Protocol API (Vercel serverless — live)
- `api/transcript.js` — YouTube captions scraper
- `api/protocol-extract.js` — Stage 1 (methodology extraction)
- `api/protocol-active.js` — Stage 2 (habit / sim / investigate modes)
- `api/_lib/providers.js` — Provider chain: Gemini 2.5 Flash → Groq Llama 3.3 70B → OpenRouter DeepSeek
- Called from `js/protocol.js` only. Cache: `bwc_protocol_v1_<lessonKey>` in localStorage.

### Removed (2026-05-15)
- `backend/` (FastAPI) — never deployed, deleted
- `frontend/` (Next.js) — never deployed, deleted
- `docker-compose.yml`, `index-classic.html`, `navbar-more.css/js`, `CLAUDE CODE INSTRUCTIONS.txt` — dead weight, deleted

## Portal UX Features (Current)
- Continue Learning hero card with gold CTA
- 3 stats cards (streak, time remaining, module progress)
- Split view: video (66%) + inline notes (34%)
- Focus mode toggle on video
- Lesson end panel with prev/next names + mark complete
- 3 tabs: About, Resources, AI Coach
- Progressive disclosure sidebar (only active module expanded)
- "Jump to current lesson" button
- Dark/light mode with FOUC prevention
- Sidebar search with real-time filtering
- 45s auto-completion timer
- Keyboard navigation (arrows, skip when typing)
- localStorage: progress, notes, streak, theme

## Quiz System (Current)
- 8 quizzes — one per module, 5 questions each
- Question types: concept-check, application, recall — every question has a teaching explanation shown after answering
- Pass threshold: 80% (4/5)
- localStorage key: `bwc_quiz_scores` — `{ moduleIdx: { best, attempts, passed, lastScore, total } }`
- Module selector grid → Question flow (one at a time, dot progress) → Results screen with review
- Keyboard: 1-4 to pick answer, Enter to advance
- Deep link: `pages/quiz.html?quiz=N` opens module N directly
- Same theme system as portal (light/dark via `data-theme`, FOUC-prevented)

## Environment Notes
- **Live:** Vercel (primary) + GitHub Pages (mirror) — both deploy from `master`
- **No build step.** Local dev: VS Code Live Server or `python -m http.server 8000`
- **Supabase project:** `hiosnmkszdktirpfzjqi` — auth + 5 tables (profiles, course_progress, user_notes, quiz_scores, practice_stats)
- **AI Protocol API keys** stored in Vercel env vars (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY)

## Open Questions / Deferred
- **Phase 2:** auth-state branching in `index.html`; quiz-as-completion (passing quiz marks `course_progress`); sharpen library vs module page roles
- **Phase 3:** unified `progress-store.js` wrapping both completion trackers; CSS consolidation to single design-tokens system; DELETE in Supabase sync
- **Custom domain:** Hillel to buy `business-without-competitors.com` and point at Vercel
