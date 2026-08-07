-- ============================================================================
-- 006: real signup name capture + server-side onboarding questionnaire
-- ============================================================================
-- Added 2026-08-07. Two changes:
--   1. handle_new_user() now actually persists full_name from the signup
--      metadata (raw_user_meta_data). The column has existed since migration
--      001 but nothing ever wrote to it, because the only signup path was a
--      3-field modal (email / password / confirm password).
--      NOTE: email is the only contact field we collect. There is deliberately
--      NO phone column - decided 2026-08-07.
--   2. New table onboarding_answers - the "who am I" questionnaire the learner
--      answers on first visit. Previously the onboarding was 3 cosmetic steps
--      stored ONLY in localStorage, so nothing ever reached the server.
--
-- RLS mirrors the existing tables: owner has full access to their own row,
-- admin gets read-only through public.is_admin() (SECURITY DEFINER helper
-- from migration 004 - do NOT re-introduce a self-referencing subquery on
-- profiles here, that caused the 42P17 infinite recursion bug).
--
-- NOTE: keep all SQL comments ASCII-only. Hebrew inside a -- comment flips the
-- marker under RTL rendering in the Supabase SQL editor and breaks the parser.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Signup trigger now persists full_name
-- ---------------------------------------------------------------------------
-- The signup page calls auth.signUp with options.data = { full_name }.
-- Supabase copies that object into auth.users.raw_user_meta_data, and this
-- trigger is the only place with permission to write the profiles row at
-- signup time (the client may not even have a session yet if the project has
-- "Confirm email" turned on).
--
-- ON CONFLICT DO UPDATE (not DO NOTHING) so a profiles row created earlier by
-- ensure_profile() still gets backfilled. COALESCE keeps whatever the learner
-- already has - the trigger never overwrites a non-empty value with a blank.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '')
  )
  -- In ON CONFLICT DO UPDATE the existing row is referenced by the table's
  -- bare name ("profiles"), NOT schema-qualified - "public.profiles.full_name"
  -- raises "missing FROM-clause entry for table public".
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(profiles.full_name, EXCLUDED.full_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 2. onboarding_answers - one row per learner
-- ---------------------------------------------------------------------------
-- Question set is derived from the actual course content (8 modules of
-- The Atomic Method), not a generic template. Columns mirror the six steps:
--   business_stage   - where the business is today (bogs-and-ladders framing)
--   business_type    - what the learner sells
--   main_obstacle    - the wall they are hitting, mapped to a module
--   desired_outcome  - what "done" looks like for them
--   weekly_hours     - realistic time budget for learning + applying
--   weekly_goal      - lessons per week target (kept from the old flow)
-- `answers` holds the same payload as raw JSON (question id -> option id +
-- label) so the dashboard can render human-readable text without a join, and
-- so adding a question later does not require another migration.
CREATE TABLE IF NOT EXISTS public.onboarding_answers (
  user_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_stage  TEXT,
  business_type   TEXT,
  main_obstacle   TEXT,
  desired_outcome TEXT,
  weekly_hours    TEXT,
  weekly_goal     SMALLINT CHECK (weekly_goal IS NULL OR (weekly_goal BETWEEN 1 AND 50)),
  answers         JSONB NOT NULL DEFAULT '{}'::JSONB,
  steps_done      SMALLINT NOT NULL DEFAULT 0 CHECK (steps_done BETWEEN 0 AND 20),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_answers_completed_idx
  ON public.onboarding_answers (completed_at DESC);

ALTER TABLE public.onboarding_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_own_select ON public.onboarding_answers;
CREATE POLICY onboarding_own_select ON public.onboarding_answers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS onboarding_own_insert ON public.onboarding_answers;
CREATE POLICY onboarding_own_insert ON public.onboarding_answers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS onboarding_own_update ON public.onboarding_answers;
CREATE POLICY onboarding_own_update ON public.onboarding_answers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS onboarding_own_delete ON public.onboarding_answers;
CREATE POLICY onboarding_own_delete ON public.onboarding_answers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Admin read-only, same pattern as profiles_admin_select / quiz_admin_select.
DROP POLICY IF EXISTS onboarding_admin_select ON public.onboarding_answers;
CREATE POLICY onboarding_admin_select ON public.onboarding_answers
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_onboarding_answers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS onboarding_answers_touch ON public.onboarding_answers;
CREATE TRIGGER onboarding_answers_touch
  BEFORE UPDATE ON public.onboarding_answers
  FOR EACH ROW EXECUTE FUNCTION public.touch_onboarding_answers();


-- ---------------------------------------------------------------------------
-- 3. Backfill for accounts created before this migration
-- ---------------------------------------------------------------------------
-- Existing learners signed up through the old 3-field modal, so their profiles
-- row has no full_name. This copies anything already sitting in their auth
-- metadata (harmless no-op when there is nothing to copy). Learners with no
-- name anywhere stay NULL and are shown as unnamed in the admin dashboard.
UPDATE public.profiles p
SET full_name = NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', '')), '')
FROM auth.users u
WHERE u.id = p.id
  AND p.full_name IS NULL
  AND NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', '')), '') IS NOT NULL;
