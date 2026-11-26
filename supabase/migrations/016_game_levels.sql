-- 016_game_levels.sql
--
-- Practice game, levels 2 and 3 (pages/game.html, api/game-coach.js).
--
-- DEPENDS ON:
--   001  public.profiles
--   013  public.game_players   (this file adds a column to it)
-- DOES NOT DEPEND ON 014. It can be run before 014, after 014, or without it:
--   * the usage table public.sandbox_usage is created here if 014 has not
--     created it yet (same definition), and its "kind" check is widened to
--     accept the two game kinds
--   * the game counts its calls through its OWN function, game_consume().
--     014's sandbox_consume() is left untouched on purpose: 014 defines it
--     with CREATE OR REPLACE, so a version widened here would be silently
--     reverted the day 014 is run after this file.
--
--   1. game_players.levels      per lesson progress of levels 2 and 3
--   2. game_consume()           daily cap for 'game_judge' and 'game_hint'
--   3. game_surprise_rounds     shared cache of generated "surprise" rounds,
--                               reachable only through two RPCs
--
-- Safe to run more than once.

-- ------------------------------------------------------------- 1. levels
alter table public.game_players add column if not exists levels jsonb not null default '{}'::jsonb;

COMMENT ON COLUMN public.game_players.levels IS
  'Levels 2-3 progress per lesson key. Written by js/game.js. See migration 016.';

-- ---------------------------------------------------------- 2. daily cap
-- Same table as 014 (one row per learner, day and kind).
CREATE TABLE IF NOT EXISTS public.sandbox_usage (
  user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day      date NOT NULL,
  kind     text NOT NULL,
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, day, kind)
);

-- Replace whatever check 014 put on "kind" (found by its definition, not by
-- its name) with one that also accepts the game kinds.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.sandbox_usage'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%transcribe%'
  LOOP
    EXECUTE format('ALTER TABLE public.sandbox_usage DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.sandbox_usage
  ADD CONSTRAINT sandbox_usage_kind_check
  CHECK (kind IN ('sandbox', 'transcribe', 'game_judge', 'game_hint'));

ALTER TABLE public.sandbox_usage ENABLE ROW LEVEL SECURITY;

-- Read own row only. No insert / update / delete policy on purpose: only the
-- SECURITY DEFINER functions write, so a learner cannot reset a counter.
DROP POLICY IF EXISTS sandbox_usage_own_select ON public.sandbox_usage;
CREATE POLICY sandbox_usage_own_select ON public.sandbox_usage
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.sandbox_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.sandbox_usage FROM authenticated;
GRANT SELECT ON TABLE public.sandbox_usage TO authenticated;

-- Called by api/_lib/quota.js with the learner's JWT. Adds one to today's
-- counter (Asia/Jerusalem) and returns how many calls are left, or -1 when
-- the cap is already reached (the counter is not raised past the cap).
-- Same contract as sandbox_consume() in 014.
CREATE OR REPLACE FUNCTION public.game_consume(p_kind text, p_cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_day   date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('game_judge', 'game_hint')
     OR p_cap IS NULL OR p_cap < 1 OR p_cap > 1000 THEN
    RAISE EXCEPTION 'bad arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sandbox_usage AS u (user_id, day, kind, count)
  VALUES (v_uid, v_day, p_kind, 1)
  ON CONFLICT (user_id, day, kind)
  DO UPDATE SET count = u.count + 1
  WHERE u.count < p_cap
  RETURNING u.count INTO v_count;

  IF v_count IS NULL THEN
    RETURN -1;            -- the row existed and was already at the cap
  END IF;
  RETURN p_cap - v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.game_consume(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_consume(text, integer) TO authenticated;

-- ------------------------------------------------- 3. surprise round cache
-- A generated round costs one model call. The first rounds of a lesson are
-- kept and served to later learners. The server signs every round before it
-- stores it and checks the signature before it serves one, so a row written
-- by a learner calling the RPC directly is never shown to anybody.
CREATE TABLE IF NOT EXISTS public.game_surprise_rounds (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lesson_key  text NOT NULL,
  exercises   jsonb NOT NULL,
  -- SET NULL: a cached round must not block deleting a user (migration 002).
  created_by  uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_surprise_rounds_lesson
  ON public.game_surprise_rounds (lesson_key);
CREATE INDEX IF NOT EXISTS game_surprise_rounds_author
  ON public.game_surprise_rounds (created_by, created_at);

COMMENT ON TABLE public.game_surprise_rounds IS
  'Cache of generated surprise rounds of the practice game. RPC access only. See migration 016.';

-- RLS on and no policy at all: no direct access for anon or authenticated.
ALTER TABLE public.game_surprise_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_surprise_rounds FROM PUBLIC, anon, authenticated;

-- One random cached round of a lesson plus how many the lesson has:
--   { "count": 3, "exercises": [ ... ] }      exercises is null when count = 0
CREATE OR REPLACE FUNCTION public.game_surprise_get(p_lesson text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_ex    jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;
  IF p_lesson IS NULL OR p_lesson !~ '^[a-z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'bad arguments' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.game_surprise_rounds WHERE lesson_key = p_lesson;

  SELECT r.exercises INTO v_ex
  FROM public.game_surprise_rounds r
  WHERE r.lesson_key = p_lesson
  ORDER BY random()
  LIMIT 1;

  RETURN jsonb_build_object('count', v_count, 'exercises', v_ex);
END;
$$;

-- Stores one round for the caller. Returns true when stored, false when a
-- limit said no (12 rounds per lesson, 20 inserts per learner per day).
-- Malformed input raises.
CREATE OR REPLACE FUNCTION public.game_surprise_put(p_lesson text, p_exercises jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day_start timestamptz :=
    date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;
  IF p_lesson IS NULL OR p_lesson !~ '^[a-z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'bad lesson key' USING ERRCODE = '22023';
  END IF;
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR jsonb_array_length(p_exercises) NOT BETWEEN 4 AND 6
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_exercises) e WHERE jsonb_typeof(e) <> 'object')
     OR octet_length(p_exercises::text) > 60000 THEN
    RAISE EXCEPTION 'exercises must be a JSON array of 4-6 objects' USING ERRCODE = '22023';
  END IF;

  -- One writer per lesson at a time, so two calls cannot both pass the count.
  PERFORM pg_advisory_xact_lock(hashtext('game_surprise:' || p_lesson));

  IF (SELECT count(*) FROM public.game_surprise_rounds WHERE lesson_key = p_lesson) >= 12 THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM public.game_surprise_rounds
      WHERE created_by = v_uid AND created_at >= v_day_start) >= 20 THEN
    RETURN false;
  END IF;

  INSERT INTO public.game_surprise_rounds (lesson_key, exercises, created_by)
  VALUES (p_lesson, p_exercises, v_uid);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.game_surprise_get(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.game_surprise_put(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_surprise_get(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_surprise_put(text, jsonb) TO authenticated;
