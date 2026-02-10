# CLAUDE.md — עסק ללא מתחרים (Business Without Competitors)

## Quick Reference

- **Project:** AI-Powered Learning Management System
- **Stack:** FastAPI (Python) + Next.js + SQLite + Claude 3.5 Sonnet
- **Purpose:** Course delivery platform with multiple AI coaching agents
- **Language:** Hebrew (RTL) UI, English code

## מטרת העל

מערכת LMS חכמה שמלווה תלמידים בקורס עסקי עם 3 סוכני AI:
1. **Coach** — ליווי אישי ומתן משוב
2. **10X Accelerator** — האצת למידה וביצוע
3. **Tools Arsenal** — כלים ומשאבים מעשיים

## Architecture

```
backend/                        — FastAPI application
  app/
    main.py                     — App entry point
    config.py                   — Settings & env vars
    database.py                 — SQLAlchemy DB setup
    models/
      user.py                   — User model
      lesson.py                 — Lesson model
      chat.py                   — Chat/conversation model
    schemas/
      user.py, lesson.py, chat.py — Pydantic schemas
    services/
      ai_engine.py              — Claude API integration
      agents.py                 — Multi-agent orchestration
      transcript.py             — Lecture transcript processing
    routers/
      auth.py                   — Authentication routes
      lessons.py                — Lesson CRUD routes
      chat.py                   — Chat/agent routes
      tools.py                  — Tools arsenal routes
    scripts/
      ingest_course.py          — Course content ingestion
      seed_data.py              — Database seeding
  Dockerfile
  requirements.txt
  lms.db                        — SQLite database

frontend/                       — Next.js application
  src/
    app/
      page.tsx                  — Home / dashboard
      login/page.tsx            — Login page
      onboarding/page.tsx       — Onboarding flow
      lesson/[id]/page.tsx      — Lesson view
    components/
      VideoPlayer.tsx           — Video playback
      AgentChat.tsx             — Chat with AI agents
      AgentSelector.tsx         — Agent selection UI
      CourseMap.tsx              — Course progress map
      OnboardingForm.tsx        — User onboarding
    lib/
      api.ts                    — API client
    types/
      index.ts                  — TypeScript interfaces
  package.json
  tailwind.config.js
  next.config.js
  tsconfig.json
  Dockerfile

docker-compose.yml              — Full stack Docker setup
```

## Commands

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev

# Docker (full stack)
docker-compose up

# Database scripts
cd backend
python -m app.scripts.seed_data
python -m app.scripts.ingest_course
```

## Key Services

- **ai_engine.py** — Claude 3.5 Sonnet API integration for all AI features
- **agents.py** — Multi-agent orchestration (Coach, 10X Accelerator, Tools Arsenal)
- **transcript.py** — Lecture transcript processing and chunking

## Database

- **Engine:** SQLite at `backend/lms.db`
- **ORM:** SQLAlchemy
- **Models:** User, Lesson, Chat
- **Schemas:** Pydantic validation for all API I/O

## Coding Standards

- **UI text:** Hebrew (RTL direction)
- **Code:** English (variables, comments, commits)
- **Backend:** Python type hints, Pydantic schemas for validation
- **Frontend:** TypeScript strict, Tailwind CSS
- **API:** RESTful routes under FastAPI routers

## Environment Variables

- Backend: `backend/.env` (see `.env.example`)
- Frontend: `frontend/.env.local` (see `.env.local.example`)
- Required: `ANTHROPIC_API_KEY` for Claude integration

## Important Notes

- Never commit `lms.db` with real user data
- Never commit `.env` files with API keys
- AI agents share context via the ai_engine service
- All agent responses should be in Hebrew

## Skills (Project-Level)

| Skill | Trigger | Purpose |
|-------|---------|---------|
| add-lesson-content | "הוסף שיעור" | Ingest lesson into SQLite DB |
| test-agents | "בדוק סוכנים" | Test 3 AI agent responses |
| seed-database | "אתחל מסד נתונים" | Seed/reset the database |

### Usage Example
```
הוסף שיעור
```
