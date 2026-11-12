# Practice game artwork

Every image path that `js/game.js` and `css/game.css` reference, relative to
`assets/game/`. The game works without any of them: a missing file falls back
to a Font Awesome icon on a brand-coloured tile (or, for banners, to the brand
gradient), never to a broken-image icon.

All files are `.webp`. Square unless noted. Sizes are the largest size the file
is displayed at, times two for sharp screens.

Status on 2026-11-12: the eight banners exist. Everything else is still to be
generated.

## Banners (module screen header, home path thumbnail)

16:9, about 1024x576. Text sits on the lower half over a dark scrim, so keep
the subject in the upper half. The same file is cropped to a 48px square
thumbnail on the home path (centre crop).

| File | Used for |
|------|----------|
| `banners/module-1.webp` | Module 1 |
| `banners/module-2.webp` | Module 2 |
| `banners/module-3.webp` | Module 3 |
| `banners/module-4.webp` | Module 4 |
| `banners/module-5.webp` | Module 5 |
| `banners/module-6.webp` | Module 6 |
| `banners/module-7.webp` | Module 7 |
| `banners/module-8.webp` | Module 8 |

The home path thumbnail comes from the `image` field of each module in
`js/game-data-m<N>.js` (currently the same banner file). The module header
always uses `banners/module-<id>.webp`.

## Exercise type icons (small label above each question)

Shown at 24px, rounded corners. Export 96x96.

| File | Exercise type |
|------|---------------|
| `exercises/multiple-choice.webp` | Choice question |
| `exercises/scenario.webp` | Scenario |
| `exercises/improve.webp` | Improve the wording |
| `exercises/fill-blank.webp` | Fill in the blank |
| `exercises/compare.webp` | Which is stronger |
| `exercises/order.webp` | Put in order |
| `exercises/match.webp` | Match pairs |

## Feedback

| File | Shown | Display size | Export |
|------|-------|--------------|--------|
| `feedback/correct.webp` | Feedback panel, correct answer | 40px circle | 160x160 |
| `feedback/wrong.webp` | Feedback panel, wrong answer | 40px circle | 160x160 |
| `feedback/combo-3.webp` | Combo popup, 3 or 4 in a row | 22px circle | 96x96 |
| `feedback/combo-5.webp` | Combo popup, 5 or more in a row | 22px circle | 96x96 |

The feedback panel is solid green or solid red, so these sit on a coloured
background.

## Levels

Shown at 148px in the level-up overlay (always on a dark background), at 72px
as the profile avatar (circle crop) and at 28px on the home level card. Export
512x512.

| File | Level name |
|------|------------|
| `levels/level-1.webp` | מתחילים |
| `levels/level-2.webp` | לומדים |
| `levels/level-3.webp` | מתרגלים |
| `levels/level-4.webp` | מיישמים |
| `levels/level-5.webp` | מובילים |
| `levels/level-6.webp` | חדשנים |
| `levels/level-7.webp` | משפיעים |
| `levels/level-8.webp` | אטומיים |

## Achievement badges

Shown at 36px (grid) and 44px (popup), circle crop. Export 256x256. The file
name is the achievement id.

| File | Achievement |
|------|-------------|
| `badges/first_lesson.webp` | צעד ראשון: first lesson completed |
| `badges/five_lessons.webp` | נכנסים לקצב: 5 lessons |
| `badges/ten_lessons.webp` | בדרך הנכונה: 10 lessons |
| `badges/twenty_lessons.webp` | לומדים ברצינות: 20 lessons |
| `badges/module_done.webp` | מודול שלם: one whole module |
| `badges/streak_3.webp` | התמדה: 3 days in a row |
| `badges/perfect_lesson.webp` | שיעור מושלם: a lesson with no mistakes |
| `badges/xp_500.webp` | צוברים ניסיון: 500 XP |
| `badges/streak_7.webp` | שבוע מלא: 7 days in a row |
| `badges/streak_30.webp` | מחויבות: 30 days in a row |
| `badges/xp_1000.webp` | אלף ראשון: 1000 XP |
| `badges/accuracy_80.webp` | דיוק גבוה: 80% accuracy after 20 answers |
| `badges/all_lessons.webp` | עסק ללא מתחרים: every lesson of the course |

## Screens

| File | Shown | Display size | Export |
|------|-------|--------------|--------|
| `screens/lesson-complete.webp` | Lesson completion screen | 148px, rounded | 512x512 |
| `screens/module-complete.webp` | Completion screen when the lesson closes a module | 148px, rounded | 512x512 |
| `screens/no-hearts.webp` | "Out of hearts" dialog | 116px, rounded | 512x512 |

## Onboarding (first visit, three steps)

Shown at 148px, rounded. Export 512x512.

| File | Step |
|------|------|
| `onboarding/step-1.webp` | Welcome to the practice |
| `onboarding/step-2.webp` | Read, then answer |
| `onboarding/step-3.webp` | Earn XP, keep a streak |

## Not used by the new game

The files directly under `assets/game/` (`unit-*.webp`, `axis-*.webp`,
`crest-*.webp`) and `assets/game/_src/` belong to the old practice page
(`pages/practice.html`). The new game does not load them.
