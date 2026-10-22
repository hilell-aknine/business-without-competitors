-- 012_is_admin_self_only.sql  (2026-10-22)
--
-- LEAK: public.is_admin(uid uuid) is SECURITY DEFINER and answered for ANY
-- uid, and EXECUTE was granted to anon (Supabase default privileges) on top
-- of authenticated. So anyone, without logging in, could POST
-- /rest/v1/rpc/is_admin {"uid": "<some uuid>"} and learn whether that user
-- is an admin. Measured live before this migration: anon -> 200 true for
-- the admin's uuid.
--
-- FIX:
--   * the function now answers only about the caller: uid must equal
--     auth.uid(), otherwise false. No session (anon) -> auth.uid() is NULL
--     -> false.
--   * EXECUTE revoked from PUBLIC and anon, so anon gets a permission error
--     before the function even runs.
--   * search_path pinned to '' and every name schema-qualified.
--
-- Same name, same signature, same grants for authenticated, on purpose:
--   * every RLS policy calls public.is_admin(auth.uid()) -> unchanged result
--     (onboarding_answers, profiles, course_progress, quiz_scores,
--      practice_stats, application_docs, practice_weekly, learner_resume,
--      module_posts x3 — checked in pg_policies on 2026-10-22)
--   * js/global-nav.js, js/admin-users.js, js/admin-stats.js call
--     rpc('is_admin', { uid: <own id> }) -> unchanged result, no front-end
--     change needed.
--   * no other SQL function calls is_admin (checked in pg_proc).
--
-- Rollback (the previous definition, saved before running this):
--   CREATE OR REPLACE FUNCTION public.is_admin(uid uuid) RETURNS boolean
--     LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND role = 'admin'); $$;
--   GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT uid IS NOT NULL
     AND uid = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = uid AND p.role = 'admin'
     );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_admin(uuid) IS
  'True only when uid is the caller (auth.uid()) and that profile has role=admin. Not executable by anon. See migration 012.';
