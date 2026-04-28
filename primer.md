# Primer — עסק ללא מתחרים
> Last updated: 2026-04-28 by Claude Code

## Current State
- **Status:** Active
- **Last task completed:** Liquid Glass portal candidate (`index-glass.html`) — V1 "balanced" variation from the בית המטפלים design system, fully rebranded to עסק ללא מתחרים and wired to our 8 modules + 7 seminars + quiz system. Awaits user review before swapping with `index.html`.
- **Next planned task:** User reviews `index-glass.html` → decision to (a) replace `index.html`, (b) keep both as alternatives, or (c) iterate on glass design first.
- **Blocking issues:** None for current path. (Per-lesson quiz questions still need more transcripts, but module-level quiz already shipped.)

## Recent Changes
| Date | What Changed | Files Affected |
|------|-------------|----------------|
| 2026-04-28 | Liquid Glass portal V1 (Apple visionOS-style) — atmospheric mesh BG with floating blobs/grain, frosted glass cards, gold+petrol palette, Frank Ruhl Libre display + Heebo body. Wired to MODULES/SEMINARS/QUIZZES. Dark-only by design. Standalone file, doesn't affect existing portal. | `index-glass.html` (new) |
| 2026-04-28 | Quiz/game system: 8 module quizzes, 5 questions each, with explanations, scoring, retry, localStorage tracking. Nav link added in top-nav. Mobile: nav links collapse to icons. | `js/quiz-data.js` (new), `pages/quiz.html` (new), `index.html` (nav + mobile rule) |
| 2026-04-26 | Portal UX redesign — proposed version (continue hero, split view, stats, 3 tabs, focus mode, lesson end panel) | `index.html`, `css/theme.css`, `js/theme-toggle.js` |
| 2026-04-26 | Phase 1-5 features: tabs, notes, search, AI tab, dark mode, lesson counter, 45s completion | `index.html`, `css/theme.css` (new), `js/theme-toggle.js` (new) |
| 2026-04-26 | Project Brain installed | `CLAUDE.md`, `primer.md`, `hindsight.md` |

## Active Branches
- `master` — main branch (4 commits + uncommitted portal redesign)

## Architecture Quick Reference

### Static Portal (primary)
- `index.html` — Main learning portal (current production: split view, continue hero, stats, dark/light)
- `index-glass.html` — Liquid Glass V1 candidate (Apple visionOS-style, dark-only). Self-contained file. Pending review.
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
