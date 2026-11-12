/* ==========================================================================
   game-data-fixture.js — TEST DATA ONLY. Not course content.

   Loaded by js/game-data.js when the URL has ?fixture=1 or when no real
   module file exists. Two modules so the lock rules can be exercised:
     module 1: lesson 1 has one exercise of every type (7), lesson 2 has 3
     module 2: one short lesson
   Lesson keys start with "fx" so they can never collide with a real lesson,
   and the engine saves fixture progress under its own localStorage key.
   Every sentence here is invented for the test. Nothing is quoted from a
   lesson.
   ========================================================================== */
window.GAME_FIXTURE_MODULES = [
  {
    id: 1,
    moduleIdx: 0,
    title: "מודול בדיקה ראשון",
    description: "נתוני בדיקה בלבד. שני שיעורים קצרים.",
    icon: "fa-flask",
    image: "assets/game/banners/module-1.webp",
    lessons: [
      {
        id: 1,
        lessonKey: "fx0-0-0",
        title: "שיעור בדיקה: כל סוגי התרגילים",
        reading: {
          paragraphs: [
            "זהו קטע קריאה לדוגמה. הוא מופיע לפני התרגילים ומכיל מונח מפתח אחד שאפשר להקיש עליו.",
            "פסקה שנייה לדוגמה. כאן בודקים שהטקסט נשבר יפה גם במסך צר."
          ],
          keyTerms: [
            { term: "מונח מפתח", definition: "הגדרה לדוגמה שמופיעה כשמקישים על המונח." }
          ]
        },
        exercises: [
          {
            type: "multiple-choice",
            question: "בדיקה: איזו תשובה מסומנת כנכונה?",
            options: ["תשובה ראשונה", "תשובה שנייה (הנכונה)", "תשובה שלישית", "תשובה רביעית"],
            correct: 1,
            explanation: "הסבר לדוגמה אחרי התשובה.",
            wrongExplanations: ["הסבר לטעות ראשונה.", null, "הסבר לטעות שלישית.", "הסבר לטעות רביעית."],
            src: { quote: "ציטוט לדוגמה לשאלת הבחירה", lessonKey: "fx0-0-0" }
          },
          {
            type: "scenario",
            question: "בדיקה: מה עושים בתרחיש הזה?",
            context: "הקשר לדוגמה. לקוח מבקש הצעת מחיר ומשווה אתכם לאחרים.",
            options: ["פעולה ראשונה (הנכונה)", "פעולה שנייה", "פעולה שלישית", "פעולה רביעית"],
            correct: 0,
            explanation: "הסבר לדוגמה לתרחיש.",
            wrongExplanations: [null, "הסבר לטעות שנייה.", "הסבר לטעות שלישית.", "הסבר לטעות רביעית."],
            src: { quote: "ציטוט לדוגמה לתרחיש", lessonKey: "fx0-0-0" }
          },
          {
            type: "improve",
            question: "בדיקה: איזה ניסוח משפר את המשפט?",
            original: "אנחנו נותנים שירות טוב.",
            options: ["ניסוח ראשון", "ניסוח שני", "ניסוח שלישי (הנכון)", "ניסוח רביעי"],
            correct: 2,
            explanation: "הסבר לדוגמה לשיפור הניסוח.",
            wrongExplanations: ["הסבר לטעות ראשונה.", "הסבר לטעות שנייה.", null, "הסבר לטעות רביעית."],
            src: { quote: "ציטוט לדוגמה לשיפור", lessonKey: "fx0-0-0" }
          },
          {
            type: "fill-blank",
            question: "בדיקה: השלימו את המשפט.",
            template: "המילה החסרה היא ___ ולא אחרת.",
            options: ["נכונה", "שגויה", "אחרת", "רביעית"],
            correct: 0,
            explanation: "הסבר לדוגמה להשלמה.",
            wrongExplanations: [null, "הסבר לטעות שנייה.", "הסבר לטעות שלישית.", "הסבר לטעות רביעית."],
            src: { quote: "ציטוט לדוגמה להשלמה", lessonKey: "fx0-0-0" }
          },
          {
            type: "compare",
            question: "בדיקה: איזה ניסוח חזק יותר?",
            optionA: { label: "ניסוח א׳", text: "ניסוח כללי בלי פרטים." },
            optionB: { label: "ניסוח ב׳", text: "ניסוח מדויק עם מספר ותאריך (הנכון)." },
            correct: 1,
            explanation: "הסבר לדוגמה להשוואה.",
            wrongExplanations: ["הסבר לטעות בניסוח א׳.", null],
            src: { quote: "ציטוט לדוגמה להשוואה", lessonKey: "fx0-0-0" }
          },
          {
            type: "order",
            question: "בדיקה: סדרו את השלבים מהראשון לאחרון.",
            items: ["שלב ראשון", "שלב שני", "שלב שלישי", "שלב רביעי"],
            correctOrder: [0, 1, 2, 3],
            explanation: "הסבר לדוגמה לסידור.",
            wrongExplanations: [null],
            src: { quote: "ציטוט לדוגמה לסידור", lessonKey: "fx0-0-0" }
          },
          {
            type: "match",
            question: "בדיקה: התאימו כל מושג להגדרה שלו.",
            pairs: [
              { left: "מושג א׳", right: "הגדרה א׳" },
              { left: "מושג ב׳", right: "הגדרה ב׳" },
              { left: "מושג ג׳", right: "הגדרה ג׳" }
            ],
            explanation: "הסבר לדוגמה להתאמה.",
            wrongExplanations: [null],
            src: { quote: "ציטוט לדוגמה להתאמה", lessonKey: "fx0-0-0" }
          }
        ]
      },
      {
        id: 2,
        lessonKey: "fx0-0-1",
        title: "שיעור בדיקה שני",
        reading: {
          paragraphs: ["קטע קריאה קצר לשיעור השני."],
          keyTerms: []
        },
        exercises: [
          {
            type: "multiple-choice",
            question: "בדיקה שנייה: בחרו בתשובה הראשונה.",
            options: ["הנכונה", "שגויה א׳", "שגויה ב׳", "שגויה ג׳"],
            correct: 0,
            explanation: "הסבר לדוגמה.",
            wrongExplanations: [null, "טעות א׳.", "טעות ב׳.", "טעות ג׳."],
            src: { quote: "ציטוט לדוגמה", lessonKey: "fx0-0-1" }
          },
          {
            type: "fill-blank",
            question: "בדיקה שנייה: השלימו.",
            template: "כאן חסרה ___ אחת.",
            options: ["מילה", "אות", "שורה", "פסקה"],
            correct: 0,
            explanation: "הסבר לדוגמה.",
            wrongExplanations: [null, "טעות א׳.", "טעות ב׳.", "טעות ג׳."],
            src: { quote: "ציטוט לדוגמה", lessonKey: "fx0-0-1" }
          },
          {
            type: "compare",
            question: "בדיקה שנייה: מה חזק יותר?",
            optionA: { label: "א׳", text: "הנכון." },
            optionB: { label: "ב׳", text: "השגוי." },
            correct: 0,
            explanation: "הסבר לדוגמה.",
            wrongExplanations: [null, "טעות."],
            src: { quote: "ציטוט לדוגמה", lessonKey: "fx0-0-1" }
          }
        ]
      }
    ]
  },
  {
    id: 2,
    moduleIdx: 1,
    title: "מודול בדיקה שני",
    description: "נפתח רק אחרי שמסיימים את המודול הראשון.",
    icon: "fa-vial",
    image: "assets/game/banners/module-2.webp",
    lessons: [
      {
        id: 1,
        lessonKey: "fx1-0-0",
        title: "שיעור בדיקה במודול השני",
        reading: {
          paragraphs: ["קטע קריאה קצר למודול השני."],
          keyTerms: []
        },
        exercises: [
          {
            type: "multiple-choice",
            question: "בדיקה במודול השני: בחרו בתשובה השנייה.",
            options: ["שגויה א׳", "הנכונה", "שגויה ב׳", "שגויה ג׳"],
            correct: 1,
            explanation: "הסבר לדוגמה.",
            wrongExplanations: ["טעות א׳.", null, "טעות ב׳.", "טעות ג׳."],
            src: { quote: "ציטוט לדוגמה", lessonKey: "fx1-0-0" }
          }
        ]
      }
    ]
  }
];
