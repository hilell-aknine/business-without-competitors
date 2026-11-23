-- ============================================================================
-- 015_private_courses.sql
-- Private courses: content that lives ONLY in the database, never in the repo.
--
-- Why a new model instead of js/course-data.js:
--   course-data.js is a public static file (Vercel + GitHub Pages serve it to
--   anyone). A course that must be visible to a single account cannot live
--   there. Here the content is stored in tables whose rows are readable only
--   by accounts that hold an explicit grant in private_course_access.
--
-- The gate is a per-user GRANT, not is_admin(): a future admin does NOT
-- automatically see a private course. Grants are written with the service
-- role / SQL editor only (no INSERT/UPDATE/DELETE policy for anyone).
--
-- Purely additive: creates new tables only, touches no existing table.
-- Keep comments ASCII-only (see 001_initial_schema.sql).
-- ============================================================================

-- 1. courses (title, structure of stages -> modules -> lesson numbers)
CREATE TABLE IF NOT EXISTS public.private_courses (
  id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  title       TEXT NOT NULL,
  subtitle    TEXT,
  structure   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. who may read which course
CREATE TABLE IF NOT EXISTS public.private_course_access (
  course_id   TEXT NOT NULL REFERENCES public.private_courses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

-- 3. lessons
CREATE TABLE IF NOT EXISTS public.private_course_lessons (
  course_id          TEXT NOT NULL REFERENCES public.private_courses(id) ON DELETE CASCADE,
  ord                INT  NOT NULL,
  stage_ord          INT  NOT NULL,
  module_ord         INT  NOT NULL,
  title              TEXT NOT NULL,
  video_type         TEXT NOT NULL DEFAULT 'none'
                     CHECK (video_type IN ('youtube', 'vimeo', 'none', 'unavailable')),
  video_id           TEXT,
  video_hash         TEXT,
  content_status     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (content_status IN ('ready', 'pending')),
  summary            TEXT,
  key_points         JSONB NOT NULL DEFAULT '[]'::jsonb,
  practice_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  workbook           JSONB,
  tutor_grounding    TEXT,
  PRIMARY KEY (course_id, ord)
);

-- 4. progress on private lessons (kept apart from course_progress so the
--    public course counters never see these lessons)
CREATE TABLE IF NOT EXISTS public.private_course_progress (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    TEXT NOT NULL,
  ord          INT  NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, course_id, ord),
  FOREIGN KEY (course_id, ord) REFERENCES public.private_course_lessons(course_id, ord) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.private_courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_course_access   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_course_lessons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_course_progress ENABLE ROW LEVEL SECURITY;

-- anon gets nothing at all, not even an empty select
REVOKE ALL ON public.private_courses         FROM anon;
REVOKE ALL ON public.private_course_access   FROM anon;
REVOKE ALL ON public.private_course_lessons  FROM anon;
REVOKE ALL ON public.private_course_progress FROM anon;

-- authenticated: read-only on content, read-own on grants, own progress
REVOKE ALL ON public.private_courses         FROM authenticated;
REVOKE ALL ON public.private_course_access   FROM authenticated;
REVOKE ALL ON public.private_course_lessons  FROM authenticated;
REVOKE ALL ON public.private_course_progress FROM authenticated;
GRANT SELECT ON public.private_courses        TO authenticated;
GRANT SELECT ON public.private_course_access  TO authenticated;
GRANT SELECT ON public.private_course_lessons TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.private_course_progress TO authenticated;

-- a user sees only his own grant rows
DROP POLICY IF EXISTS pc_access_self_select ON public.private_course_access;
CREATE POLICY pc_access_self_select ON public.private_course_access
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pc_courses_granted_select ON public.private_courses;
CREATE POLICY pc_courses_granted_select ON public.private_courses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.private_course_access a
    WHERE a.course_id = private_courses.id AND a.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS pc_lessons_granted_select ON public.private_course_lessons;
CREATE POLICY pc_lessons_granted_select ON public.private_course_lessons
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.private_course_access a
    WHERE a.course_id = private_course_lessons.course_id AND a.user_id = (SELECT auth.uid())
  ));

-- progress: own rows, and only inside a course you hold a grant for
DROP POLICY IF EXISTS pc_progress_self_select ON public.private_course_progress;
CREATE POLICY pc_progress_self_select ON public.private_course_progress
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pc_progress_self_insert ON public.private_course_progress;
CREATE POLICY pc_progress_self_insert ON public.private_course_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.private_course_access a
      WHERE a.course_id = private_course_progress.course_id AND a.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS pc_progress_self_delete ON public.private_course_progress;
CREATE POLICY pc_progress_self_delete ON public.private_course_progress
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS private_course_access_user_idx ON public.private_course_access (user_id);
