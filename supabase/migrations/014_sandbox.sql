-- 014_sandbox.sql
--
-- The atomic sandbox (pages/sandbox.html + js/sandbox.js + api/sandbox.js),
-- pilot on module 2. Five exercises per module; the browser keeps the same
-- state in localStorage (bwc_sandbox_v1_m<idx>) and this is the cloud copy.
--
--   sandbox_profiles  the 3 short business questions, for learners who have
--                     no application doc yet. One row per learner, reused by
--                     every module.
--   sandbox_sessions  one run through the 5 exercises of a module. The id is
--                     generated in the browser (crypto.randomUUID) so the
--                     local and the cloud copy share it.
--   sandbox_answers   the conversation of one exercise inside a session.
--   sandbox_plans     the if-then plan of exercise 5. One per learner per
--                     module (a newer plan replaces the older one), plus the
--                     follow-up the sandbox asks on the next visit.
--   sandbox_usage     daily counter of paid AI calls per learner and kind
--                     ('sandbox', 'transcribe'). Learners can read their own
--                     row but never write it: only sandbox_consume() does.
--
-- Access: owner-only ALL policies (select / insert / update / delete) on the
-- four learner tables. Admins can read sessions and plans for the stats page.
-- Safe to run more than once.

-- ---------------------------------------------------------------- profiles
CREATE TABLE IF NOT EXISTS public.sandbox_profiles (
  user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  sells       text NOT NULL DEFAULT '' CHECK (char_length(sells) <= 400),
  audience    text NOT NULL DEFAULT '' CHECK (char_length(audience) <= 400),
  edge        text NOT NULL DEFAULT '' CHECK (char_length(edge) <= 400),
  gender      text NOT NULL DEFAULT 'm' CHECK (gender IN ('m', 'f')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- sessions
CREATE TABLE IF NOT EXISTS public.sandbox_sessions (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx       smallint NOT NULL CHECK (module_idx BETWEEN 0 AND 7),
  level            text NOT NULL DEFAULT 'light' CHECK (level IN ('light', 'hard')),
  concept_term     text NOT NULL DEFAULT '' CHECK (char_length(concept_term) <= 80),
  current_exercise smallint NOT NULL DEFAULT 1 CHECK (current_exercise BETWEEN 1 AND 6),
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS sandbox_sessions_user_module
  ON public.sandbox_sessions (user_id, module_idx, started_at DESC);

-- ----------------------------------------------------------------- answers
CREATE TABLE IF NOT EXISTS public.sandbox_answers (
  session_id  uuid NOT NULL REFERENCES public.sandbox_sessions(id) ON DELETE CASCADE,
  exercise    smallint NOT NULL CHECK (exercise BETWEEN 1 AND 5),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  messages    jsonb NOT NULL DEFAULT '[]'::jsonb,
  done        boolean NOT NULL DEFAULT false,
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, exercise),
  CHECK (pg_column_size(messages) <= 200000)
);

-- ------------------------------------------------------------------- plans
CREATE TABLE IF NOT EXISTS public.sandbox_plans (
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx       smallint NOT NULL CHECK (module_idx BETWEEN 0 AND 7),
  session_id       uuid REFERENCES public.sandbox_sessions(id) ON DELETE SET NULL,
  plan             text NOT NULL CHECK (char_length(plan) BETWEEN 1 AND 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  followup_status  text NOT NULL DEFAULT 'pending'
                   CHECK (followup_status IN ('pending', 'done', 'partial', 'not_yet')),
  followup_note    text NOT NULL DEFAULT '' CHECK (char_length(followup_note) <= 2000),
  followed_up_at   timestamptz,
  PRIMARY KEY (user_id, module_idx)
);

-- ------------------------------------------------------------------- usage
CREATE TABLE IF NOT EXISTS public.sandbox_usage (
  user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day      date NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('sandbox', 'transcribe')),
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, day, kind)
);

-- -------------------------------------------------------------------- RLS
ALTER TABLE public.sandbox_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_answers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_usage    ENABLE ROW LEVEL SECURITY;

-- Owner ALL policies (includes UPDATE and DELETE: without them an upsert or a
-- reset is silently denied, the usual trap in this repo).
DROP POLICY IF EXISTS sandbox_profiles_own_all ON public.sandbox_profiles;
CREATE POLICY sandbox_profiles_own_all ON public.sandbox_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS sandbox_sessions_own_all ON public.sandbox_sessions;
CREATE POLICY sandbox_sessions_own_all ON public.sandbox_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- An answer row must belong to the caller AND sit in one of the caller's
-- own sessions, so nobody can attach rows to somebody else's session id.
DROP POLICY IF EXISTS sandbox_answers_own_all ON public.sandbox_answers;
CREATE POLICY sandbox_answers_own_all ON public.sandbox_answers
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.sandbox_sessions s
                WHERE s.id = session_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS sandbox_plans_own_all ON public.sandbox_plans;
CREATE POLICY sandbox_plans_own_all ON public.sandbox_plans
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Usage: read own row only. No insert / update / delete policy on purpose.
DROP POLICY IF EXISTS sandbox_usage_own_select ON public.sandbox_usage;
CREATE POLICY sandbox_usage_own_select ON public.sandbox_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin read for the stats page (is_admin is the self-only version, 012).
DROP POLICY IF EXISTS sandbox_sessions_admin_select ON public.sandbox_sessions;
CREATE POLICY sandbox_sessions_admin_select ON public.sandbox_sessions
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS sandbox_plans_admin_select ON public.sandbox_plans;
CREATE POLICY sandbox_plans_admin_select ON public.sandbox_plans
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------- daily cap (the RPC)
-- Called by api/sandbox.js and api/transcribe.js with the learner's JWT.
-- Adds one to today's counter (Asia/Jerusalem) and returns how many calls
-- are left, or -1 when the cap is already reached (the counter is not
-- raised past the cap). A learner calling it directly only spends their own
-- quota; the cap that matters is the one the server passes.
CREATE OR REPLACE FUNCTION public.sandbox_consume(p_kind text, p_cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_day   date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;
  IF p_kind NOT IN ('sandbox', 'transcribe') OR p_cap IS NULL OR p_cap < 1 OR p_cap > 1000 THEN
    RAISE EXCEPTION 'bad arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sandbox_usage AS u (user_id, day, kind, count)
  VALUES (v_uid, v_day, p_kind, 1)
  ON CONFLICT (user_id, day, kind)
  DO UPDATE SET count = u.count + 1
  WHERE u.count < p_cap
  RETURNING u.count INTO v_count;

  IF v_count IS NULL THEN
    RETURN -1;            -- conflict row existed and was already at the cap
  END IF;
  RETURN p_cap - v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sandbox_consume(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sandbox_consume(text, integer) TO authenticated;

COMMENT ON TABLE public.sandbox_sessions IS 'Atomic sandbox runs, one per module attempt. See migration 014.';
COMMENT ON TABLE public.sandbox_plans IS 'If-then plan from sandbox exercise 5, one per learner per module, with follow-up.';
