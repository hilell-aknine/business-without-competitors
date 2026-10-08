-- ============================================================================
-- 011: lesson_notes + note_docs - timestamped notes and living documents
-- ============================================================================
-- Added 2026-10-08. Replaces the per-lesson textarea that lived only in
-- localStorage (bwc_notes_<lessonKey>) and never reached the server. The old
-- user_notes table from migration 001 was created but no code ever wrote to
-- it; it is left untouched here.
--
-- Model:
--   note_docs     one row per "living document" the learner builds across the
--                 course (e.g. "customer LTV"). Only a title; the content IS
--                 the notes assigned to it.
--   lesson_notes  one row per note. Written during a lesson, stamped with the
--                 video position, optionally assigned to one document.
--
-- Ids are generated on the client (crypto.randomUUID) so a note written
-- offline keeps the same id when it is pushed later; upserts are idempotent.
--
-- Privacy: these are the learner's own words. Owner-only access, and unlike
-- the progress tables there is deliberately NO admin-select policy.
-- NOTE: keep all SQL comments ASCII-only (Hebrew comments break the editor).

-- 1. note_docs ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.note_docs (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Target of the composite FK below: a note may only point at a document
  -- owned by the same user.
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS note_docs_user_idx ON public.note_docs (user_id);

-- 2. lesson_notes ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_notes (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Same vocabulary as course_progress: m{mi}-{wi}-{di} or s{si}-{pi}.
  lesson_key    TEXT NOT NULL CHECK (lesson_key ~ '^(m[0-9]+-[0-9]+-[0-9]+|s[0-9]+-[0-9]+)$'),
  -- Position in the video when the learner started writing. NULL when the
  -- player could not report it (API blocked) or for notes migrated from the
  -- old textarea, which never had one.
  video_seconds INTEGER CHECK (video_seconds IS NULL OR (video_seconds >= 0 AND video_seconds <= 86400)),
  -- Instructor cut (Tamar / Tzvika) the position belongs to. NULL = no variants.
  variant       SMALLINT CHECK (variant IS NULL OR (variant >= 0 AND variant <= 9)),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  doc_id        UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite FK: the document must belong to the same user. Deleting the
  -- document only un-assigns its notes (doc_id -> NULL, user_id kept).
  CONSTRAINT lesson_notes_doc_fk
    FOREIGN KEY (doc_id, user_id) REFERENCES public.note_docs (id, user_id)
    ON DELETE SET NULL (doc_id)
);

CREATE INDEX IF NOT EXISTS lesson_notes_user_idx ON public.lesson_notes (user_id);
CREATE INDEX IF NOT EXISTS lesson_notes_doc_idx  ON public.lesson_notes (doc_id) WHERE doc_id IS NOT NULL;

-- 3. RLS: owner full CRUD, nobody else ------------------------------------
ALTER TABLE public.note_docs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_docs_own_select ON public.note_docs;
CREATE POLICY note_docs_own_select ON public.note_docs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS note_docs_own_insert ON public.note_docs;
CREATE POLICY note_docs_own_insert ON public.note_docs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS note_docs_own_update ON public.note_docs;
CREATE POLICY note_docs_own_update ON public.note_docs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS note_docs_own_delete ON public.note_docs;
CREATE POLICY note_docs_own_delete ON public.note_docs
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS lesson_notes_own_select ON public.lesson_notes;
CREATE POLICY lesson_notes_own_select ON public.lesson_notes
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS lesson_notes_own_insert ON public.lesson_notes;
CREATE POLICY lesson_notes_own_insert ON public.lesson_notes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS lesson_notes_own_update ON public.lesson_notes;
CREATE POLICY lesson_notes_own_update ON public.lesson_notes
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS lesson_notes_own_delete ON public.lesson_notes;
CREATE POLICY lesson_notes_own_delete ON public.lesson_notes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- anon gets no policy at all.

-- 4. Server-owned updated_at -------------------------------------------------
-- The client sends its own updated_at for offline ordering, but the stored
-- value is always the server clock, so a device with a wrong clock cannot
-- pin a row in the future.
CREATE OR REPLACE FUNCTION public.touch_updated_at_notes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS note_docs_touch ON public.note_docs;
CREATE TRIGGER note_docs_touch
  BEFORE INSERT OR UPDATE ON public.note_docs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_notes();

DROP TRIGGER IF EXISTS lesson_notes_touch ON public.lesson_notes;
CREATE TRIGGER lesson_notes_touch
  BEFORE INSERT OR UPDATE ON public.lesson_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at_notes();
