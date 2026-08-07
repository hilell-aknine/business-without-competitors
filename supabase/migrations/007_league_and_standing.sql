-- ============================================================================
-- 007: Motivation layer - three-axis standing + weekly leagues
-- ============================================================================
-- Added 2026-08-07. Powers the practice page's "my standing" panel and the
-- Duolingo-style weekly league board.
--
-- NOTE: keep ALL SQL comments and string literals ASCII-only. Hebrew inside
-- this file has broken the migration editor before (see 005). Every piece of
-- Hebrew user-facing text lives in js/practice-league.js, never here.
--
-- PRIVACY CONTRACT - the whole point of this file:
--   * Every cross-learner read happens inside a SECURITY DEFINER function.
--     The browser NEVER selects another learner's row directly; RLS on the
--     base tables still denies that, and this migration does not weaken it.
--   * The functions return AGGREGATES and ANONYMOUS RANKS only.
--   * profiles.email is never read, never returned, by any function here.
--   * auth user ids are never returned. The board uses an opaque seat number.
--   * A learner is anonymous by default. A first name is shown ONLY after the
--     learner sets league_prefs.show_name = true, and a nickname ONLY if they
--     typed one. Nobody is named on a board without acting first.
--   * Percentiles are suppressed entirely below LEAGUE_MIN_COHORT learners,
--     because a percentile over a handful of people is noise (and embarrassing).
--
-- ============================================================================
-- TUNABLE CONSTANTS - change these two numbers and everything downstream
-- follows. Mirrored in js/practice-league.js (MIN_COHORT / LEAGUE_SIZE) purely
-- for copy; the SERVER value is the one that gates disclosure.
-- ============================================================================

-- Minimum number of active learners before ANY percentile is disclosed.
CREATE OR REPLACE FUNCTION public.league_min_cohort()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- How many learners share a league. Small groups keep it winnable for everyone.
CREATE OR REPLACE FUNCTION public.league_size()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

-- Denominators for the axis scores.
CREATE OR REPLACE FUNCTION public.league_total_lessons()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 132 $$;

CREATE OR REPLACE FUNCTION public.league_total_modules()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 8 $$;

-- Week starts on Sunday, in Israel time (the server runs UTC).
CREATE OR REPLACE FUNCTION public.league_week_start(p_date DATE DEFAULT NULL)
RETURNS DATE LANGUAGE sql STABLE AS $$
  SELECT (d - EXTRACT(DOW FROM d)::INT)::DATE
  FROM (SELECT COALESCE(p_date, (now() AT TIME ZONE 'Asia/Jerusalem')::DATE) AS d) s;
$$;


-- ============================================================================
-- 1. practice_weekly - per-week XP and active days
-- ============================================================================
-- practice_stats holds lifetime totals, which makes a league permanently
-- unwinnable for anyone who joined late. Leagues reset every week, so we need
-- a per-week bucket. Written by js/practice.js under normal RLS (own row only).

CREATE TABLE IF NOT EXISTS public.practice_weekly (
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start       DATE NOT NULL,
  xp               INT NOT NULL DEFAULT 0,
  active_days      SMALLINT NOT NULL DEFAULT 0,
  last_active_date DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS practice_weekly_week_idx ON public.practice_weekly (week_start, xp DESC);

ALTER TABLE public.practice_weekly ENABLE ROW LEVEL SECURITY;

-- Owner-only. Note there is deliberately NO "read everyone" policy: the league
-- board reads this table through a SECURITY DEFINER function instead.
DROP POLICY IF EXISTS practice_weekly_self_all ON public.practice_weekly;
CREATE POLICY practice_weekly_self_all ON public.practice_weekly
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS practice_weekly_admin_select ON public.practice_weekly;
CREATE POLICY practice_weekly_admin_select ON public.practice_weekly
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));


-- ============================================================================
-- 2. league_prefs - opt-out and how the learner is shown on a board
-- ============================================================================
-- Defaults are the privacy-safe ones: the learner participates, but appears as
-- an anonymous seat until they choose otherwise.

CREATE TABLE IF NOT EXISTS public.league_prefs (
  user_id    UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  nickname   TEXT,
  show_name  BOOLEAN NOT NULL DEFAULT FALSE,
  opted_in   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT league_prefs_nickname_len CHECK (nickname IS NULL OR char_length(nickname) <= 24)
);

ALTER TABLE public.league_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS league_prefs_self_all ON public.league_prefs;
CREATE POLICY league_prefs_self_all ON public.league_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ============================================================================
-- 3. get_learner_standing() - the three axes, with positive-only percentiles
-- ============================================================================
-- Axes:
--   learning    = 60% lessons completed + 40% average quiz score
--   persistence = 50% current streak (30 days = full) + 50% active days in the
--                 last 4 weeks (20 of 28 = full)
--   application = application_docs produced, out of the 8 modules
--
-- Returns ONE jsonb object describing the CALLER only, plus anonymous cohort
-- aggregates. It never returns a row, id, name or email belonging to anyone
-- else. top_pct is "you are in the top N percent" and is NULL whenever the
-- cohort is too small or the learner's score on that axis is still zero -
-- so the UI can never render a discouraging "bottom X%".

CREATE OR REPLACE FUNCTION public.get_learner_standing()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_cohort     INT;
  v_min_cohort INT := public.league_min_cohort();
  v_result     JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  WITH active AS (
    -- "Active learner" = has done at least one thing on any of the three axes.
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.course_progress  cp WHERE cp.user_id = p.id)
       OR EXISTS (SELECT 1 FROM public.application_docs ad WHERE ad.user_id = p.id)
       OR EXISTS (SELECT 1 FROM public.practice_stats   ps WHERE ps.user_id = p.id AND ps.total_xp > 0)
  ),
  raw AS (
    SELECT
      a.user_id,
      COALESCE((SELECT COUNT(*) FROM public.course_progress cp WHERE cp.user_id = a.user_id), 0)::NUMERIC AS lessons,
      COALESCE((SELECT AVG(qs.best_score * 100.0 / NULLIF(qs.total, 0))
                FROM public.quiz_scores qs WHERE qs.user_id = a.user_id), 0)::NUMERIC AS quiz_pct,
      COALESCE((SELECT ps.current_streak FROM public.practice_stats ps WHERE ps.user_id = a.user_id), 0)::NUMERIC AS cur_streak,
      COALESCE((SELECT ps.longest_streak FROM public.practice_stats ps WHERE ps.user_id = a.user_id), 0)::NUMERIC AS best_streak,
      COALESCE((SELECT SUM(pw.active_days) FROM public.practice_weekly pw
                WHERE pw.user_id = a.user_id
                  AND pw.week_start >= public.league_week_start() - INTERVAL '21 days'), 0)::NUMERIC AS days_28,
      COALESCE((SELECT COUNT(*) FROM public.application_docs ad WHERE ad.user_id = a.user_id), 0)::NUMERIC AS docs
    FROM active a
  ),
  scored AS (
    SELECT
      user_id, lessons, quiz_pct, cur_streak, best_streak, days_28, docs,
      ROUND(0.6 * LEAST(100, lessons * 100.0 / GREATEST(1, public.league_total_lessons()))
          + 0.4 * LEAST(100, quiz_pct))::INT AS learning,
      ROUND(0.5 * LEAST(100, cur_streak * 100.0 / 30.0)
          + 0.5 * LEAST(100, days_28   * 100.0 / 20.0))::INT AS persistence,
      ROUND(LEAST(100, docs * 100.0 / GREATEST(1, public.league_total_modules())))::INT AS application
    FROM raw
  ),
  ranked AS (
    SELECT
      user_id, lessons, quiz_pct, cur_streak, best_streak, days_28, docs,
      learning, persistence, application,
      PERCENT_RANK() OVER (ORDER BY learning)    AS pr_learning,
      PERCENT_RANK() OVER (ORDER BY persistence) AS pr_persistence,
      PERCENT_RANK() OVER (ORDER BY application) AS pr_application,
      COUNT(*) OVER ()                           AS cohort
    FROM scored
  )
  SELECT
    r.cohort,
    jsonb_build_object(
      'cohort',           r.cohort,
      'min_cohort',       v_min_cohort,
      'show_percentiles', (r.cohort >= v_min_cohort),
      'week_start',       public.league_week_start(),
      'axes', jsonb_build_object(
        'learning', jsonb_build_object(
          'score',   r.learning,
          'top_pct', CASE WHEN r.cohort >= v_min_cohort AND r.learning > 0
                          THEN GREATEST(1, LEAST(100, CEIL((1 - r.pr_learning) * 100)::INT)) END,
          'raw', jsonb_build_object(
            'lessons',       r.lessons::INT,
            'total_lessons', public.league_total_lessons(),
            'quiz_avg',      ROUND(r.quiz_pct)::INT)
        ),
        'persistence', jsonb_build_object(
          'score',   r.persistence,
          'top_pct', CASE WHEN r.cohort >= v_min_cohort AND r.persistence > 0
                          THEN GREATEST(1, LEAST(100, CEIL((1 - r.pr_persistence) * 100)::INT)) END,
          'raw', jsonb_build_object(
            'current_streak', r.cur_streak::INT,
            'longest_streak', r.best_streak::INT,
            'active_days_28', r.days_28::INT)
        ),
        'application', jsonb_build_object(
          'score',   r.application,
          'top_pct', CASE WHEN r.cohort >= v_min_cohort AND r.application > 0
                          THEN GREATEST(1, LEAST(100, CEIL((1 - r.pr_application) * 100)::INT)) END,
          'raw', jsonb_build_object(
            'docs',          r.docs::INT,
            'total_modules', public.league_total_modules())
        )
      ),
      -- The axis to celebrate. Always the learner's OWN strongest axis, so the
      -- UI has something honest and positive to say even for a slow starter.
      'best_axis', CASE
        WHEN r.application >= r.learning AND r.application >= r.persistence THEN 'application'
        WHEN r.persistence >= r.learning                                    THEN 'persistence'
        ELSE 'learning' END
    )
  INTO v_cohort, v_result
  FROM ranked r
  WHERE r.user_id = v_uid;

  -- Brand new learner: not in the active set yet. Give them a zeroed card
  -- rather than an error, so the UI shows goals instead of breaking.
  IF v_result IS NULL THEN
    SELECT COUNT(*) INTO v_cohort FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.course_progress  cp WHERE cp.user_id = p.id)
       OR EXISTS (SELECT 1 FROM public.application_docs ad WHERE ad.user_id = p.id)
       OR EXISTS (SELECT 1 FROM public.practice_stats   ps WHERE ps.user_id = p.id AND ps.total_xp > 0);

    v_result := jsonb_build_object(
      'cohort',           v_cohort,
      'min_cohort',       v_min_cohort,
      'show_percentiles', FALSE,
      'week_start',       public.league_week_start(),
      'axes', jsonb_build_object(
        'learning',    jsonb_build_object('score', 0, 'top_pct', NULL,
                         'raw', jsonb_build_object('lessons', 0, 'total_lessons', public.league_total_lessons(), 'quiz_avg', 0)),
        'persistence', jsonb_build_object('score', 0, 'top_pct', NULL,
                         'raw', jsonb_build_object('current_streak', 0, 'longest_streak', 0, 'active_days_28', 0)),
        'application', jsonb_build_object('score', 0, 'top_pct', NULL,
                         'raw', jsonb_build_object('docs', 0, 'total_modules', public.league_total_modules()))
      ),
      'best_axis', 'learning'
    );
  END IF;

  RETURN v_result;
END;
$$;


-- ============================================================================
-- 4. get_league_board() - the caller's weekly league only
-- ============================================================================
-- Everyone who earned XP this week is ranked, then sliced into leagues of
-- league_size(). The caller gets back ONLY their own slice.
--
-- Each row carries: seat (stable within the week), rank, display_name, xp,
-- is_me. display_name is NULL unless the learner opted to be named - the
-- client renders an anonymous label from `seat` in that case. No user ids,
-- no emails, no surnames, no rows outside the caller's own league.

CREATE OR REPLACE FUNCTION public.get_league_board()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_week   DATE := public.league_week_start();
  v_size   INT  := public.league_size();
  v_opted  BOOLEAN;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT COALESCE(lp.opted_in, TRUE) INTO v_opted
  FROM public.profiles p
  LEFT JOIN public.league_prefs lp ON lp.user_id = p.id
  WHERE p.id = v_uid;

  IF v_opted IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('opted_out', TRUE, 'week_start', v_week);
  END IF;

  -- NOTE: everything below is pure CTE on purpose. A temp table would be DDL,
  -- which Postgres refuses inside a STABLE function.
  WITH board AS (
    SELECT pw.user_id, pw.xp, pw.active_days,
           ROW_NUMBER() OVER (ORDER BY pw.xp DESC, pw.user_id) AS rn
    FROM public.practice_weekly pw
    LEFT JOIN public.league_prefs lp ON lp.user_id = pw.user_id
    WHERE pw.week_start = v_week
      AND pw.xp > 0
      AND COALESCE(lp.opted_in, TRUE)
  ),
  grouped AS (
    SELECT user_id, xp, active_days,
           ((rn - 1) / v_size)::INT       AS grp,
           (((rn - 1) % v_size) + 1)::INT AS rnk,
           rn::INT                        AS seat
    FROM board
  ),
  mine AS (
    -- Caller not ranked yet this week: show the bottom league so they can see
    -- who they will be up against once they play a round.
    SELECT
      COALESCE((SELECT g.grp FROM grouped g WHERE g.user_id = v_uid),
               (SELECT COALESCE(MAX(g2.grp), 0) FROM grouped g2)) AS grp,
      EXISTS (SELECT 1 FROM grouped g3 WHERE g3.user_id = v_uid)  AS joined
  )
  SELECT jsonb_build_object(
    'week_start',  v_week,
    'league_no',   (SELECT m.grp FROM mine m) + 1,
    'league_size', v_size,
    'joined',      (SELECT m.joined FROM mine m),
    'players', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'rank',  g.rnk,
                 'seat',  g.seat,
                 'xp',    g.xp,
                 'days',  g.active_days,
                 'is_me', (g.user_id = v_uid),
                 -- Anonymous unless the learner explicitly chose to be named.
                 -- Nickname wins; otherwise the FIRST TOKEN of full_name only.
                 -- profiles.email is never touched anywhere in this function.
                 'display_name', CASE
                   WHEN NULLIF(TRIM(COALESCE(lp.nickname, '')), '') IS NOT NULL
                     THEN LEFT(TRIM(lp.nickname), 24)
                   WHEN COALESCE(lp.show_name, FALSE)
                     THEN NULLIF(SPLIT_PART(TRIM(COALESCE(pr.full_name, '')), ' ', 1), '')
                   ELSE NULL
                 END
               ) ORDER BY g.rnk)
      FROM grouped g
      JOIN public.profiles pr ON pr.id = g.user_id
      LEFT JOIN public.league_prefs lp ON lp.user_id = g.user_id
      WHERE g.grp = (SELECT m.grp FROM mine m)
    ), '[]'::JSONB)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;


-- ============================================================================
-- 5. Grants - authenticated users only. Never anon, never public.
-- ============================================================================
REVOKE ALL ON FUNCTION public.get_learner_standing()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_league_board()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.league_week_start(DATE)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.league_min_cohort()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.league_size()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.league_total_lessons()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.league_total_modules()      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_learner_standing()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_league_board()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_week_start(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_min_cohort()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_size()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_total_lessons()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_total_modules()  TO authenticated;


-- ============================================================================
-- 6. Leak test - run these AFTER `supabase db push`, signed in as a learner.
-- ============================================================================
-- Every one of these must hold. They are the acceptance criteria for the
-- privacy contract above.
--
--   -- (a) direct cross-user reads stay denied by RLS
--   SELECT * FROM public.practice_weekly;      -- returns ONLY your own rows
--   SELECT * FROM public.league_prefs;         -- returns ONLY your own row
--   SELECT * FROM public.practice_stats;       -- returns ONLY your own row
--
--   -- (b) the RPCs never leak an identifier
--   SELECT public.get_learner_standing()::text ~* '@'            AS has_email;   -- false
--   SELECT public.get_league_board()::text     ~* '@'            AS has_email;   -- false
--   SELECT public.get_league_board()::text
--          ~* '[0-9a-f]{8}-[0-9a-f]{4}-'                         AS has_uuid;    -- false
--
--   -- (c) board size never exceeds one league
--   SELECT jsonb_array_length(public.get_league_board()->'players')
--          <= public.league_size()                               AS size_ok;     -- true
--
--   -- (d) anon must not be able to call them at all
--   SET ROLE anon; SELECT public.get_learner_standing();  -- expect: permission denied
--   RESET ROLE;
