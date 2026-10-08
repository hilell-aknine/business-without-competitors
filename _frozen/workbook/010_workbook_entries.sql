-- ============================================================================
-- 010: workbook_entries - the learner's filled-in module workbook
-- ============================================================================
-- Added 2026-09-14. The workbook is the STATIC form counterpart of the
-- apply-coach interview (migration 005): same five building blocks, but the
-- learner fills it at their own pace instead of answering a chat, and can
-- export the whole thing as a JSON context pack for an external LLM.
--
-- Why a separate table and not application_docs: application_docs holds ONE
-- finished markdown document per module produced by the coach, under a UNIQUE
-- (user_id, module_idx). The workbook is a live, partially-filled answer map
-- that is written on every autosave. Sharing the row would make a half-typed
-- answer overwrite a finished document.
--
-- RLS mirrors the existing tables exactly: owner full access, admin read-only
-- via public.is_admin() (SECURITY DEFINER helper from migration 004).
-- NOTE: keep all SQL comments ASCII-only (Hebrew comments break the editor).

CREATE TABLE IF NOT EXISTS public.workbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_idx SMALLINT NOT NULL CHECK (module_idx >= 0 AND module_idx <= 7),
  -- { "<fieldId>": "<the learner's text>", ... }. Shape is owned by the
  -- workbook definition in api/_kb/workbook-m<idx>.json, not by the DB, so a
  -- new question does not need a migration.
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Which build of the workbook definition these answers were written against.
  -- Lets the UI warn the learner if the questions changed under them.
  definition_version TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_idx)
);

CREATE INDEX IF NOT EXISTS workbook_entries_user_idx ON public.workbook_entries (user_id);

-- Guard against a scripted client pushing an unbounded blob into the row.
-- 200KB of JSON is far more than a hand-typed workbook can ever reach.
ALTER TABLE public.workbook_entries
  DROP CONSTRAINT IF EXISTS workbook_entries_answers_size;
ALTER TABLE public.workbook_entries
  ADD CONSTRAINT workbook_entries_answers_size
  CHECK (pg_column_size(answers) <= 200000);

ALTER TABLE public.workbook_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workbook_entries_own_select ON public.workbook_entries;
CREATE POLICY workbook_entries_own_select ON public.workbook_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS workbook_entries_own_insert ON public.workbook_entries;
CREATE POLICY workbook_entries_own_insert ON public.workbook_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS workbook_entries_own_update ON public.workbook_entries;
CREATE POLICY workbook_entries_own_update ON public.workbook_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS workbook_entries_own_delete ON public.workbook_entries;
CREATE POLICY workbook_entries_own_delete ON public.workbook_entries
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Admin read-only, same pattern as the other admin-select policies.
DROP POLICY IF EXISTS workbook_entries_admin_select ON public.workbook_entries;
CREATE POLICY workbook_entries_admin_select ON public.workbook_entries
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- anon gets no policy at all: the course is paid content.

CREATE OR REPLACE FUNCTION public.touch_workbook_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workbook_entries_touch ON public.workbook_entries;
CREATE TRIGGER workbook_entries_touch
  BEFORE UPDATE ON public.workbook_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_workbook_entries();
