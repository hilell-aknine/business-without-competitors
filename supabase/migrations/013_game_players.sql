-- 013_game_players.sql
--
-- Save state of the practice game (pages/game.html + js/game.js).
-- One row per learner. The browser keeps the same state in localStorage
-- under bwc_game_v1; this table is the cross-device copy.
--
-- The client never pushes before it has pulled and merged in the same page
-- session, so an empty device cannot overwrite a row that already has
-- progress. Merge rule on the client: max xp, union of completed lessons
-- and achievements, the newer last_play_date wins for the streak.
--
-- completed_lessons keys are lesson keys from js/course-data.js,
-- for example {"m0-1-0": true}.
--
-- Access:
--   * the owner can select / insert / update / delete the own row
--   * admins can select every row (public.is_admin(auth.uid()), the
--     self-only version from migration 012)
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.game_players (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp                   integer     NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level                integer     NOT NULL DEFAULT 1 CHECK (level >= 1),
  hearts               integer     NOT NULL DEFAULT 5 CHECK (hearts >= 0),
  max_hearts           integer     NOT NULL DEFAULT 5 CHECK (max_hearts >= 1),
  streak               integer     NOT NULL DEFAULT 0 CHECK (streak >= 0),
  longest_streak       integer     NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  total_correct        integer     NOT NULL DEFAULT 0 CHECK (total_correct >= 0),
  total_wrong          integer     NOT NULL DEFAULT 0 CHECK (total_wrong >= 0),
  completed_lessons    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  achievements         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  perfect_lessons      integer     NOT NULL DEFAULT 0 CHECK (perfect_lessons >= 0),
  perfect_lessons_list jsonb       NOT NULL DEFAULT '[]'::jsonb,
  weekly_activity      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  module_accuracy      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_play_date       date,
  last_heart_lost      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.game_players IS
  'Practice game save state, one row per learner. Written by js/game.js. See migration 013.';

ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_players_own_select ON public.game_players;
CREATE POLICY game_players_own_select ON public.game_players
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS game_players_own_insert ON public.game_players;
CREATE POLICY game_players_own_insert ON public.game_players
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS game_players_own_update ON public.game_players;
CREATE POLICY game_players_own_update ON public.game_players
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE policy on purpose: without it a reset of the own progress is
-- silently denied (the usual trap in this repo, see migration 008).
DROP POLICY IF EXISTS game_players_own_delete ON public.game_players;
CREATE POLICY game_players_own_delete ON public.game_players
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS game_players_admin_select ON public.game_players;
CREATE POLICY game_players_admin_select ON public.game_players
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- No access for anon at all: guests play on localStorage only.
REVOKE ALL ON TABLE public.game_players FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.game_players TO authenticated;
