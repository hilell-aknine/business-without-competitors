// ===== Course Data - עסק ללא מתחרים =====
// Shared data for hub, detail pages, and LMS player

const SEMINARS = [
    {
        title: 'סמינר לקהל הרחב ״עסק ללא מתחרים״',
        shortDescription: 'הכירו את השיטה האטומית והעקרונות המרכזיים לבניית עסק ללא מתחרים',
        description: 'סמינר פתיחה מרתק שמציג את השיטה האטומית ומלמד כיצד לבנות עסק שמתנהל מחוץ לתחרות. תגלו את העקרונות שהופכים בעל עסק רגיל לאוטוריטה בתחומו.',
        icon: 'fa-rocket',
        parts: [
            { title: 'חלק א׳', videoId: 'xiOdeSKL5yQ' },
            { title: 'חלק ב׳', videoId: 'g6274N0WWHY' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/166_NWujaCTtYkGfJYD5RXSKn5wdpXjku/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'השיטה האטומית',
        shortDescription: 'העקרונות המדעיים מאחורי השיטה האטומית לצמיחה עסקית',
        description: 'צלילה עמוקה לתוך המתודולוגיה האטומית — איך כל רכיב בעסק שלכם מתחבר למערכת אחת חזקה שמייצרת תוצאות מצטברות ובלתי ניתנות לחיקוי.',
        icon: 'fa-atom',
        parts: [
            { title: 'חלק א׳', videoId: 'Nmmc2UQ2Iwc' },
            { title: 'חלק ב׳', videoId: 'ii2h4PKEgjo' },
            { title: 'חלק ג׳', videoId: 'CHEQ8f9b3Is' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/15FbVFGGLNopX36WAfirzP-5dE3kU0WPj/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'בורות וסולמות',
        shortDescription: 'זיהוי המלכודות והמנופים בדרך להצלחה עסקית',
        description: 'למדו לזהות את ה"בורות" שמפילים עסקים ואת ה"סולמות" שמאיצים צמיחה. סמינר פרקטי שמלמד איך לנווט נכון בין הטעויות הנפוצות לבין ההזדמנויות האמיתיות.',
        icon: 'fa-chess',
        parts: [
            { title: 'חלק א׳', videoId: 'tQXFIkvkk6o' },
            { title: 'חלק ב׳', videoId: '1Z0_hcg0qbE' },
            { title: 'חלק ג׳', videoId: 'Mqe-0arFscQ' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/1RSKMFIIMcEBUzWgLHJaksYEsb3BipKSi/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'בחירת מסע לקוח',
        shortDescription: 'עיצוב מסע הלקוח המושלם מגילוי ועד רכישה',
        description: 'סמינר ממוקד על תכנון ובניית מסע לקוח שמוביל בצורה טבעית מחשיפה ראשונית ועד להמרה. תלמדו לבחור את המסלול הנכון עבור העסק והקהל שלכם.',
        icon: 'fa-route',
        parts: [
            { title: 'הסמינר המלא', videoId: 'ylLhKHfgb38' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/16ES-WJqyOC4-qMiJvtrowNXrgDDWznN6/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'פרוטוקול הפידבק האטומי',
        shortDescription: 'מערכת פידבק מתקדמת לשיפור מתמיד של העסק',
        description: 'גלו את הפרוטוקול המובנה לאיסוף, ניתוח ויישום פידבק שמאפשר לכם לשפר את העסק בצורה מתמדת ומדויקת. מהלקוחות, מהשוק ומהנתונים.',
        icon: 'fa-comments',
        parts: [
            { title: 'חלק א׳', videoId: 'lD9oHPWa6JY' },
            { title: 'חלק ב׳', videoId: 'fpemqwGE_Es' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/1HR86z6rZb4ugzyUSlSNy3sHdWbGBjc6z/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'היום שאחרי: ממוצר למהפכה',
        shortDescription: 'המעבר ממוצר בודד למהפכה שלמה בשוק',
        description: 'מה קורה אחרי שבניתם מוצר מנצח? סמינר שמלמד איך להפוך מוצר בודד לתנועה שלמה — מותג שמוביל שינוי, קהילה שצומחת, ומהפכה שמשנה את השוק.',
        icon: 'fa-flag',
        parts: [
            { title: 'חלק א׳', videoId: '_bZtgSCxOPo' },
            { title: 'חלק ב׳', videoId: 'yPeOpn09dY8' }
        ],
        presentationUrl: 'https://docs.google.com/presentation/d/13refExLNPw-ut3GQKIjVtzb4Gcc3FSvA/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true'
    },
    {
        title: 'סמינר סיום: האומץ להאמין',
        shortDescription: 'סיכום המסע והכוח הפנימי להוביל שינוי אמיתי',
        description: 'סמינר הסיום של התוכנית — חיבור כל החלקים יחד, חיזוק האמונה ביכולת שלכם, ומתן הכלים האחרונים לצאת לדרך כאוטוריטה אמיתית בתחומכם.',
        icon: 'fa-star',
        parts: [
            { title: 'חלק א׳', videoId: '1eADT_6_iSc' },
            { title: 'חלק ב׳', videoId: 'nOHpGUXPhk4' },
            { title: 'חלק ג׳', videoId: 'lVJvwdHevyM' }
        ]
    }
];

const MODULES = [
    {
        title: 'הכנה אטומית',
        icon: 'fa-atom',
        shortDescription: 'התשתית העסקית: הגדרת זהות, מיפוי שוק, בניית בסיס',
        description: 'המודול הראשון מניח את התשתית לכל מה שיבוא אחריו. תלמדו להגדיר את הזהות העסקית שלכם, למפות את השוק בצורה חכמה, ולבנות בסיס יציב שעליו תוכלו לצמוח. זהו השלב שבו אתם מגדירים מי אתם, למי אתם פונים, ומה ההבטחה הייחודית שלכם.',
        presentationUrl: 'https://docs.google.com/presentation/d/1sNYMrZiDM-zNiL0pwu9VMqgpscpwFQyQ/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-690891a3dad88191b5546c0fe1d4e790-mmn-sq-ll-mtkhrym-hknh-tvmyt',
        weeks: [
            {
                title: 'סרטון פתיחה',
                days: [
                    { title: 'פתיחה לתוכנית ההכשרה', videoId: 'CR72nLX20bI' }
                ]
            },
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'Pm7HfmdWziU' },
                    { title: 'יום 2', videoId: 'eCaUBdsb3Co' },
                    { title: 'יום 3', videoId: 'Kny7pRefdOY' },
                    { title: 'יום 4', videoId: 'Le3GbdccnfQ' },
                    { title: 'יום 5', videoId: 'JsXXqEb1UVU' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'BvQUBidILYU' },
                    { title: 'יום 2', videoId: '6MWTRPyQhsM' },
                    { title: 'יום 3', videoId: 'YCzMHzLoc9w' },
                    { title: 'יום 4', videoId: '1yEjtL3ROVY' },
                    { title: 'יום 5', videoId: 'HQXQhpVKXuM' }
                ]
            }
        ]
    },
    {
        title: 'מנהיגות אטומית',
        icon: 'fa-crown',
        shortDescription: 'פיתוח קול מנהיגותי, סמכות טבעית, הובלת דעה',
        description: 'מודול שמלמד אתכם לפתח קול מנהיגותי אותנטי ולבנות סמכות טבעית בתחומכם. תגלו איך להוביל דעה, להשפיע על קהל, וליצור נוכחות שמושכת אליה אנשים — בלי למכור, בלי לשכנע, פשוט להוביל.',
        presentationUrl: 'https://docs.google.com/presentation/d/1UUkuJP65QtnvWsoids24OzoJwA-NxzSZ/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-690896e066ec81919973c08814a4ac9c-mmn-sq-ll-mtkhrym-mnhygvt-tvmyt',
        extraTools: [
            { label: 'מאמן רגשי - שיח מנהיגות', url: 'https://chatgpt.com/g/g-xmPI79ykE-shykh-mnhygvt-kly-zr', icon: 'fa-heart' }
        ],
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'FaSkvCTJz04' },
                    { title: 'יום 2', videoId: 'I34D3SoygaE' },
                    { title: 'יום 3', videoId: 'GIUW676Zl4M' },
                    { title: 'יום 4', videoId: 'ji7ekKoo20M' },
                    { title: 'יום 5', videoId: '0ANOF3g1ww8' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'lSJe09pT0uo' },
                    { title: 'יום 2', videoId: 'lqx_YCBIAas' },
                    { title: 'יום 3', videoId: 'ZhUjAWj99fk' },
                    { title: 'יום 4', videoId: 'bP6whiZ0PcY' },
                    { title: 'יום 5', videoId: 'saFQsrTjwFc' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: 'GEX3-Ejfsvs' },
                    { title: 'יום 2', videoId: '96YU_T6bMMI' },
                    { title: 'יום 3', videoId: 'kjOaIHwRBDc' },
                    { title: 'יום 4', videoId: 'wHjf3PztETs' },
                    { title: 'יום 5', videoId: 'UCGLqxAcXlc' }
                ]
            }
        ]
    },
    {
        title: 'חדשנות אטומית',
        icon: 'fa-lightbulb',
        shortDescription: 'חשיבה שונה, זיהוי הזדמנויות, יתרון תחרותי',
        description: 'מודול שפותח את הראש לחשיבה חדשנית ומלמד לזהות הזדמנויות שאחרים לא רואים. תלמדו ליצור יתרון תחרותי אמיתי — לא על ידי עבודה קשה יותר, אלא על ידי חשיבה שונה לחלוטין מכל מה שקיים בשוק.',
        presentationUrl: 'https://docs.google.com/presentation/d/1K-XxMteGgucwtpNdSmreCr-KHDUl69fb/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-690897fe7e388191a5e8e73ff59fe929-mmn-sq-ll-mtkhrym-khdshnvt-tvmyt',
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'f9z6yCgl8cs' },
                    { title: 'יום 2', videoId: 'Ng-CoLYLWXI' },
                    { title: 'יום 3', videoId: 'KPChQLVaTNo' },
                    { title: 'יום 4', videoId: 'kzzE-fisVIE' },
                    { title: 'יום 5', videoId: 'HCYTCwQud4M' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'H8mFC1Adfak' },
                    { title: 'יום 2', videoId: 'kUBHkPr8Y3c' },
                    { title: 'יום 3', videoId: 'U7PTP_X85UA' },
                    { title: 'יום 4', videoId: 'wQzieVpgZVs' },
                    { title: 'יום 5', videoId: 'XKljnYtP144' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: '7JESTOdTs14', variants: [ { label: 'גברים', videoId: '7JESTOdTs14' }, { label: 'נשים', videoId: 'lt_vbGVVaq4' } ] },
                    { title: 'יום 2', videoId: 'cy3YVIpqk14' },
                    { title: 'יום 3', videoId: 'nnRYt-ISNQE' },
                    { title: 'יום 4', videoId: 'T1pvpNWdMPg' },
                    { title: 'יום 5 - משימת הטמעה', videoId: 'uVJmjA6Uirk' }
                ]
            }
        ]
    },
    {
        title: 'מוצר משנה חיים',
        icon: 'fa-gem',
        shortDescription: 'בניית הצעה שמוכרת את עצמה, מבנה ותמחור',
        description: 'המודול שמלמד אתכם לבנות מוצר או שירות שהלקוחות מרגישים שהם חייבים. תעברו תהליך מובנה של עיצוב ההצעה, בניית המבנה, תמחור נכון, ויצירת חוויה שגורמת ללקוחות לומר "כן" באופן טבעי.',
        presentationUrl: 'https://docs.google.com/presentation/d/1G3TIsKanFqv-oQdwilJVYaogEb2VDhcQ/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-690898776c008191b0459163936c472e-mmn-sq-ll-mtkhrym-mvtsr-mshnh-khyym',
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'zvGGZxBf6BE' },
                    { title: 'יום 2', videoId: 'JAnDd7SXpWE' },
                    { title: 'יום 3', videoId: 'OpiNVVxPpfU' },
                    { title: 'יום 4', videoId: '4cP64cEdDA0' },
                    { title: 'יום 5', videoId: 'FR2il4NCMHE' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'eELg9ST93VQ' },
                    { title: 'יום 2', videoId: '3bVy40j3YII' },
                    { title: 'יום 3', videoId: 'hfjk11y28m8', variants: [ { label: 'צביקה', videoId: 'hfjk11y28m8' }, { label: 'תמר', videoId: 'vuarz_Ych-M' } ] },
                    { title: 'יום 4', videoId: 'flcxwJkJsDY' },
                    { title: 'יום 5', videoId: 'noKTvTuHwmI' }
                ]
            },
            {
                title: 'שבוע 3 - שבוע הטמעה אישי',
                days: [
                    { title: 'יום 1', videoId: 'G4izsR_45Wk' },
                    { title: 'יום 2', videoId: 'F_KXh0ZZB0M' },
                    { title: 'יום 3 (צביקה)', videoId: 'yhMCeGOe1YA' },
                    { title: 'יום 4', videoId: 'UQge4OvcvqA' },
                    { title: 'יום 5 - משימת הטמעה', videoId: 'hPNvwNpgJaE' }
                ]
            }
        ]
    },
    {
        title: 'הפיצוח האטומי',
        icon: 'fa-bolt',
        shortDescription: 'פריצת דרך, נקודת מנוף, קפיצה מעסק קטן לכוח בשוק',
        description: 'המודול שבו הכל מתחבר לפריצת דרך אמיתית. תלמדו למצוא את נקודת המנוף הספציפית של העסק שלכם — הדבר האחד שאם תשנו אותו, כל השאר ישתנה. מעסק קטן לכוח משמעותי בשוק.',
        presentationUrl: 'https://docs.google.com/presentation/d/1L_gjkcz4BPQvlqA6E9Ld1m5SSYkT1qvS/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-690899083d5c819182cb301d79e558c7-mmn-sq-ll-mtkhrym-hpytsvkh-htvmy',
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'R7s0xuu7zOY' },
                    { title: 'יום 2', videoId: 'k97S5RTgeao' },
                    { title: 'יום 3', videoId: 'DO_YqMtyvWY' },
                    { title: 'יום 4', videoId: 'zYIOk6_jO1U' },
                    { title: 'יום 5', videoId: 'tu9ZK0cnr24' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'X0yEBnG-t2U' },
                    { title: 'יום 2', videoId: 'cCAu5yxAy5k' },
                    { title: 'יום 3', videoId: 'vrtdccnt9Zs' },
                    { title: 'יום 4', videoId: 'T06CoW6evnA' },
                    { title: 'יום 5', videoId: 'Mv5cpiNYxlM' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: 'V-fy0QO-dzM' },
                    { title: 'יום 2', videoId: 'Zzk-b8mBlH8' },
                    { title: 'יום 3', videoId: 'S5K4bFR4-LI' },
                    { title: 'יום 4', videoId: 'r0IJ73PT2Ac' },
                    { title: 'יום 5 - משימת הטמעה', videoId: 'h_RTLzPF1no' }
                ]
            }
        ]
    },
    {
        title: 'השפעה אטומית',
        icon: 'fa-bullhorn',
        shortDescription: 'תוכן שמושך, מסע לקוח, נוכחות דיגיטלית עם כלי AI',
        description: 'מודול שמלמד ליצור השפעה אמיתית בעולם הדיגיטלי. תבנו מסע לקוח מנצח, תלמדו ליצור תוכן שמושך את הקהל הנכון, ותשתמשו בכלי AI מתקדמים כדי להגביר את הנוכחות שלכם — בלי לעבוד 24/7.',
        presentationUrl: 'https://docs.google.com/presentation/d/1qJ7JV4aZNIefrMCxY9RTM018fcwaQ0Pz/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-69089a5b2e4481919c9271aca37d58da-mmn-sq-ll-mtkhrym-hshp-h-tvmyt',
        extraTools: [
            { label: 'מוצא הקייסים', url: 'https://chatgpt.com/g/g-vMYXMPJAy-shyvvq-tvmy-hvkkhvt-mkhqryvt-lmvnvt-pytsvkh', icon: 'fa-search' },
            { label: 'קופירייטר למסע לקוח', url: 'https://chatgpt.com/g/g-sl6wmcjzN-shyvvq-tvmy-ktybt-tknym-lms-hlqvkh', icon: 'fa-pen-fancy' }
        ],
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: '1TqLVPgWzUY' },
                    { title: 'יום 2', videoId: 'DFfhc3xWzNk' },
                    { title: 'יום 3', videoId: '-rb6xNj06pk' },
                    { title: 'יום 4', videoId: '72-A93-KVSE' },
                    { title: 'יום 5', videoId: '1RDdiaTmvUg' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'iHCMZU2zJ2A' },
                    { title: 'יום 2', videoId: 'i0dwyo9eQy8' },
                    { title: 'יום 3', videoId: 'p0e6e2AUyuU' },
                    { title: 'יום 4', videoId: 'lXUYBzs0Q3w' },
                    { title: 'יום 5', videoId: '3oxYZo4TM9M' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: 'rxncW0-72Vo' },
                    { title: 'יום 2', videoId: 'c8EZrhI0A1k' },
                    { title: 'יום 3', videoId: 'krW4Nmi3mjY' },
                    { title: 'יום 4', videoId: 'VujmXNeg-7Y' },
                    { title: 'יום 5 - משימת הטמעה', videoId: 'Y1yaJD6B2bw' }
                ]
            }
        ]
    },
    {
        title: 'המרה אטומית',
        icon: 'fa-handshake',
        shortDescription: 'הפיכת אינטראקציה לפעולה, מנגנון מכירות אוטומטי',
        description: 'המודול שמלמד להפוך כל אינטראקציה עם לקוח פוטנציאלי לפעולה ממשית. תבנו מנגנון מכירות שעובד בצורה אוטומטית — ללא לחץ, ללא מניפולציה, פשוט מערכת שמובילה אנשים לקבל החלטה בטוחה.',
        presentationUrl: 'https://docs.google.com/presentation/d/1SjsU5U70jtjiyaKlKA91k5sTbhJMbb0m/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-69089b03c0d4819199169b191ce5213a-mmn-sq-ll-mtkhrym-hmrh-tvmyt',
        extraTools: [
            { label: 'שיח מנהיגות בזמן אמת', url: 'https://chatgpt.com/g/g-xmPI79ykE-shykh-mnhygvt-kly-zr', icon: 'fa-comments' }
        ],
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'tAREaFEN_Xs' },
                    { title: 'יום 2', videoId: 'SzR81xK6-w4' },
                    { title: 'יום 3', videoId: 'JF6T2reo99w' },
                    { title: 'יום 4', videoId: 'j5xpoc9rxFI' },
                    { title: 'יום 5', videoId: '8nnpNBWhjC8' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'nm5LRSBd2xU' },
                    { title: 'יום 2', videoId: 'rocEFQj0BW8' },
                    { title: 'יום 3 (צביקה)', videoId: 'r5MEF0ZC6xI' },
                    { title: 'יום 4', videoId: 'S_5BJjT-Lss' },
                    { title: 'יום 5', videoId: 'bbf51qGA9Rs' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: 'W7TxKE0_CmE' },
                    { title: 'יום 2', videoId: 'NqONCVKUkdY' },
                    { title: 'יום 3 - שיח מנהיגות', videoId: 'I6SXkuFspgc' },
                    { title: 'יום 4', videoId: '_6IgiSGTyBs' },
                    { title: 'יום 5', videoId: null, aiToolUrl: 'https://chatgpt.com/g/g-xmPI79ykE-shykh-mnhygvt-kly-zr', aiToolLabel: 'כלי AI: שיח מנהיגות בזמן אמת' }
                ]
            }
        ]
    },
    {
        title: 'אופטימיזציה אטומית',
        icon: 'fa-chart-line',
        shortDescription: 'מדידה, שיפור וחידוד כל חלק במערכת העסקית',
        description: 'המודול האחרון שסוגר את המעגל. תלמדו למדוד כל חלק במערכת העסקית שלכם, לזהות מה עובד ומה לא, ולחדד את הביצועים עד לאופטימום. כאן העסק שלכם הופך ממכונה טובה למכונה מושלמת.',
        presentationUrl: 'https://docs.google.com/presentation/d/1GBPExmty926tgHAD8fhjcvD4kSrQOY5q/edit?usp=sharing&ouid=105866972918707903553&rtpof=true&sd=true',
        aiCoachUrl: 'https://chatgpt.com/g/g-69089b82fb248191952c62dc76130d30-mmn-sq-ll-mtkhrym-vptymyztsyh-tvmyt',
        weeks: [
            {
                title: 'שבוע 1',
                days: [
                    { title: 'יום 1', videoId: 'T_F70IIDWlM' },
                    { title: 'יום 2', videoId: 'GoOd3flvBlw' },
                    { title: 'יום 3', videoId: 'ywomR2G4UF8' },
                    { title: 'יום 4', videoId: 'E1pbPim9BVI' },
                    { title: 'יום 5', videoId: 'SglPX6TLAGY' }
                ]
            },
            {
                title: 'שבוע 2',
                days: [
                    { title: 'יום 1', videoId: 'u_Ep1exYO14' },
                    { title: 'יום 2', videoId: 'qCQcM9To_4E' },
                    { title: 'יום 3', videoId: 'Kf0FkRXN-hk' },
                    { title: 'יום 4', videoId: 'zEioiTvMpA4' },
                    { title: 'יום 5', videoId: 'sM_xS8r6ggQ' }
                ]
            },
            {
                title: 'שבוע 3',
                days: [
                    { title: 'יום 1', videoId: '1ywXUls5nw8' },
                    { title: 'יום 2', videoId: 'zT6Gv8xmAYk' },
                    { title: 'יום 3', videoId: 'M6KvJ_DsQtA' },
                    { title: 'יום 4', videoId: 'R9tTco5eyis' },
                    { title: 'יום 5', videoId: 'H2Nrq1p_kgo' }
                ]
            }
        ]
    }
];

// ===== Computed helpers =====
function getModuleLessonCount(mod) {
    return mod.weeks.reduce((sum, w) => sum + w.days.filter(d => d.videoId).length, 0);
}

function getModuleWeekCount(mod) {
    return mod.weeks.length;
}

function getSeminarPartCount(sem) {
    return sem.parts.length;
}

function getTotalLessonCount() {
    let count = 0;
    SEMINARS.forEach(s => count += s.parts.length);
    MODULES.forEach(m => count += getModuleLessonCount(m));
    return count;
}
