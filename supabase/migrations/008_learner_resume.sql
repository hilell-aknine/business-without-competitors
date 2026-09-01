-- ============================================================================
-- 008: learner_resume - where the learner actually stopped
-- ============================================================================
-- Added 2026-09-01. The portal claimed "המשך מהשיעור שעצרת בו" but had no
-- server-side notion of a position at all: the last lesson lived only in
-- localStorage, and the video timestamp did not exist anywhere. A learner who
-- switched from laptop to phone, or cleared their cache, restarted the course.
--
-- One row per learner on purpose (PRIMARY KEY on user_id). This is not a
-- watch-history table and must not become one - it answers exactly one
-- question: "where do I put this person when they come back?".
--
-- `variant` matters: some lessons ship two instructor cuts (Tamar / Tzvika).
-- Resuming without it would silently switch which video plays, which reads as
-- a bug to the learner even though the lesson key is correct. NULL = the
-- lesson has no variants, or none was chosen.
--
-- RLS mirrors the existing tables: owner full access, admin read-only via
-- public.is_admin() (SECURITY DEFINER helper from migration 004). Admin read
-- is what lets the learners dashboard show "stopped at lesson X".
-- NOTE: keep all SQL comments ASCII-only (Hebrew comments break the editor).

CREATE TABLE IF NOT EXISTS public.learner_resume (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_key TEXT NOT NULL CHECK (lesson_key ~ '^(m[0-9]+-[0-9]+-[0-9]+|s[0-9]+-[0-9]+)$'),
  seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  variant SMALLINT CHECK (variant IS NULL OR variant >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learner_resume ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learner_resume_own_select ON public.learner_resume;
CREATE POLICY learner_resume_own_select ON public.learner_resume
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS learner_resume_own_insert ON public.learner_resume;
CREATE POLICY learner_resume_own_insert ON public.learner_resume
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS learner_resume_own_update ON public.learner_resume;
CREATE POLICY learner_resume_own_update ON public.learner_resume
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE is required: js/resume.js clears the row when the learner asks to
-- forget their position, and account deletion relies on the cascade. Adding
-- CRUD without a DELETE policy is the classic silent-denial trap in this repo.
DROP POLICY IF EXISTS learner_resume_own_delete ON public.learner_resume;
CREATE POLICY learner_resume_own_delete ON public.learner_resume
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS learner_resume_admin_select ON public.learner_resume;
CREATE POLICY learner_resume_admin_select ON public.learner_resume
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
