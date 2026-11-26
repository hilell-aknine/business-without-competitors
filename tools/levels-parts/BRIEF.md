# Writing level 2 and level 3 practice content (one week of one module)

You write Hebrew practice-game content for a learning portal. You are given a module number `N` (2-8) and a week index `W` (0, 1 or 2). You write ONE file:

`tools/levels-parts/m<N>-w<W>.json`

Work only in the git worktree `C:/AtomicBusiness/_wt/bnc-game-levels` (forward slashes always). Create only that one file. Do not edit any other file, do not commit, do not push. Other writers are working on other weeks at the same time: never touch their part files.

## What exists
- Level 1 of the module: `js/game-data-m<N>.js` (`window.GAME_MODULE_<N>`). Each lesson has `lessonKey` (for example `m1-0-2`: game module N holds keys `m<N-1>-<week>-<day>`), a `reading`, `keyTerms`, and 6 exercises with `src: { quote, lessonKey }`. Read the lessons of your week there first: tone, plural address ("בחרו", "סדרו"), what each lesson teaches, which quotes are already used.
- A finished reference for what you are writing: `js/game-data-l2-m1.js`, `js/game-data-l3-m1.js`, `api/_game/l3-m1.json` (module 1). Read one or two lessons of each to see the expected quality and shapes.
- Your lessons: `node tools/lesson-transcript.mjs --keys <N>` lists the lesson keys by week. You write every lesson of week `W`.
- A lesson's transcript: `node tools/lesson-transcript.mjs <lessonKey>`. Read ONE lesson's transcript at a time, write that lesson, then move on. The transcripts are auto-captions without punctuation.
- Finding an exact line: `node tools/lesson-transcript.mjs --find <lessonKey> "כמה מילים"`.

## The file you write (strict JSON, UTF-8, double quotes)
```json
{
  "l2":     { "<lessonKey>": [ 6 exercises ], ... },
  "l3":     { "<lessonKey>": [ 3 tasks ], ... },
  "rubric": { "<lessonKey>": [ 3 rubrics ], ... }
}
```
Write the file after each lesson (add the lesson and save), so finished lessons are never lost.

## Level 2: six exercises per lesson (application, no AI)
Every exercise has `type`, `question`, `explanation`, `src: { "quote": "...", "lessonKey": "<this lesson>" }`.
- `sort`: `buckets: ["קטגוריה א", "קטגוריה ב"]`, `items: [{ "text", "bucket": 0|1 }]` 4-6 items, at least 2 in each bucket.
- `true-false`: `statements: [{ "text", "answer": true|false, "why" }]` exactly 4, both true and false present. `why` = one sentence, according to the lesson.
- `quote-cloze`: `template` = a sentence copied word for word from the transcript with exactly one `___` in place of ONE meaningful word or short phrase; `options` 4 unique strings; `correct` index; `wrongExplanations`: 4 entries, `null` at the correct index and a short reason elsewhere. The validator fills the blank with `options[correct]` and requires the completed sentence to appear in the transcript word for word, so add nothing and change nothing. `src.quote` is that same line.
- `spot-error`: `sentences`: exactly 4 short statements about the lesson, three true and ONE false; `wrong`: index of the false one; `fix`: the true version of it.
- `memory`: `pairs: [{ "left", "right" }]` exactly 4. left = a term (at most 5 words), right = its meaning in the lesson (at most 14 words). No duplicates.
- `decision`: `context` (a concrete business situation, 1-3 sentences), `steps`: 2-3 of `{ "prompt", "options": [2-3 strings], "correct", "why": [one reason per option] }`. Each step follows from the previous correct choice.

Rules per lesson: exactly 6 exercises, at least 4 different types, no type more than twice (one of each type is the default; vary the order between lessons). Each exercise has a DIFFERENT `src.quote`, 8-30 words, copied exactly from that lesson's transcript; at most 2 of the 6 may reuse a quote level 1 already uses. Level 2 is APPLICATION: situations from the working life of a small business owner (coaches, therapists, consultants, course creators), not recall of wording (quote-cloze is the one recall type). Stay faithful to the lesson: no outside knowledge, no claims the lecturer did not make, no invented examples presented as the lecturer's. Vary the position of the correct answer.

## Level 3: three open tasks per lesson, judged later by an AI
In this order:
1. `{ "kind": "explain", "title", "prompt" }`: explain a core idea of the lesson in your own words, as if to a colleague, with one example.
2. `{ "kind": "roleplay", "title", "prompt", "persona", "opening" }`: the AI plays a character relevant to the lesson (a sceptical client, a partner, a tired employee...). `prompt` says what the learner must achieve in the conversation using the lesson's idea. `persona` (at most 30 words) describes the character. `opening` (at most 40 words) is the character's first line, in first person.
3. `{ "kind": "apply", "title", "prompt" }`: apply the lesson to the learner's OWN business, with a concrete output (a sentence, a decision, a plan for this week).

`title`: 1-7 words. `prompt`: 12-70 words. No rubric fields here.

`rubric[lessonKey]` is an array of 3 objects aligned with the tasks: `{ "criteria": ["...", "...", "..."] }`, exactly 3 concrete, checkable criteria each (what a good answer must contain, per the lesson). The roleplay rubric (index 1) also has `"stance"`: what the character resists, and what kind of move, per the lesson, would genuinely convince them.

## Language rules (the validator fails on these)
- Hebrew, plural address to the learner (בחרו, כתבו, הסבירו), as in level 1.
- No em dash and no en dash anywhere. Use a comma, a period or a colon.
- Never the standalone word "רם".
- Plain direct Hebrew. No marketing fluff.
- Where the captions misspell a term, learner-facing text uses the spelling level 1 uses; quotes keep the transcript's spelling.

## Verify (mandatory, repeat until clean)
From the worktree root:
```
node tools/assemble-game-levels.mjs <N>
LEVELS_PARTIAL=1 node tools/check-game-levels.mjs <N>
```
In PowerShell set the variable first: `$env:LEVELS_PARTIAL='1'`. In Git Bash the line works as written.
Every `FAIL` line that names one of YOUR lesson keys must be fixed (lines for other weeks belong to other writers: ignore them). The most common failure is a quote that is not word for word: take it from the transcript with `--find`, do not retype it. On this machine do not pipe Hebrew through a heredoc into node or python (it is mangled): write a script file and run it, and write the JSON with the Write tool.

## Report back (short)
Your lesson keys; the validator lines for them (0 failures expected); counts per type; any lesson whose transcript was too thin for six good application exercises and what you did; anything in the lesson content that looked inconsistent or garbled. Do not paste the data.
