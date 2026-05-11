-- ============================================================================
-- Initial schema for עסק ללא מתחרים
-- Migration 001
-- Creates: profiles, course_progress, user_notes, quiz_scores, practice_stats
-- Adds: RLS policies, auto-create-profile trigger, indexes
-- NOTE: keep comments ASCII-only. Hebrew in -- comments reverses the -- marker
-- under RTL rendering in the Supabase SQL editor and breaks the parser.
-- ============================================================================

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  full_name    TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON public.profiles (created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_admin_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 2. course_progress
CREATE TABLE IF NOT EXISTS public.course_progress (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_key   TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_key)
);

CREATE INDEX IF NOT EXISTS course_progress_user_id_idx ON public.course_progress (user_id);
CREATE INDEX IF NOT EXISTS course_progress_lesson_key_idx ON public.course_progress (lesson_key);

ALTER TABLE public.course_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY progress_self_all ON public.course_progress
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY progress_admin_select ON public.course_progress
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 3. user_notes
CREATE TABLE IF NOT EXISTS public.user_notes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_key  TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_key)
);

CREATE INDEX IF NOT EXISTS user_notes_user_id_idx ON public.user_notes (user_id);

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_self_all ON public.user_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. quiz_scores
CREATE TABLE IF NOT EXISTS public.quiz_scores (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx  SMALLINT NOT NULL CHECK (module_idx BETWEEN 0 AND 7),
  best_score  SMALLINT NOT NULL DEFAULT 0,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  passed      BOOLEAN NOT NULL DEFAULT FALSE,
  last_score  SMALLINT NOT NULL DEFAULT 0,
  total       SMALLINT NOT NULL DEFAULT 5,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, module_idx)
);

CREATE INDEX IF NOT EXISTS quiz_scores_user_id_idx ON public.quiz_scores (user_id);
CREATE INDEX IF NOT EXISTS quiz_scores_module_idx_idx ON public.quiz_scores (module_idx);

ALTER TABLE public.quiz_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY quiz_self_all ON public.quiz_scores
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY quiz_admin_select ON public.quiz_scores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 5. practice_stats
CREATE TABLE IF NOT EXISTS public.practice_stats (
  user_id              UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_xp             INT NOT NULL DEFAULT 0,
  current_streak       INT NOT NULL DEFAULT 0,
  longest_streak       INT NOT NULL DEFAULT 0,
  last_practice_date   DATE,
  challenges_completed JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.practice_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY practice_self_all ON public.practice_stats
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY practice_admin_select ON public.practice_stats
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 6. Auto-create profile on signup
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
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. touch_last_seen helper
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;
