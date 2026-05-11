# Primer — עסק ללא מתחרים
> Last updated: 2026-05-11 by Claude Code

## Current State
- **Status:** **LIVE on Vercel** at `https://business-without-competitors.vercel.app` (also live on GitHub Pages at `https://hilell-aknine.github.io/business-without-competitors/`)
- **Last task completed (2026-05-11, NOT yet committed):** **דשבורד התקדמות.** New `pages/progress.html` — 3-stat header (lessons/quizzes/XP+streak), per-module progress bars with quiz badges, practice summary card. Immediate render from localStorage; Supabase merge for authenticated users. `js/global-nav.js` updated: "ההתקדמות שלי" + "הפרופיל שלי" added to More menu on all pages.
- **Previous task (2026-05-11, commit `c5c0088`):** **Supabase Phase 3 — bidirectional real-time sync + account pages.** 5 files changed in parallel:
  1. `js/practice.js` — full Supabase sync: on load merges remote `practice_stats` with localStorage (max XP, max streak, union of completed challenges); every `saveData()` upserts to Supabase fire-and-forget; `bwcAuth.onChange` handles login events.
  2. `pages/quiz.html` — `_fetchAndMergeFromSupabase()` on load + `_syncModuleToSupabase()` after every quiz completion. Merges by highest `best_score`, summed `attempts`, ORed `passed`.
  3. `js/library.js` + `pages/library.html` — `fetchRemoteCompleted()` + `mergeCompleted()` + `syncAndRefresh()` on load and on login. Script loading order fixed (all `defer`, Supabase chain before `library.js`).
  4. `pages/profile.html` (new) — account settings: change password, export data (localStorage + Supabase merged JSON), delete account (requires typing "מחק" to confirm). Auth guard: unauthenticated users see a locked gate with login button.
  5. `pages/reset-password.html` (new) — handles Supabase recovery links (`#access_token&type=recovery`). `js/auth-modal.js` — "שכחתי סיסמה" link added in login tab (calls `resetPasswordForEmail`, redirects to this page). `css/auth-modal.css` — forgot-password button styles.
- **⚠️ NEEDS COMMIT + DEPLOY** — all changes are local, not pushed to git/Vercel yet.
- **Previous task (2026-05-11, commit `240a5d3`):** **Supabase Phase 2 — auth UI + one-time localStorage sync.**
- **Previous task (2026-05-11):** **Supabase Phase 1 — infrastructure connected.** New Supabase project provisioned (`hiosnmkszdktirpfzjqi`). Migration `001_initial_schema.sql` applied via SQL editor, all 9 tests in `supabase-test.html` passed. 5 tables created: `profiles`, `course_progress`, `user_notes`, `quiz_scores`, `practice_stats`. RLS enforced on every table (user sees own rows; admin sees all except `user_notes`). Auto-create-profile trigger on `auth.users` wired. `js/supabase-config.js` initialises `window.bwcSupabase` client. `/supabase/` and `supabase-test.html` added to `.vercelignore` so they don't ship publicly. Hindsight entry added: Hebrew in `--` SQL comments breaks Supabase editor (bidi reverses the marker) — keep SQL comments ASCII-only.
- **Previous task (2026-05-10):** **Site-wide navigation unification.** Built `js/global-nav.js` + `css/global-nav.css` — a single Liquid Glass navbar component used by all 7 active pages. Primary items (visible): בית · ספרייה · תרגול · מבחנים (gold accent). "More" menu (⋯): השיטה · מודולים · סמינרים · תמלולים מלאים. Active page highlighted with gold underline. Logo always returns to `index.html`. Mobile (<768px): primary items collapse to icons. RTL via logical properties; relative paths via `getBasePath()` so it works on Vercel + GitHub Pages + local file://. Each page now has `<header class="gnav" data-page="X"></header>` + linked css/js. Replaced 7 different navbars (each page had its own) with one.
  - **Page-specific changes alongside:** hub.html → repositioned as "השיטה האטומית" (title/meta/single CTA, removed duplicate "התחילו את המסע" buttons). quiz.html → 3 "back" buttons removed; module-specific breadcrumb extracted and kept. seminars.html → bottom "חזרה לדף הראשי" button removed (logo handles it). module.html + seminars.html → `assets/css/design-tokens.css` linked alongside legacy `shared.css`. `navbar-more.css/js` no longer loaded by any page (files kept in repo).
  - **Bundled with this commit:** Previous session's pending work — learning-order swap (modules before seminars in `buildFlat()`, `renderSidebar()`, `js/library.js`) + hindsight z-index entry. `css/navbar-more.css` z-index fix is now dead (file unloaded) but kept as documentation.
- **Previous task (committed in `47d4059`):** Wave 3 — Practice game expanded to all 8 modules. 72 challenges total in `js/practice-data.js` (9 per module: 3 Match / 3 Order / 3 Cloze). `UNLOCKED_MODULE_IDX` constant replaced with `isModuleUnlocked(idx)` data-derived helper.
- **Next planned task:** Commit Phase 3 changes to git + deploy to Vercel. Then lower-priority deferred items: (a) unified progress dashboard (single page showing completed lessons, quiz scores, practice XP), (b) breadcrumbs, (c) unify CSS design systems, (d) clean dead `.v1-header` inline styles. Also consider: add "הפרופיל שלי" link in navbar More menu (currently profile.html exists but is not linked from nav).
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

### Backend (FastAPI — not yet deployed)
- `backend/` — FastAPI + SQLAlchemy + SQLite + Claude API
- 3 AI agents: Coach, 10X Accelerator, Tools Arsenal
- Not connected to static portal yet

### Frontend (Next.js — not yet deployed)
- `frontend/` — Next.js 14 + React 18 + TypeScript + Tailwind
- Has components (VideoPlayer, AgentChat, CourseMap)
- Not connected to static portal yet

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
- No deployment yet — runs as local static files
- Backend needs `ANTHROPIC_API_KEY` in `backend/.env`
- Frontend needs `frontend/.env.local`
- Docker: `docker-compose.yml` available for full stack

## Open Questions
- Game system: need more transcripts to generate per-lesson questions
- Auth: placeholder only — no Supabase or FastAPI auth connected yet
- Deployment: GitHub Pages planned (OG tags already configured for `hilell-aknine.github.io`)
