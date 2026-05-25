-- Migration 002: delete_user RPC
-- Enables self-service account deletion from pages/profile.html.
-- profiles.id REFERENCES auth.users(id) ON DELETE CASCADE, so removing
-- the auth.users row automatically removes profiles + course_progress +
-- user_notes + quiz_scores + practice_stats for the same user.

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM auth.users WHERE id = uid;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;

COMMENT ON FUNCTION public.delete_user() IS
  'Self-service account deletion. Deletes auth.users row for the calling user; cascade removes profile and all child tables.';
