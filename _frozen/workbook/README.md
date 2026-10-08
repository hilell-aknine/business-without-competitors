# Frozen: in-portal workbook (2026-09-14, frozen 2026-10-08)

Hillel's decision (2026-10-08): the "living documents" notes feature replaces
this direction. Kept, not deleted, in case it comes back.

What is here, exactly as it was left (never committed before, never run):

- `010_workbook_entries.sql` - table `workbook_entries` (one JSONB answer map
  per user per module, five building blocks). Was never applied to the live DB.
  Its RLS/trigger pattern was the template for migration 011 (lesson_notes +
  note_docs).
- `build-workbook-kb.mjs` - turns the plaintext transcripts into
  `api/_kb/workbook-m<idx>.json` (per-lesson concept cards, then a module
  workbook). Its per-lesson cache is still at `tools/.workbook-cache/`
  (gitignored, local only).

Never built: `api/workbook.js` and any UI.

To revive: move the script back to `tools/` (its imports are relative to
that folder), give the migration the next free number in
`supabase/migrations/`, then build the endpoint and the page.

This folder is excluded from both deploys: GitHub Pages runs Jekyll, which
skips `_`-prefixed folders, and `.vercelignore` lists `/_frozen/`.
