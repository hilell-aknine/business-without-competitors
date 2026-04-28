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
