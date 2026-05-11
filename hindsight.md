# Hindsight — עסק ללא מתחרים
> Lessons learned the hard way. Read this BEFORE starting any task.

## Format
Each entry follows:
```
### [Short Title]
- **Date:** YYYY-MM-DD
- **Problem:** What went wrong
- **Root Cause:** Why it happened
- **Fix:** How it was resolved
- **Rule:** The rule to prevent recurrence
```

## Entries

### Hebrew paths break file operations
- **Date:** 2026-04-26
- **Problem:** Edit tool failed with "File does not exist" on Hebrew path with backslashes
- **Root Cause:** Windows path with Hebrew characters + backslashes not handled correctly by some tools
- **Fix:** Use forward slashes (`C:/Users/saraa/OneDrive/שולחן העבודה/...`) consistently
- **Rule:** Always use forward slashes in file paths, even on Windows. Never use `C:\`.

### NLP game data — commas and wrongExplanations
- **Date:** 2026-04-26 (learned from beit-vmetaplim hindsight)
- **Problem:** Missing commas in game data JS files break the entire game silently
- **Root Cause:** No linter catches syntax errors in standalone JS data files
- **Fix:** Every property line MUST end with comma. `wrongExplanations` MUST be array with `null` at correct index.
- **Rule:** When creating game data files: (1) always trail with comma, (2) `wrongExplanations` is array where `null` marks correct answer position, (3) test in browser console after editing.

### Hebrew in SQL `--` comments breaks Supabase SQL editor
- **Date:** 2026-05-11
- **Problem:** Migration failed with `syntax error at or near "Initial"` on the very first comment line `-- Initial schema — עסק ללא מתחרים`.
- **Root Cause:** Supabase SQL editor (Monaco) is bidi-aware. When a `--` line-comment contains Hebrew, the visual order flips: the `--` marker ends up at the END of the visual line instead of the start. The parser still reads logical order, but the rendered text shown in the error message displayed the Hebrew reversed and the `--` after the words — making it look like the parser saw `Initial schema...` as code. Either way: don't mix RTL text with `--` markers.
- **Fix:** Strip all Hebrew from `--` comments. Use ASCII-only comments inside `.sql` files that will run in the Supabase SQL editor.
- **Rule:** SQL files for Supabase: comments in English only. Hebrew belongs in the `README.md` next to the file, not inside the SQL.

### `:not()` boosts specificity — global rules can pin header z-index
- **Date:** 2026-05-10
- **Problem:** Navbar 3-dot dropdown opened but was hidden behind hero card. Header had `.v1-header{z-index:60}` declared inline; should have rendered above `.g` (z-index:1). It didn't.
- **Root Cause:** The global rule `body > *:not(.atmos){position:relative;z-index:1}` has specificity (0,1,1) because `:not(.atmos)` adds (0,1,0) for the class inside it. That beats `.v1-header` at (0,1,0) and pinned the header to z-index:1, same as `.g`. Same z-index siblings stack by source order, so `.g` (later in DOM) painted on top of any dropdown overflowing the header. Plus: `<style>` in `index.html` loads AFTER `navbar-more.css`, so a same-specificity selector in the CSS file loses to the inline rule.
- **Fix:** Added `body > .v1-header{z-index: var(--z-sticky, 60) !important}` in `css/navbar-more.css`. `!important` is required because of the load order, not because of specificity.
- **Rule:** When any styling refuses to apply on this project, check for `body > *:not(...)` patterns FIRST — they're (0,1,1), not (0,0,1). Also: inline `<style>` in index.html beats imported stylesheets at equal specificity. For overrides scoped to a feature CSS file, prefer `!important` over chasing specificity wars across files.
