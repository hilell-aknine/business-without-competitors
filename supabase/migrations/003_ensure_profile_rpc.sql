-- Migration 003: ensure_profile RPC
-- Self-heals a missing public.profiles row for the calling user.
--
-- Why: course_progress, quiz_scores and practice_stats all FK-reference
-- public.profiles(id). The handle_new_user() trigger only fires on auth.users
-- INSERT (signup). Users who signed in via OAuth, or whose accounts predate the
-- trigger, can have no profiles row -> every sync upsert fails with a
-- foreign-key violation (Postgres SQLSTATE 23503), so cloud progress never
-- saves. The client calls this RPC before syncing (js/sync-localstorage.js).
-- Idempotent: ON CONFLICT DO NOTHING, so it is a no-op when the row exists.

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.profiles (id, email)
  VALUES (uid, COALESCE(auth.jwt() ->> 'email', ''))
  ON CONFLICT (id) DO NOTHING;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

COMMENT ON FUNCTION public.ensure_profile() IS
  'Inserts the calling users profile row if missing, so FK-dependent sync upserts succeed. Idempotent.';
