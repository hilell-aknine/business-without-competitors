# Primer — עסק ללא מתחרים
> Last updated: 2026-05-08 by Claude Code

## Current State
- **Status:** **LIVE on Vercel** at `https://business-without-competitors.vercel.app` (also still live on GitHub Pages at `https://hilell-aknine.github.io/business-without-competitors/`)
- **Last task completed:** **Lessons Library + Duolingo-style Practice MVP (built locally, NOT yet deployed).** Added `pages/library.html` (single page listing all 132 lessons + seminars with substring search, type/module/topic filters, completion icons from `bwc_completed` localStorage, auto-derived topic tags). Added `pages/practice.html` + `js/practice.js` + `js/practice-data.js` (3 challenge types: Match/Order/Cloze, 9 challenges for Module 1 only, XP + streak in `bwc_practice_v1`, modules 2-8 visibly locked). Cross-linked from `index.html` more-menu, `hub.html` navbar, `pages/quiz.html` top-nav, and library↔practice mutually.
- **Next planned task:** (1) Hillel reviews library + practice MVP locally (`python -m http.server 8000`) → approves quality. (2) Push to Vercel. (3) After approval, expand `practice-data.js` to all 8 modules (Wave 3 — currently only Module 1 has challenges). (4) Hillel adds GEMINI/GROQ/OPENROUTER keys to Vercel env vars for the older 10X Protocol feature. (5) Connect custom domain.
- **Blocking issues:** Library + Practice MVP awaiting Hillel's manual review and explicit OK before `git push`.

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
