/* ==========================================================================
   notes-store.js — ההערות והמסמכים החיים של הלומד (שכבת הנתונים)

   WHY (2026-10-08, בקשת הלל)
   --------------------------
   ההערות היו תיבת טקסט אחת לשיעור, שנשמרה רק בדפדפן (bwc_notes_<key>).
   שני חסרונות: מכשיר אחר = אין הערות, ומה שהלומד באמת בונה הוא כמה
   מסמכים שמצטברים לאורך הקורס ("לקוח LTV", "אווטאר"), לא פתק לכל סרטון.

   MODEL
   -----
   note: { id, lesson_key, video_seconds|null, variant|null, body, doc_id|null,
           created_at, updated_at, dirty }
   doc:  { id, title, created_at, updated_at, dirty }

   localStorage is the working copy and always wins the write; Supabase
   (migration 011) is the cross-device copy, written by a debounced sync:
   push dirty rows -> delete tombstones -> pull everything -> merge.
   Ids are client UUIDs, so an offline note keeps its id when pushed.

   PER-USER NAMESPACE
   ------------------
   Notes are personal text. Each account gets its own local namespace
   (bwc_lnotes_v1:<uid>), and notes written while logged out live in
   bwc_lnotes_v1:anon until the first login adopts them. A second account on
   the same browser never inherits the first one's notes.

   LEGACY IMPORT
   -------------
   Every non-empty bwc_notes_<lessonKey> becomes a note (no timestamp, it
   never had one). The legacy keys are NOT deleted, ever: they stay as a
   local backup. A flag stops a second import.

   FAIL-SOFT
   ---------
   Until migration 011 runs on the live DB every server call fails with
   42P01 / PGRST205. That is detected once, cloud sync stops for the
   session, and everything keeps working locally. Same pattern as resume.js.

   API: window.bwcNotes (see bottom). Event: window 'bwc:notes-change'.
   Load order: after course-data.js, supabase-config.js, auth.js, api-host.js.
   ========================================================================== */
(function () {
  'use strict';
  if (window.bwcNotes) return;

  var NS_PREFIX = 'bwc_lnotes_v1:';
  var LEGACY_FLAG = 'bwc_notes_legacy_imported_v1';
  var LESSON_KEY_RE = /^(m\d+-\d+-\d+|s\d+-\d+)$/;
  var MAX_BODY = 5000;
  var MAX_TITLE = 80;
  var PAGE = 1000;

  var uid = null;          // current user id, null = logged out
  var data = empty();      // the active namespace
  var cloud = 'local';     // local | syncing | synced | missing | error
  var syncTimer = null;
  var syncing = null;      // in-flight sync promise
  var lastSyncAt = 0;
  var profileEnsured = false;
  var readyResolve;
  var readyPromise = new Promise(function (r) { readyResolve = r; });

  function empty() { return { notes: {}, docs: {}, tomb: { notes: [], docs: [] } }; }
  function nowIso() { return new Date().toISOString(); }
  function nsKey() { return NS_PREFIX + (uid || 'anon'); }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function readNs(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return empty();
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return empty();
      d.notes = d.notes || {}; d.docs = d.docs || {};
      d.tomb = d.tomb || { notes: [], docs: [] };
      d.tomb.notes = d.tomb.notes || []; d.tomb.docs = d.tomb.docs || [];
      return d;
    } catch (e) { return empty(); }
  }

  function persist() {
    try { localStorage.setItem(nsKey(), JSON.stringify(data)); }
    catch (e) { console.warn('[notes] local save failed', e); }
  }

  function emit(reason) {
    try { window.dispatchEvent(new CustomEvent('bwc:notes-change', { detail: { reason: reason, cloud: cloud } })); }
    catch (e) { /* old browsers */ }
  }

  function changed(reason) {
    persist();
    emit(reason || 'local');
    scheduleSync(1500);
  }

  /* ---------------- course metadata ---------------- */

  function lessonInfo(key) {
    var m = /^m(\d+)-(\d+)-(\d+)$/.exec(key || '');
    if (m && window.MODULES) {
      var mi = +m[1], wi = +m[2], di = +m[3];
      var mod = window.MODULES[mi], week = mod && mod.weeks && mod.weeks[wi];
      var day = week && week.days && week.days[di];
      return {
        title: (day && day.title) || ('שיעור ' + key),
        context: mod ? ('מודול ' + (mi + 1) + ' · ' + mod.title + (week && week.title ? ' · ' + week.title : '')) : '',
        order: mi * 10000 + wi * 100 + di,
      };
    }
    var s = /^s(\d+)-(\d+)$/.exec(key || '');
    if (s && window.SEMINARS) {
      var sem = window.SEMINARS[+s[1]], part = sem && sem.parts && sem.parts[+s[2]];
      return {
        title: sem ? (sem.title + (part ? ' · ' + part.title : '')) : ('סמינר ' + key),
        context: 'סמינר',
        order: 1000000 + (+s[1]) * 100 + (+s[2]),
      };
    }
    return { title: key || '', context: '', order: 9e9 };
  }

  function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '';
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + (m < 10 ? '0' : '') + m + ':' + ss) : (m + ':' + ss);
  }

  /** קישור לשיעור ולדקה. base = '' מהשורש, '../' מתוך pages/. */
  function lessonHref(note, base) {
    var h = (base || '') + 'index.html#lesson=' + encodeURIComponent(note.lesson_key) + '&tab=notes';
    if (note.video_seconds != null) h += '&t=' + note.video_seconds;
    if (note.variant) h += '&v=' + note.variant;
    return h;
  }

  /* ---------------- queries ---------------- */

  function byPosition(a, b) {
    var sa = a.video_seconds == null ? Infinity : a.video_seconds;
    var sb = b.video_seconds == null ? Infinity : b.video_seconds;
    if (sa !== sb) return sa - sb;
    return String(a.created_at).localeCompare(String(b.created_at));
  }
  function byCourse(a, b) {
    var oa = lessonInfo(a.lesson_key).order, ob = lessonInfo(b.lesson_key).order;
    return oa !== ob ? oa - ob : byPosition(a, b);
  }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

  function notesForLesson(key) {
    return values(data.notes).filter(function (n) { return n.lesson_key === key; }).sort(byPosition);
  }
  function notesForDoc(docId) {
    return values(data.notes).filter(function (n) { return (n.doc_id || null) === (docId || null); }).sort(byCourse);
  }
  function docs() {
    return values(data.docs).sort(function (a, b) {
      return String(b.updated_at).localeCompare(String(a.updated_at));
    });
  }

  /* ---------------- mutations ---------------- */

  function addNote(o) {
    var body = String((o && o.body) || '').trim().slice(0, MAX_BODY);
    if (!body || !LESSON_KEY_RE.test(o.lessonKey || '')) return null;
    var t = nowIso();
    var sec = (o.seconds == null || !isFinite(o.seconds)) ? null : Math.max(0, Math.floor(o.seconds));
    var n = {
      id: uuid(), lesson_key: o.lessonKey, video_seconds: sec,
      variant: (o.variant == null || o.variant === 0) ? null : o.variant,
      body: body, doc_id: o.docId && data.docs[o.docId] ? o.docId : null,
      created_at: t, updated_at: t, dirty: true,
    };
    data.notes[n.id] = n;
    changed('add');
    return n;
  }

  function updateNote(id, patch) {
    var n = data.notes[id];
    if (!n) return null;
    if (patch.body != null) {
      var body = String(patch.body).trim().slice(0, MAX_BODY);
      if (!body) return n;
      n.body = body;
    }
    if (patch.doc_id !== undefined) n.doc_id = patch.doc_id && data.docs[patch.doc_id] ? patch.doc_id : null;
    n.updated_at = nowIso(); n.dirty = true;
    changed('update');
    return n;
  }

  function deleteNote(id) {
    if (!data.notes[id]) return;
    delete data.notes[id];
    if (data.tomb.notes.indexOf(id) < 0) data.tomb.notes.push(id);
    changed('delete');
  }

  function cleanTitle(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE); }

  function findDocByTitle(title) {
    var t = cleanTitle(title);
    return docs().filter(function (d) { return d.title === t; })[0] || null;
  }

  function createDoc(title) {
    var t = cleanTitle(title);
    if (!t) return null;
    var existing = findDocByTitle(t);
    if (existing) return existing;
    var now = nowIso();
    var d = { id: uuid(), title: t, created_at: now, updated_at: now, dirty: true };
    data.docs[d.id] = d;
    changed('doc-add');
    return d;
  }

  function renameDoc(id, title) {
    var d = data.docs[id], t = cleanTitle(title);
    if (!d || !t) return null;
    d.title = t; d.updated_at = nowIso(); d.dirty = true;
    changed('doc-rename');
    return d;
  }

  /** מחיקת מסמך לא מוחקת הערות: הן חוזרות ל"בלי מסמך". */
  function deleteDoc(id) {
    if (!data.docs[id]) return;
    values(data.notes).forEach(function (n) {
      if (n.doc_id === id) { n.doc_id = null; n.updated_at = nowIso(); n.dirty = true; }
    });
    delete data.docs[id];
    if (data.tomb.docs.indexOf(id) < 0) data.tomb.docs.push(id);
    changed('doc-delete');
  }

  function assign(noteId, docId) {
    var n = data.notes[noteId];
    if (!n) return null;
    if (docId) {
      var d = data.docs[docId];
      if (d) { d.updated_at = nowIso(); d.dirty = true; }  // "recently used" floats up
    }
    return updateNote(noteId, { doc_id: docId || null });
  }

  /* ---------------- legacy + namespace ---------------- */

  function importLegacy() {
    try {
      if (localStorage.getItem(LEGACY_FLAG)) return 0;
      var count = 0, t = nowIso();
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('bwc_notes_') !== 0) continue;
        var key = k.slice('bwc_notes_'.length);
        if (!LESSON_KEY_RE.test(key)) continue;
        var text = String(localStorage.getItem(k) || '').trim();
        // Long texts are split, never cut: losing the tail of an old note is
        // exactly the data loss this whole move exists to prevent.
        for (var p = 0; p < text.length; p += MAX_BODY) {
          var id = uuid();
          data.notes[id] = {
            id: id, lesson_key: key, video_seconds: null, variant: null,
            body: text.slice(p, p + MAX_BODY), doc_id: null,
            created_at: t, updated_at: t, dirty: true, legacy: true,
          };
          count++;
        }
      }
      localStorage.setItem(LEGACY_FLAG, t);  // the bwc_notes_* keys stay as a backup
      if (count) persist();
      return count;
    } catch (e) { return 0; }
  }

  /** הערות שנכתבו בלי חשבון עוברות לחשבון הראשון שמתחבר במכשיר. */
  function adoptAnon() {
    if (!uid) return 0;
    var anon = readNs(NS_PREFIX + 'anon');
    var n = 0;
    Object.keys(anon.docs).forEach(function (id) { data.docs[id] = Object.assign(anon.docs[id], { dirty: true }); n++; });
    Object.keys(anon.notes).forEach(function (id) { data.notes[id] = Object.assign(anon.notes[id], { dirty: true }); n++; });
    if (n) {
      persist();  // written into the user's namespace FIRST...
      try { localStorage.removeItem(NS_PREFIX + 'anon'); } catch (e) {}  // ...then the anon copy goes
    }
    return n;
  }

  function switchUser(newUid) {
    newUid = newUid || null;
    if (newUid === uid && data) return false;
    uid = newUid;
    data = readNs(nsKey());
    adoptAnon();
    // "missing" is a fact about the database, not the user: keep it.
    if (cloud !== 'missing') cloud = 'local';
    emit('user');
    return true;
  }

  /* ---------------- cloud sync ---------------- */

  function client() { return window.bwcSupabase || null; }

  function isMissingTable(err) {
    if (!err) return false;
    var code = String(err.code || '');
    return code === '42P01' || code === 'PGRST205' ||
      /does not exist|schema cache|Could not find the table/i.test(String(err.message || ''));
  }

  function noteRow(n) {
    return {
      id: n.id, user_id: uid, lesson_key: n.lesson_key, video_seconds: n.video_seconds,
      variant: n.variant, body: n.body, doc_id: n.doc_id, created_at: n.created_at, updated_at: n.updated_at,
    };
  }
  function docRow(d) { return { id: d.id, user_id: uid, title: d.title, created_at: d.created_at, updated_at: d.updated_at }; }

  async function selectAll(sb, table, cols) {
    var out = [], from = 0;
    for (;;) {
      var r = await sb.from(table).select(cols).eq('user_id', uid).order('id').range(from, from + PAGE - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < PAGE) return out;
      from += PAGE;
    }
  }

  /** Rows that were sent are marked clean only if they did not change while in flight. */
  function markClean(map, sent) {
    sent.forEach(function (row) {
      var cur = map[row.id];
      if (cur && cur.updated_at === row.updated_at && cur.body === row.body && cur.title === row.title &&
          (cur.doc_id || null) === (row.doc_id || null)) {
        cur.dirty = false;
      }
    });
  }

  async function upsertNotes(sb, rows) {
    if (!rows.length) return;
    var r = await sb.from('lesson_notes').upsert(rows, { onConflict: 'id' });
    if (!r.error) return;
    if (isMissingTable(r.error)) throw r.error;
    // One bad row (typically a doc deleted on another device -> FK 23503)
    // must not block every other note. Retry one by one and un-assign the
    // note whose document is gone.
    for (var i = 0; i < rows.length; i++) {
      var one = await sb.from('lesson_notes').upsert([rows[i]], { onConflict: 'id' });
      if (one.error && String(one.error.code) === '23503' && rows[i].doc_id) {
        rows[i].doc_id = null;
        var n = data.notes[rows[i].id];
        if (n) n.doc_id = null;
        one = await sb.from('lesson_notes').upsert([rows[i]], { onConflict: 'id' });
      }
      if (one.error) throw one.error;
    }
  }

  async function doSync() {
    var sb = client();
    if (!uid || !sb || cloud === 'missing') return;
    if (!navigator.onLine) { cloud = 'error'; emit('sync'); return; }
    var mine = uid;
    cloud = 'syncing'; emit('sync');
    try {
      if (!profileEnsured) {
        try { await sb.rpc('ensure_profile'); } catch (e) { /* migration 003 handles it; non-fatal */ }
        profileEnsured = true;
      }

      // 1. push (documents before notes, the FK points that way)
      var dirtyDocs = values(data.docs).filter(function (d) { return d.dirty; }).map(docRow);
      if (dirtyDocs.length) {
        var rd = await sb.from('note_docs').upsert(dirtyDocs, { onConflict: 'id' });
        if (rd.error) throw rd.error;
      }
      var dirtyNotes = values(data.notes).filter(function (n) { return n.dirty; }).map(noteRow);
      await upsertNotes(sb, dirtyNotes);

      var tombNotes = data.tomb.notes.slice(), tombDocs = data.tomb.docs.slice();
      if (tombNotes.length) {
        var dn = await sb.from('lesson_notes').delete().in('id', tombNotes);
        if (dn.error) throw dn.error;
      }
      if (tombDocs.length) {
        var dd = await sb.from('note_docs').delete().in('id', tombDocs);
        if (dd.error) throw dd.error;
      }
      if (uid !== mine) return;  // the user switched mid-flight; drop the result
      markClean(data.docs, dirtyDocs);
      markClean(data.notes, dirtyNotes);
      data.tomb.notes = data.tomb.notes.filter(function (id) { return tombNotes.indexOf(id) < 0; });
      data.tomb.docs = data.tomb.docs.filter(function (id) { return tombDocs.indexOf(id) < 0; });

      // 2. pull + merge
      var sDocs = await selectAll(sb, 'note_docs', 'id,title,created_at,updated_at');
      var sNotes = await selectAll(sb, 'lesson_notes', 'id,lesson_key,video_seconds,variant,body,doc_id,created_at,updated_at');
      if (uid !== mine) return;
      merge(data.docs, sDocs, data.tomb.docs);
      merge(data.notes, sNotes, data.tomb.notes);

      persist();
      cloud = 'synced';
      lastSyncAt = Date.now();
      emit('sync');
    } catch (err) {
      if (isMissingTable(err)) {
        cloud = 'missing';
        console.info('[notes] cloud tables not found (migration 011 not run yet). Notes stay local.');
      } else {
        cloud = 'error';
        console.warn('[notes] sync failed, will retry', err && (err.code || err.message), err);
      }
      persist();
      emit('sync');
    }
  }

  /** Server rows win unless the local copy has unsent changes. Local clean rows
      the server no longer has were deleted on another device. */
  function merge(local, rows, tomb) {
    var seen = {};
    rows.forEach(function (row) {
      seen[row.id] = true;
      if (tomb.indexOf(row.id) >= 0) return;
      var cur = local[row.id];
      if (cur && cur.dirty) return;
      local[row.id] = Object.assign({}, row, { dirty: false });
    });
    Object.keys(local).forEach(function (id) {
      if (!seen[id] && !local[id].dirty) delete local[id];
    });
  }

  function syncNow() {
    if (syncing) return syncing;
    syncing = doSync().finally(function () { syncing = null; });
    return syncing;
  }

  function scheduleSync(ms) {
    if (!uid || cloud === 'missing') return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncTimer = null; syncNow(); }, ms || 0);
  }

  /* ---------------- AI (api/notes-ai.js) ---------------- */

  async function authToken() {
    var sb = client();
    if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      return (r && r.data && r.data.session && r.data.session.access_token) || null;
    } catch (e) { return null; }
  }

  async function callAi(payload) {
    if (window.bwcApi && !window.bwcApi.available) return { error: 'api_unavailable' };
    var token = await authToken();
    if (!token) return { error: 'auth_required' };
    try {
      var res = await fetch('/api/notes-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload),
      });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok || !json.ok) return { error: json.reason || ('http_' + res.status) };
      return json;
    } catch (e) { return { error: 'network' }; }
  }

  function suggest(noteId) {
    var n = data.notes[noteId];
    if (!n) return Promise.resolve({ error: 'no_note' });
    var list = docs().slice(0, 60).map(function (d) {
      var first = notesForDoc(d.id)[0];
      return { id: d.id, title: d.title, sample: first ? first.body.slice(0, 160) : '' };
    });
    return callAi({
      action: 'suggest',
      note: { body: n.body, lessonTitle: lessonInfo(n.lesson_key).title },
      docs: list,
    });
  }

  function draft(docId) {
    var d = data.docs[docId];
    if (!d) return Promise.resolve({ error: 'no_doc' });
    var notes = notesForDoc(docId).map(function (n) {
      return { lesson: lessonInfo(n.lesson_key).title, time: formatTime(n.video_seconds), body: n.body };
    });
    if (!notes.length) return Promise.resolve({ error: 'empty_doc' });
    return callAi({ action: 'draft', title: d.title, notes: notes });
  }

  /** טקסט גולמי להעתקה, בלי AI: כל ההערות של המסמך לפי סדר הקורס. */
  function plainText(docId) {
    var d = data.docs[docId];
    var lines = [d ? d.title : 'הערות בלי מסמך', ''];
    var last = null;
    notesForDoc(docId || null).forEach(function (n) {
      if (n.lesson_key !== last) {
        var info = lessonInfo(n.lesson_key);
        lines.push('## ' + info.title);
        last = n.lesson_key;
      }
      var t = formatTime(n.video_seconds);
      lines.push((t ? '[' + t + '] ' : '') + n.body, '');
    });
    return lines.join('\n').trim();
  }

  /* ---------------- boot ---------------- */

  function currentUserId() {
    try { var u = window.bwcAuth && window.bwcAuth.getUser(); return (u && u.id) || null; }
    catch (e) { return null; }
  }

  function boot() {
    uid = currentUserId();
    data = readNs(nsKey());
    adoptAnon();
    importLegacy();
    readyResolve();
    emit('ready');
    scheduleSync(0);

    window.addEventListener('bwc:auth-change', function (ev) {
      var u = ev && ev.detail && ev.detail.user;
      if (switchUser(u && u.id)) scheduleSync(0);
    });
    window.addEventListener('focus', function () {
      if (Date.now() - lastSyncAt > 60000) scheduleSync(0);
    });
    window.addEventListener('online', function () { if (cloud === 'error') scheduleSync(0); });
    // Another tab wrote notes: reload the namespace so both tabs agree.
    window.addEventListener('storage', function (ev) {
      if (ev.key === nsKey()) { data = readNs(nsKey()); emit('storage'); }
    });
  }

  // auth.js resolves the session asynchronously; wait for it (bounded) so the
  // first render already shows the right account's notes.
  function start() {
    var tries = 0;
    (function wait() {
      if (window.bwcAuth && typeof window.bwcAuth.ready === 'function') {
        var done = false;
        var go = function () { if (!done) { done = true; boot(); } };
        window.bwcAuth.ready().then(go, go);
        setTimeout(go, 4000);
      } else if (tries++ < 20) {
        setTimeout(wait, 100);
      } else {
        boot();  // no auth on this page (or it failed to load): local only
      }
    })();
  }

  window.bwcNotes = {
    ready: function () { return readyPromise; },
    notesForLesson: notesForLesson,
    notesForDoc: notesForDoc,
    allNotes: function () { return values(data.notes).sort(byCourse); },
    docs: docs,
    doc: function (id) { return data.docs[id] || null; },
    note: function (id) { return data.notes[id] || null; },
    addNote: addNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    createDoc: createDoc,
    renameDoc: renameDoc,
    deleteDoc: deleteDoc,
    assign: assign,
    suggest: suggest,
    draft: draft,
    plainText: plainText,
    lessonInfo: lessonInfo,
    lessonHref: lessonHref,
    formatTime: formatTime,
    cloudState: function () { return cloud; },
    isLoggedIn: function () { return !!uid; },
    syncNow: syncNow,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
