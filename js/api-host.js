/* ============================================================
   api-host.js — is the serverless API reachable from this host?

   The site is served from two places off the same repo:
     1. Vercel  — has /api/* serverless functions. Everything works.
     2. GitHub Pages mirror — static only. There is no /api/* there,
        so every AI call resolves to github.io/api/... and 404s.

   Before this file existed, protocol.js read that 404 as "this lesson
   has no transcript yet" and told the learner exactly that — on all
   132 lessons. A learner arriving via the mirror concluded the course
   was empty. The message was false; the feature was simply not there.

   So: detect the static mirror up front and say the true thing, with a
   link to the site where the feature actually runs.

   Public surface: window.bwcApi.{ available, primary, unavailableHtml() }
   ============================================================ */
(function () {
    'use strict';

    var PRIMARY = 'https://business-without-competitors.vercel.app';

    // Any *.github.io host is the static mirror. Vercel, custom domains and
    // localhost (vercel dev) all keep the API.
    var isStaticMirror = /(^|\.)github\.io$/i.test(location.hostname);

    function unavailableHtml() {
        return (
            '<div class="bwc-api-off" role="status">' +
            '<strong>הפיצ\'רים החכמים לא זמינים בכתובת הזו.</strong>' +
            '<span>עוזר הלמידה, עוזר היישום ופרוטוקול ה-10X רצים על שרת שאין לו מקבילה בכתובת הנוכחית. ' +
            'התוכן והשיעורים כאן מלאים — רק העוזרים החכמים חסרים.</span>' +
            '<a href="' + PRIMARY + location.pathname.replace(/^\/[^/]+/, '') + '">עבור לפורטל המלא ←</a>' +
            '</div>'
        );
    }

    window.bwcApi = {
        available: !isStaticMirror,
        primary: PRIMARY,
        unavailableHtml: unavailableHtml,
    };
})();
