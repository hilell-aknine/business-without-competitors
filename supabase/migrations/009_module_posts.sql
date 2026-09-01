-- ============================================================================
-- 009: module_posts - a discussion wall inside each module
-- ============================================================================
-- Added 2026-09-01. Learners go through the course alone: they watch, they
-- mark complete, and nothing they think ever reaches anyone else. This gives
-- every module its own wall, so someone opening module 4 sees what other
-- people took from module 4 before they even press play.
--
-- WHY author_name IS DENORMALIZED HERE
-- Showing who wrote a post would otherwise require reading OTHER learners'
-- rows in public.profiles, and profiles RLS is deliberately own-row-only
-- (migration 004). Rather than widening that policy - which would expose far
-- more than a name - the poster's own display name is copied onto the post at
-- insert time. No cross-learner profile reads exist anywhere in this schema,
-- and that stays true. This also matches the privacy line already drawn for
-- the leagues: first name only, never the email.
--
-- is_hidden is moderation, not deletion: a hidden post stops being visible to
-- everyone except its author and an admin, and can be restored. On a public
-- site with open signup, a wall with no moderation lever is a liability.
-- NOTE: keep all SQL comments ASCII-only (Hebrew comments break the editor).

CREATE TABLE IF NOT EXISTS public.module_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx SMALLINT NOT NULL CHECK (module_idx >= 0 AND module_idx <= 7),
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 1500),
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS module_posts_module_idx
  ON public.module_posts (module_idx, created_at DESC);
CREATE INDEX IF NOT EXISTS module_posts_user_idx
  ON public.module_posts (user_id);

ALTER TABLE public.module_posts ENABLE ROW LEVEL SECURITY;

-- Read: any signed-in learner sees the wall. The course is paid content, so
-- anon is NOT granted read - guests get the login prompt, not the discussion.
DROP POLICY IF EXISTS module_posts_read ON public.module_posts;
CREATE POLICY module_posts_read ON public.module_posts
  FOR SELECT TO authenticated
  USING (
    is_hidden = FALSE
    OR user_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

-- Write: only as yourself, and only unhidden. Without the is_hidden guard a
-- learner could post pre-hidden rows, or un-hide their own moderated post via
-- the update policy below.
DROP POLICY IF EXISTS module_posts_own_insert ON public.module_posts;
CREATE POLICY module_posts_own_insert ON public.module_posts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_hidden = FALSE);

DROP POLICY IF EXISTS module_posts_own_update ON public.module_posts;
CREATE POLICY module_posts_own_update ON public.module_posts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_hidden = FALSE)
  WITH CHECK (user_id = auth.uid() AND is_hidden = FALSE);

DROP POLICY IF EXISTS module_posts_own_delete ON public.module_posts;
CREATE POLICY module_posts_own_delete ON public.module_posts
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Admin moderation: full update (to flip is_hidden) and delete.
DROP POLICY IF EXISTS module_posts_admin_update ON public.module_posts;
CREATE POLICY module_posts_admin_update ON public.module_posts
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS module_posts_admin_delete ON public.module_posts;
CREATE POLICY module_posts_admin_delete ON public.module_posts
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Rate limit in the database, not the browser. A client-side cooldown is a
-- suggestion; anyone with the anon key and a terminal can ignore it. Ten posts
-- an hour is far above honest use and far below a flood.
CREATE OR REPLACE FUNCTION public.module_posts_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  SELECT count(*) INTO recent_count
  FROM public.module_posts
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'rate_limited'
      USING HINT = 'Too many posts in the last hour';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS module_posts_rate_limit_trg ON public.module_posts;
CREATE TRIGGER module_posts_rate_limit_trg
  BEFORE INSERT ON public.module_posts
  FOR EACH ROW EXECUTE FUNCTION public.module_posts_rate_limit();

-- Keep updated_at honest so the UI can show "נערך".
CREATE OR REPLACE FUNCTION public.touch_module_posts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS module_posts_touch ON public.module_posts;
CREATE TRIGGER module_posts_touch
  BEFORE UPDATE ON public.module_posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_module_posts();

-- Counts for the module cards ("12 לומדים שיתפו"). A plain SELECT count per
-- module would need eight round trips or a cross-module read; this returns the
-- whole map in one call and never exposes a single post body.
CREATE OR REPLACE FUNCTION public.get_module_post_counts()
RETURNS TABLE (module_idx SMALLINT, post_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT module_idx, count(*)::BIGINT
  FROM public.module_posts
  WHERE is_hidden = FALSE
  GROUP BY module_idx;
$$;

REVOKE ALL ON FUNCTION public.get_module_post_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_module_post_counts() TO authenticated;
