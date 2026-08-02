-- ============================================================================
-- 005: application_docs - personal application documents from the apply-coach
-- ============================================================================
-- Added 2026-08-02 (Project-100 build). The apply-coach agent interviews the
-- learner over the five building blocks and produces a personal application
-- document per module. The client saves it here under the learner's own row.
-- RLS mirrors the existing tables: owner full access, admin read-only via
-- public.is_admin() (SECURITY DEFINER helper from migration 004).
-- NOTE: keep all SQL comments ASCII-only (Hebrew comments break the editor).

CREATE TABLE IF NOT EXISTS public.application_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx SMALLINT NOT NULL CHECK (module_idx >= 0 AND module_idx <= 7),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_idx)
);

CREATE INDEX IF NOT EXISTS application_docs_user_idx ON public.application_docs (user_id);

ALTER TABLE public.application_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS application_docs_own_select ON public.application_docs;
CREATE POLICY application_docs_own_select ON public.application_docs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS application_docs_own_insert ON public.application_docs;
CREATE POLICY application_docs_own_insert ON public.application_docs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS application_docs_own_update ON public.application_docs;
CREATE POLICY application_docs_own_update ON public.application_docs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS application_docs_own_delete ON public.application_docs;
CREATE POLICY application_docs_own_delete ON public.application_docs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Admin read-only, same pattern as the other four admin-select policies.
DROP POLICY IF EXISTS application_docs_admin_select ON public.application_docs;
CREATE POLICY application_docs_admin_select ON public.application_docs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Keep updated_at fresh on update.
CREATE OR REPLACE FUNCTION public.touch_application_docs()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_docs_touch ON public.application_docs;
CREATE TRIGGER application_docs_touch
  BEFORE UPDATE ON public.application_docs
  FOR EACH ROW EXECUTE FUNCTION public.touch_application_docs();
