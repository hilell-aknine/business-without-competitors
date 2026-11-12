/* ==========================================================================
   game-data.js — combiner for the practice game data.

   Each module lives in its own file (js/game-data-m1.js ... -m8.js) and sets
   window.GAME_MODULE_<n>. This file collects whichever of them exist into
   window.GAME_MODULES, sorted by id. A module that has not been written yet
   is simply absent, and the engine copes with any number from 1 to 8.

   Test fixture: tools/fixtures/game-data-fixture.js is loaded INSTEAD of the
   real data when the URL has ?fixture=1, or when no module file is present
   at all (js/game-data-m1.js missing). tools/ is not deployed, so on the
   live site that request fails and the engine shows its "content did not
   load" screen.

   The engine waits for window.GAME_DATA_READY (a Promise) before it boots.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var TOTAL_MODULES = 8;
  window.GAME_TOTAL_MODULES = TOTAL_MODULES;

  function collect() {
    var out = [];
    for (var n = 1; n <= TOTAL_MODULES; n++) {
      var mod = window['GAME_MODULE_' + n];
      if (mod && Array.isArray(mod.lessons) && mod.lessons.length) out.push(mod);
    }
    out.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });
    return out;
  }

  var wantFixture = false;
  try { wantFixture = new URLSearchParams(window.location.search).has('fixture'); } catch (e) { /* old browser */ }

  var real = collect();

  if (!wantFixture && real.length) {
    window.GAME_MODULES = real;
    window.GAME_DATA_IS_FIXTURE = false;
    window.GAME_DATA_READY = Promise.resolve(real);
    return;
  }

  window.GAME_DATA_IS_FIXTURE = true;
  window.GAME_DATA_READY = new Promise(function (resolve) {
    var s = document.createElement('script');
    s.src = '../tools/fixtures/game-data-fixture.js?v=1';
    s.onload = function () {
      var fx = Array.isArray(window.GAME_FIXTURE_MODULES) ? window.GAME_FIXTURE_MODULES : [];
      window.GAME_MODULES = fx;
      resolve(fx);
    };
    s.onerror = function () {
      console.error('[game-data] no module data and the fixture is not reachable.');
      window.GAME_MODULES = [];
      resolve([]);
    };
    document.head.appendChild(s);
  });
})();
