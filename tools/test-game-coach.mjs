#!/usr/bin/env node
// Unit tests for the pure parts of api/game-coach.js (api/_lib/game-coach-core.js).
// No network, no database, no dependencies.
//
//   node tools/test-game-coach.mjs
//
// All Hebrew sentences below are invented for the test. The "verified quotes"
// are test strings, not lines from a lesson.

import * as core from '../api/_lib/game-coach-core.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}`); }
}
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);

// ------------------------------------------------------------ pass rule
{
  const p = (s) => core.passRule(s).passed;
  ok(p([2, 2, 2]) === true, 'pass 2,2,2');
  ok(p([2, 2, 0]) === true, 'pass 2,2,0 (sum 4, one zero)');
  ok(p([2, 1, 1]) === true, 'pass 2,1,1');
  ok(p([1, 1, 1]) === false, 'fail 1,1,1 (sum 3)');
  ok(p([2, 1, 0]) === false, 'fail 2,1,0 (sum 3)');
  ok(p([2, 0, 0]) === false, 'fail 2,0,0 (two zeros)');
  ok(p([0, 0, 0]) === false, 'fail 0,0,0');
  eq(core.passRule([2, 1, 2]), { passed: true, score: 5, max: 6, valid: true }, 'score and max');
  ok(core.passRule([2, 2]).valid === false && !p([2, 2]), 'two scores are not a verdict');
  ok(!p([3, 3, 3]) && !p([2, 2, 1.5]) && !p(['2', '2', '2']) && !p(null), 'out of range / non-integer / strings / null never pass');
  // Every combination: the rule is exactly "sum >= 4 and at most one zero".
  let all = true;
  for (const a of [0, 1, 2]) for (const b of [0, 1, 2]) for (const c of [0, 1, 2]) {
    const want = a + b + c >= 4 && [a, b, c].filter(n => n === 0).length <= 1;
    if (p([a, b, c]) !== want) all = false;
  }
  ok(all, 'all 27 score combinations follow the rule');
}

// ------------------------------------------------------ JSON extraction
{
  eq(core.extractJson('{"a":1}'), { a: 1 }, 'plain object');
  eq(core.extractJson('הנה התשובה:\n```json\n{"a":[1,2],"b":"x"}\n```\nבהצלחה'), { a: [1, 2], b: 'x' }, 'object inside a code fence with prose');
  eq(core.extractJson('{"scores":[2,1,0],"good":"טוב","fix":"לשפר",}'), { scores: [2, 1, 0], good: 'טוב', fix: 'לשפר' }, 'trailing comma is repaired');
  eq(core.extractJson('{"t":"סוגר } בתוך מחרוזת ו\\"מרכאות\\""} ועוד {"b":2}'), { t: 'סוגר } בתוך מחרוזת ו"מרכאות"' }, 'braces and quotes inside a string, first block wins');
  eq(core.extractJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }], 'top-level array');
  ok(core.extractJson('אין כאן JSON') === null, 'no JSON gives null');
  ok(core.extractJson('{"a": 1') === null, 'cut object gives null');
  ok(core.extractJson('') === null && core.extractJson(null) === null, 'empty input gives null');
  eq(core.extractJson('{לא json} ואז {"ok":true}'), { ok: true }, 'skips a block that is not JSON');

  eq(core.salvageObjects('{"exercises":[{"a":1},{"b":{"c":2}},{"d":"חתו'), [{ a: 1 }, { b: { c: 2 } }], 'salvage complete objects from a cut array');
  eq(core.salvageObjects('nothing'), [], 'salvage on text without an array');

  const v = core.parseVerdict('```json\n{"scores":[2,1,0],"good":"הסברתם את הרעיון","fix":"הוסיפו דוגמה"}\n```');
  eq(v, { scores: [2, 1, 0], good: 'הסברתם את הרעיון', fix: 'הוסיפו דוגמה' }, 'verdict parsed');
  eq(core.parseVerdict('{"scores":["2","1","0"],"good":"א","fix":"ב"}').scores, [2, 1, 0], 'digit strings are accepted as scores');
  ok(core.parseVerdict('{"scores":[2,1],"good":"א","fix":"ב"}') === null, 'two scores rejected');
  ok(core.parseVerdict('{"scores":[2,1,3],"good":"א","fix":"ב"}') === null, 'score 3 rejected');
  ok(core.parseVerdict('{"scores":[2,1,1.5],"good":"א","fix":"ב"}') === null, 'score 1.5 rejected, not rounded');
  ok(core.parseVerdict('{"scores":[2,1,1],"good":"","fix":"ב"}') === null, 'empty good rejected');
  ok(core.parseVerdict('{"scores":[2,1,1],"good":"א"}') === null, 'missing fix rejected');
  ok(core.parseVerdict('[2,2,2]') === null, 'bare array is not a verdict');
  ok(core.parseVerdict('{"passed":true}') === null, 'a "passed" claim alone is not a verdict');
  ok(!('passed' in core.parseVerdict('{"scores":[0,0,0],"passed":true,"good":"א","fix":"ב"}')), 'a "passed" field from the model is dropped');
}

// ------------------------------------------------------ history cleaning
{
  const u = (content) => ({ role: 'user', content });
  const a = (content) => ({ role: 'assistant', content });
  eq(core.cleanHistory([u('  שלום  ')]), { ok: true, messages: [u('שלום')] }, 'one user message, trimmed');
  eq(core.cleanHistory([a('פתיחה'), u('תשובה')]).messages, [u('תשובה')], 'a leading assistant message is dropped');
  eq(core.cleanHistory('x'), { ok: false, reason: 'bad_history' }, 'not an array');
  eq(core.cleanHistory([]), { ok: false, reason: 'empty_history' }, 'empty');
  eq(core.cleanHistory([a('רק דמות')]), { ok: false, reason: 'empty_history' }, 'only assistant messages');
  eq(core.cleanHistory([u('א'), a('ב')]), { ok: false, reason: 'last_message_must_be_user' }, 'must end with the learner');
  eq(core.cleanHistory([u('x'.repeat(2501))]).reason, 'answer_too_long', '2501 chars rejected');
  ok(core.cleanHistory([u('x'.repeat(2500))]).ok, '2500 chars accepted');
  eq(core.cleanHistory([u('ארוך'.repeat(700)), a('ב'), u('ג')]).reason, 'answer_too_long', 'an older over-long learner message is rejected too');
  const forged = core.cleanHistory([u('א'), a('y'.repeat(9000)), u('ב')]);
  ok(forged.ok && forged.messages[1].content.length === 2500, 'an over-long assistant message is clipped');
  const eleven = Array.from({ length: 11 }, (_, i) => (i % 2 ? a('ב') : u('א')));
  eq(core.cleanHistory(eleven).reason, 'history_too_long', '11 messages rejected');
  ok(core.cleanHistory(eleven.slice(0, 9)).ok, '9 messages accepted');
  const junk = core.cleanHistory([null, { role: 'system', content: 'x' }, { role: 'user', content: 5 }, u('   '), u('אמיתי')]);
  eq(junk.messages, [u('אמיתי')], 'junk entries, system role, non-strings and blanks are dropped');
  eq(core.learnerTurns([u('1'), a('x'), u('2'), a('y'), u('3')]), 3, 'learner turns counted');
}

// ------------------------------------------------------- persona cleaning
{
  eq(core.cleanPersonaReply('אני לא בטוחה שזה בשבילי.\n[[סוף-שיחה]]'), 'אני לא בטוחה שזה בשבילי.', 'marker stripped');
  eq(core.cleanPersonaReply('נשמע מעניין. {"scores":[2,2,2],"good":"x","fix":"y"}'), 'נשמע מעניין.', 'stray JSON stripped');
  eq(core.cleanPersonaReply('בסדר, שכנעת.\n[מחוץ לדמות]\nמשוב: היה מצוין'), 'בסדר, שכנעת.', 'everything after an out-of-character marker is dropped');
  eq(core.cleanPersonaReply('```json\n{"a":1}\n```\nאז מה ההבדל?'), 'אז מה ההבדל?', 'code fence stripped');
  eq(core.cleanPersonaReply('הדמות: כמה זה עולה?'), 'כמה זה עולה?', 'speaker label stripped');
  eq(core.cleanPersonaReply('[דמות] בסדר, שמעתי.'), 'בסדר, שמעתי.', 'bracketed speaker label stripped (seen on Haiku 5.5)');
  eq(core.cleanPersonaReply('(בדמות): טוב, נראה.'), 'טוב, נראה.', 'parenthesised speaker label stripped');
  eq(core.cleanPersonaReply('זה יקר — מאוד'), 'זה יקר, מאוד', 'em dash repaired');
  eq(core.cleanPersonaReply('חצי משפט [[סוף-שי'), 'חצי משפט', 'dangling marker stripped');
  ok(core.MARK_END.test('טוב.\n[[סוף-שיחה]]') && core.MARK_END.test('[[ סוף שיחה ]]') && !core.MARK_END.test('סוף שיחה'), 'end marker detection');
}

// --------------------------------------------------------------- text
{
  eq(core.sanitizeText('שלב 3–5 ואז — סיום'), 'שלב 3-5 ואז, סיום', 'dash repair keeps ranges');
  ok(core.breaksTextRules('כמו שאמר רם בשיעור') === 'ram' && core.breaksTextRules('זרם חזק') === null && core.breaksTextRules('א – ב') === 'dash', 'text rules');
  const Q = ['לא רואים תוצאות מיד כי מתחילים מהשורש של העסק'];
  eq(core.verifyGuillemets('נאמר «לא רואים תוצאות מיד כי מתחילים מהשורש» בשיעור', Q).text, 'נאמר «לא רואים תוצאות מיד כי מתחילים מהשורש» בשיעור', 'a verified quote keeps its guillemets');
  const inv = core.verifyGuillemets('המרצה אמר «תמיד תתחילו מהמחיר הגבוה ביותר» וזהו', Q);
  ok(inv.text === 'המרצה אמר תמיד תתחילו מהמחיר הגבוה ביותר וזהו' && inv.dropped === 1, 'an invented quote loses its guillemets');
  eq(core.verifyGuillemets('«מתחילים מהשורש» קצר מדי', Q).text, 'מתחילים מהשורש קצר מדי', 'a fragment under 4 words is not shown as a quote');
  eq(core.verifyGuillemets('סוגר בודד » נשאר', Q).text, 'סוגר בודד  נשאר', 'an unbalanced guillemet is removed');
}

// ------------------------------------------------- names and gender
{
  eq(core.stripLecturerNames('חזרו לקטע שבו צביקה מסביר, וגם שתמר אמרה'), 'חזרו לקטע שבו המרצה מסביר, וגם שהמרצה אמרה', 'lecturer names become "המרצה"');
  eq(core.stripLecturerNames('זרם התמרה תמרים'), 'זרם התמרה תמרים', 'words that only contain a name are untouched');
  const u = (content) => ({ role: 'user', content });
  ok(core.detectGender([u('אני מבינה את הלחץ שלך')]) === 'f', 'feminine first person detected');
  ok(core.detectGender([u('בלי סימן'), u('אבל אני לא חושבת שזה נכון')]) === 'f', 'feminine form in an earlier message counts (generic ת ending)');
  ok(core.detectGender([u('אני מבין, אבל אני חושב אחרת')]) === 'm', 'masculine first person detected');
  ok(core.detectGender([u('אני רוצה שנמשיך, אני רואה את זה אחרת')]) === null, 'forms spelled the same for both give null');
  ok(core.detectGender([u('אני אמרתי וכתבתי שזה לא נכון')]) === null, 'past tense first person is not a signal');
  ok(core.detectGender([u('אני מבינה'), u('אני מבין')]) === null, 'mixed signals give null');
  ok(core.detectGender([{ role: 'assistant', content: 'אני מבינה' }, u('טוב')]) === null, 'only learner messages are read');
  ok(core.personaNudge(false, 'f').includes('לשון נקבה בלבד') && core.personaNudge(true, null).includes('בלי פנייה מגדרית') && core.personaNudge(true, 'm').includes('התגובה האחרונה'), 'the persona nudge carries the decided gender');
  ok(core.personaNudge(false, 'f').startsWith('\n\n(') && core.personaNudge(false, 'f').endsWith(')') && !core.breaksTextRules(core.personaNudge(true, 'f')), 'the nudge stays one bracketed note');
}

// ------------------------------------------------------------ hint leak
{
  ok(core.hintLeaks('מה ההבדל בין הישרדות לבין התמדה?', { answer: 'ההישרדותי', guard: ['ההישרדותי'] }), 'the same word in another form leaks (seen on Haiku 5.5)');
  ok(!core.hintLeaks('חשבו על החלק במוח שמחפש תוצאות מהר', { answer: 'ההישרדותי', guard: ['ההישרדותי'] }), 'a hint that describes without the word passes');
  const single = { answer: 'טקטיקה', guard: ['טקטיקה'] };
  ok(core.hintLeaks('חשבו על טקטיקה מול אסטרטגיה', single), 'one-word answer inside the hint leaks');
  ok(core.hintLeaks('זה קשור לטקטיקה שלכם', single), 'one-word answer with a glued prefix leaks');
  ok(!core.hintLeaks('חשבו מה נדחה לשלב מאוחר יותר בתוכנית', single), 'a hint without the answer does not leak');
  const phrase = { answer: 'כי מתחילים מהשורש', guard: ['כי מתחילים מהשורש'] };
  ok(core.hintLeaks('הסיבה היא: כי מתחילים, מהשורש!', phrase), 'punctuation does not hide the answer');
  ok(core.hintLeaks('רמז: מהשורש מתחילים, זה כי כך בונים', phrase), 'reordered answer words leak');
  ok(!core.hintLeaks('חשבו מאיפה התהליך יוצא לדרך', phrase), 'a paraphrase-free hint passes');
  const multi = {
    answer: ['מוטיבציה של התחלה: נגמרת בשלב כלשהו', 'פתיחת התכנים: הדרגתית'],
    guard: ['נגמרת בשלב כלשהו', 'הדרגתית'],
  };
  ok(core.hintLeaks('זכרו שההתלהבות נגמרת בשלב כלשהו', multi), 'a 3+ word part of a multi-part answer leaks');
  ok(!core.hintLeaks('חשבו על קצב הדרגתית של דברים', multi), 'a short part (under 3 words) of a multi-part answer is not checked');
  ok(!core.hintLeaks('', single), 'empty hint does not leak');
  const two = { answer: 'כן', guard: ['כן'] };
  ok(core.hintLeaks('התשובה היא כן', two) && !core.hintLeaks('חשבו על הקשר לתוכנית', two), 'a 2-letter answer is matched as a whole word only');

  const lesson = { terms: [{ term: 'טקטיקה', definition: 'x' }, { term: 'סבלנות', definition: 'y' }] };
  const fb = core.safeHint(lesson, single);
  ok(fb.includes('סבלנות') && !core.hintLeaks(fb, single), 'the fallback hint skips a term that is the answer');
  const none = core.safeHint({ terms: [{ term: 'טקטיקה', definition: 'x' }] }, single);
  ok(none.length > 10 && !core.hintLeaks(none, single), 'the last-resort fallback does not leak');
  eq(core.cleanHint('משפט ראשון. משפט שני! משפט שלישי.'), 'משפט ראשון. משפט שני!', 'a hint is cut to two sentences');
}

// ------------------------------------------------- surprise validation
{
  const QUOTES = [
    'לא רואים תוצאות מיד כי מתחילים מהשורש של העסק ולא מהענפים',
    'מי שבא בגישה של חייב תוצאות מהר לא מצליח להתמיד לאורך זמן',
    'התכנים נפתחים בהדרגה ואי אפשר לצפות בהם ברצף אחד',
  ];
  const K = 'm0-0-0';
  const mc = () => ({
    type: 'multiple-choice', question: 'למה לא רואים תוצאות מיד?',
    options: ['כי מתחילים מהשורש', 'כי אין תקציב', 'כי צריך מזל', 'כי התכנים קשים'], correct: 0,
    explanation: 'בשיעור נאמר שמתחילים מהשורש.',
    wrongExplanations: [null, 'תקציב לא הוזכר.', 'מזל לא הוזכר.', 'הקושי לא הסיבה.'],
    src: { quote: QUOTES[0] },
  });
  const tf = () => ({
    type: 'true-false', question: 'סמנו נכון או לא נכון:',
    statements: [
      { text: 'מי שחייב תוצאות מהר מתמיד', answer: false, why: 'ההפך נאמר.' },
      { text: 'ההתמדה קשה למי שממהר', answer: true, why: 'כך נאמר.' },
      { text: 'התכנים נפתחים בבת אחת', answer: false, why: 'הם נפתחים בהדרגה.' },
      { text: 'צריך סבלנות', answer: true, why: 'כך עולה מהשיעור.' },
    ],
    explanation: 'השיעור מדבר על התמדה.',
    src: { quote: QUOTES[1] },
  });
  const cloze = () => ({
    type: 'quote-cloze', question: 'השלימו את המשפט:',
    template: 'התכנים נפתחים ___ ואי אפשר לצפות בהם ברצף אחד',
    options: ['בבת אחת', 'בהדרגה', 'פעם בשנה', 'לפי בקשה'], correct: 1,
    explanation: 'הפתיחה הדרגתית.',
    wrongExplanations: ['ההפך נאמר.', null, 'לא נאמר.', 'לא נאמר.'],
    src: { quote: QUOTES[2] },
  });
  const V = (ex) => core.validateSurpriseExercise(ex, QUOTES, K);
  const bad = (ex, reason, label) => { const r = V(ex); ok(!r.ok && r.reason === reason, `${label} (got ${r.ok ? 'ok' : r.reason})`); };
  const mod = (make, fn) => { const e = make(); fn(e); return e; };

  // valid
  const rmc = V(mc());
  ok(rmc.ok && rmc.exercise.src.quote === QUOTES[0] && rmc.exercise.src.lessonKey === K, 'valid multiple-choice, lessonKey set by the server');
  ok(V(tf()).ok, 'valid true-false');
  ok(V(cloze()).ok, 'valid quote-cloze (whole quote)');
  const canon = V(mod(mc, e => { e.src.quote = ' «לא רואים תוצאות מיד, כי מתחילים מהשורש של העסק — ולא מהענפים.» '; }));
  ok(canon.ok && canon.exercise.src.quote === QUOTES[0], 'a quote that differs only in punctuation is replaced by the canonical string');
  const extra = V(mod(mc, e => { e.hack = '<script>'; e.src.lessonKey = 'm9-9-9'; }));
  ok(extra.ok && !('hack' in extra.exercise) && extra.exercise.src.lessonKey === K, 'unknown fields are not passed through');
  ok(V(mod(mc, e => { e.explanation = 'זה נכון — לפי השיעור'; })).exercise.explanation === 'זה נכון, לפי השיעור', 'a dash in generated text is repaired');
  const piece = V(mod(cloze, e => { e.template = 'נפתחים ___ ואי אפשר לצפות בהם ברצף אחד'; }));
  ok(piece.ok, 'cloze on a continuous 8+ word piece of the quote');
  ok(V(mod(cloze, e => { e.template = 'התכנים נפתחים _____ ואי אפשר לצפות בהם ברצף אחד'; })).exercise.template.includes(' ___ '), 'a longer blank is normalised to ___');

  // quote
  bad(mod(mc, e => { e.src.quote = 'משפט שהמודל המציא ולא נאמר בשיעור בכלל'; }), 'quote_not_verified', 'quote not in the list');
  bad(mod(mc, e => { e.src.quote = QUOTES[0].replace('מהשורש', 'מהבסיס'); }), 'quote_not_verified', 'quote with one changed word');
  bad(mod(mc, e => { delete e.src; }), 'missing_quote', 'no src');
  // type
  bad(mod(mc, e => { e.type = 'match'; }), 'type_not_allowed', 'type outside the three allowed');
  bad(null, 'not_an_object', 'null');
  bad([mc()], 'not_an_object', 'array');
  // multiple-choice
  bad(mod(mc, e => { e.options.pop(); }), 'options_not_4', 'three options');
  bad(mod(mc, e => { e.options[3] = e.options[0] + '.'; }), 'options_not_unique', 'duplicate options');
  bad(mod(mc, e => { e.correct = 4; }), 'correct_out_of_range', 'correct = 4');
  bad(mod(mc, e => { e.correct = '0'; }), 'correct_out_of_range', 'correct as a string');
  const fixed1 = V(mod(mc, e => { e.wrongExplanations[0] = 'גם לנכונה נכתב הסבר'; }));
  ok(fixed1.ok && fixed1.exercise.wrongExplanations[0] === null && fixed1.exercise.wrongExplanations[1] === 'תקציב לא הוזכר.', 'an explanation at the correct index is replaced by null');
  const fixed2 = V(mod(cloze, e => { e.wrongExplanations = ['ההפך נאמר.', 'לא נאמר.', 'לא נאמר גם זה.']; }));
  eq(fixed2.ok && fixed2.exercise.wrongExplanations, ['ההפך נאמר.', null, 'לא נאמר.', 'לא נאמר גם זה.'], 'three explanations get a null at the correct index');
  bad(mod(mc, e => { e.wrongExplanations = ['a', 'b', null]; }), 'wrong_explanations_not_4', 'three entries with a null are not repaired');
  bad(mod(mc, e => { e.wrongExplanations[2] = null; }), 'wrong_explanations_shape', 'null at a wrong index');
  bad(mod(mc, e => { e.wrongExplanations = ['a']; }), 'wrong_explanations_not_4', 'wrongExplanations too short');
  bad(mod(mc, e => { e.question = ' '; }), 'missing_question', 'blank question');
  bad(mod(mc, e => { delete e.explanation; }), 'missing_explanation', 'no explanation');
  bad(mod(mc, e => { e.explanation = 'כמו שאמר רם בשיעור'; }), 'text_rule_ram', 'standalone name is dropped');
  // true-false
  bad(mod(tf, e => { e.statements.pop(); }), 'statements_not_4', 'three statements');
  bad(mod(tf, e => { e.statements.forEach(s => { s.answer = true; }); }), 'statements_not_mixed', 'all true');
  bad(mod(tf, e => { e.statements.forEach(s => { s.answer = false; }); }), 'statements_not_mixed', 'all false');
  bad(mod(tf, e => { e.statements[0].answer = 'false'; }), 'statement_shape', 'answer as a string');
  bad(mod(tf, e => { delete e.statements[1].why; }), 'statement_shape', 'statement without why');
  bad(mod(tf, e => { e.statements[1].text = e.statements[0].text; }), 'statements_not_unique', 'duplicate statements');
  // quote-cloze
  bad(mod(cloze, e => { e.template = 'התכנים נפתחים ___ ואי אפשר ___ בהם ברצף אחד'; }), 'cloze_template', 'two blanks');
  bad(mod(cloze, e => { e.template = 'התכנים נפתחים בהדרגה'; }), 'cloze_template', 'no blank');
  bad(mod(cloze, e => { e.correct = 0; e.wrongExplanations = [null, 'x', 'y', 'z']; }), 'cloze_not_the_quote', 'the marked answer does not complete the quote');
  bad(mod(cloze, e => { e.template = 'התכנים נפתחים ___ ואפשר לצפות בהם ברצף אחד'; }), 'cloze_not_the_quote', 'template that rewords the quote');
  bad(mod(cloze, e => { e.template = 'התכנים נפתחים ___'; }), 'cloze_not_the_quote', 'a piece shorter than 8 words');
  bad(mod(cloze, e => { e.src.quote = QUOTES[0]; }), 'cloze_not_the_quote', 'cloze built on a different quote than its src');
  bad(mod(cloze, e => { e.template = 'התכנים ___ בהדרגה נפתחים ואי אפשר לצפות בהם ברצף אחד'; e.options[1] = 'שלנו'; }), 'cloze_not_the_quote', 'reordered words are not a piece of the quote');

  // the by-name form the model is asked for
  const named = core.assembleSurpriseExercise({
    type: 'quote-cloze', question: 'השלימו:', template: 'התכנים נפתחים ___ ואי אפשר לצפות בהם ברצף אחד',
    answer: 'בהדרגה', wrong: [{ text: 'בבת אחת', why: 'ההפך נאמר.' }, { text: 'פעם בשנה', why: 'לא נאמר.' }, { text: 'לפי בקשה', why: 'לא נאמר.' }],
    explanation: 'הפתיחה הדרגתית.', src: { quote: QUOTES[2] },
  });
  eq([named.options, named.correct, named.wrongExplanations], [['בהדרגה', 'בבת אחת', 'פעם בשנה', 'לפי בקשה'], 0, [null, 'ההפך נאמר.', 'לא נאמר.', 'לא נאמר.']], 'by-name form is assembled into options / correct / wrongExplanations');
  ok(V(named).ok && !('answer' in V(named).exercise) && !('wrong' in V(named).exercise), 'an assembled exercise validates and carries no answer / wrong fields');
  ok(core.assembleSurpriseExercise(mc()).options.length === 4 && core.assembleSurpriseExercise(tf()).statements.length === 4, 'positional and true-false exercises pass through assembly unchanged');
  bad(core.assembleSurpriseExercise({ type: 'multiple-choice', question: 'ש', answer: 'א', wrong: [{ text: 'ב', why: 'כי' }, { text: 'ג', why: 'כי' }], explanation: 'ה', src: { quote: QUOTES[0] } }), 'options_not_4', 'two distractors are not assembled and fail validation');
  bad(core.assembleSurpriseExercise({ type: 'multiple-choice', question: 'ש', answer: 'א', wrong: [{ text: 'א', why: 'כי' }, { text: 'ג', why: 'כי' }, { text: 'ד', why: 'כי' }], explanation: 'ה', src: { quote: QUOTES[0] } }), 'options_not_unique', 'a distractor equal to the answer is rejected');
  ok(core.validateSurpriseRound([{ ...named }], QUOTES, K).valid.length === 1, 'the round validator assembles by-name exercises');

  // round
  const round = core.validateSurpriseRound([mc(), tf(), cloze(), mod(mc, e => { e.src.quote = 'מומצא לגמרי ולא קיים'; }), mc()], QUOTES, K);
  ok(round.valid.length === 3 && round.dropped.join() === 'quote_not_verified,duplicate_question', 'round: invalid and duplicate exercises are dropped');
  const many = Array.from({ length: 9 }, (_, i) => mod(tf, e => { e.question = `שאלה ${i}`; e.src.quote = QUOTES[i % 3]; }));
  const capped = core.validateSurpriseRound(many, QUOTES, K);
  ok(capped.valid.length === 6, 'round: at most 6 exercises, each quote at most twice');
  const twice = core.validateSurpriseRound([0, 1, 2].map(i => mod(mc, e => { e.question = `ש ${i}`; })), QUOTES, K);
  ok(twice.valid.length === 2 && twice.dropped[0] === 'quote_used_twice', 'round: a third use of the same quote is dropped');
  ok(core.validateSurpriseRound('x', QUOTES, K).valid.length === 0, 'round: not an array');
  const merged = core.validateSurpriseRound([tf(), mc()], QUOTES, K, [V(mc()).exercise]);
  ok(merged.valid.length === 2 && merged.dropped[0] === 'duplicate_question', 'round: a retry merges with what already survived');

  // shuffle keeps the answer attached
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let attached = true, moved = false;
  for (let i = 0; i < 30; i++) {
    const base = V(mc()).exercise;
    const s = core.shuffleOptions(base, rng);
    if (s.options[s.correct] !== base.options[base.correct] || s.wrongExplanations[s.correct] !== null) attached = false;
    if (s.wrongExplanations.filter(w => w === null).length !== 1) attached = false;
    if (s.correct !== base.correct) moved = true;
  }
  ok(attached && moved, 'shuffle moves the correct option and keeps correct + wrongExplanations aligned');
  const s2 = core.shuffleOptions(V(cloze()).exercise, rng);
  ok(V({ ...s2, src: { quote: s2.src.quote } }).ok, 'a shuffled cloze still validates');
  ok(core.shuffleOptions(V(tf()).exercise, rng).statements.length === 4, 'shuffle leaves true-false alone');

  // signature of a cached round
  const ex = [V(mc()).exercise, V(tf()).exercise, V(cloze()).exercise, V(mod(mc, e => { e.question = 'שאלה אחרת'; e.src.quote = QUOTES[1]; })).exercise];
  const signed = core.signRound(ex, K, 'secret-1');
  eq(core.verifyRound(signed, K, 'secret-1'), ex, 'a signed round verifies and comes back without the signature');
  const reordered = JSON.parse(JSON.stringify(signed.map(o => Object.fromEntries(Object.entries(o).reverse()))));
  ok(core.verifyRound(reordered, K, 'secret-1') !== null, 'key order (jsonb round trip) does not break the signature');
  ok(core.verifyRound(signed, 'm0-1-0', 'secret-1') === null, 'a round signed for another lesson is rejected');
  ok(core.verifyRound(signed, K, 'secret-2') === null, 'a wrong secret is rejected');
  ok(core.verifyRound(signed.map((o, i) => (i === 1 ? { ...o, question: 'שונה' } : o)), K, 'secret-1') === null, 'a tampered round is rejected');
  ok(core.verifyRound(ex, K, 'secret-1') === null && core.verifyRound(signed, K, '') === null && core.verifyRound(null, K, 's') === null, 'unsigned round / no secret / null are rejected');
}

// --------------------------------------------------------------- prompts
{
  const lesson = {
    title: 'שיעור בדיקה', terms: [{ term: 'מונח', definition: 'הגדרה' }], quotes: ['ציטוט בדיקה ראשון מתוך השיעור'],
    l1: [{ question: 'שאלה קיימת' }], tasks: [],
  };
  const g1 = core.buildGrounding(lesson, 'm0-0-0', { text: 'קטע', fromTranscript: true });
  const g2 = core.buildGrounding(lesson, 'm0-0-0', { text: 'קטע', fromTranscript: true });
  ok(g1 === g2 && g1.includes('«ציטוט בדיקה ראשון מתוך השיעור»') && g1.includes('מונח: הגדרה'), 'grounding is deterministic and carries terms + quotes');
  ok(!core.breaksTextRules(g1) && !core.breaksTextRules(core.surpriseSystem(lesson)) && !core.breaksTextRules(core.PERSONA_LAST_NUDGE), 'our own prompts follow the text rules');
  const task = { title: 'כותרת', prompt: 'מטלה', persona: 'דמות', opening: 'פתיחה' };
  const rub = { criteria: ['קריטריון א', 'קריטריון ב', 'קריטריון ג'], stance: 'עמדה סודית' };
  ok(core.judgeSystem(task, rub).includes('2. קריטריון ב') && !/passed|עבר/.test(core.judgeSystem(task, rub).replace('עברה או נכשלה', '').replace('בזמן עבר', '')), 'the judge prompt lists the criteria and never asks for a pass decision');
  ok(core.personaSystem(task, rub).includes('עמדה סודית') && !core.roleplayJudgeSystem(task, rub).includes('עמדה סודית'), 'the stance goes to the persona only');
  const ju = core.roleplayJudgeUser('פתיחה', [{ role: 'user', content: 'אני' }, { role: 'assistant', content: 'היא' }]);
  ok(ju.includes('הדמות: פתיחה\nלומדים: אני\nהדמות: היא'), 'role-play transcript for the judge');
  ok(core.hintSystem({ question: 'ש', answer: ['א', 'ב'] }).includes('- א\n- ב'), 'hint prompt lists a multi-part answer');
}

console.log(`passed: ${pass} · failed: ${fail}`);
console.log(`RESULT: ${fail ? 'FAIL' : 'PASS'}`);
process.exit(fail ? 1 : 0);
