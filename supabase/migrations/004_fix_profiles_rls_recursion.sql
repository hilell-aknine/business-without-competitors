-- ============================================================================
-- Fix: infinite recursion in RLS policy for relation "profiles"
-- Migration 004
-- NOTE: keep comments ASCII-only (see hindsight.md - Hebrew in -- comments
-- reverses the -- marker under RTL rendering and breaks the parser).
-- ============================================================================
--
-- Root cause: profiles_admin_select (and the other *_admin_select policies)
-- checked admin status with:
--   EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
-- Because that subquery selects FROM public.profiles itself, evaluating the
-- profiles_admin_select policy re-triggers profiles' own RLS policies, which
-- re-evaluates profiles_admin_select again -> infinite recursion (Postgres
-- error 42P17). Any query touching profiles, or touching a table whose admin
-- policy references profiles (course_progress, quiz_scores, practice_stats),
-- failed with this error.
--
-- Fix: move the admin check into a SECURITY DEFINER function. A SECURITY
-- DEFINER function owned by the table owner runs with the owner's privileges,
-- which are exempt from the table's own RLS policies, so the internal query
-- does not re-trigger RLS evaluation on profiles. All four admin-select
-- policies now call this function instead of inlining the subquery.

-- 1. Helper function: is this uid an admin? Bypasses RLS internally.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = uid AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- 2. Replace profiles_admin_select (the actually-recursive one)
DROP POLICY IF EXISTS profiles_admin_select ON public.profiles;

CREATE POLICY profiles_admin_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- 3. Replace the other three admin-select policies for consistency/safety.
-- These queried profiles from a different table's policy, which is not
-- self-recursive by itself, but still depends on profiles' RLS evaluation
-- succeeding -- routing them through the same bypass function removes any
-- dependency on profiles' policy set and matches the fix pattern everywhere.
DROP POLICY IF EXISTS progress_admin_select ON public.course_progress;

CREATE POLICY progress_admin_select ON public.course_progress
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS quiz_admin_select ON public.quiz_scores;

CREATE POLICY quiz_admin_select ON public.quiz_scores
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS practice_admin_select ON public.practice_stats;

CREATE POLICY practice_admin_select ON public.practice_stats
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
