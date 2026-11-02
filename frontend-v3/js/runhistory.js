// The YOUR RUNS screen's data: the last few runs played on this device, newest
// first. Purely local (localStorage) and deliberately not part of the replayed
// game logic -- Game only records a run from live play (see noteRunEnd), never
// from replayRun, so the replay Lambda's sandbox (which doesn't load this
// file) is unaffected. Kept under its own keys, separate from SaveGame's, so
// clearing a saved run never clears history.
//
// For a run that could still go on the leaderboard, the exact /submit payload
// (minus the display name) is kept too, so a submission that failed -- no
// signal, a timeout -- can be retried later from the run's details screen.
// Its input log is stored packed (js/bitlog.js, ~2 bytes per keypress) under
// a per-run key, and deleted once the run is submitted or can never be.
var RunHistory = (function () {
  var STORAGE_KEY = 't9wizard.runs';
  var PAYLOAD_KEY_PREFIX = 't9wizard.runs.payload.';
  var MAX_RUNS = 10;

  function list() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var runs = raw ? JSON.parse(raw) : [];
      return Array.isArray(runs) ? runs : [];
    } catch (e) {
      return [];
    }
  }

  function write(runs) {
    // Runs pushed past the cap take their stored payloads with them.
    runs.slice(MAX_RUNS).forEach(function (r) { deletePayload(r.runId); });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
    } catch (e) {
      // Never let history break the game -- same philosophy as SaveGame.
    }
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var CHUNK = 0x2000; // keep String.fromCharCode's argument count small
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function savePayload(runId, payload) {
    try {
      var stored = {};
      Object.keys(payload).forEach(function (k) { if (k !== 'input_log') stored[k] = payload[k]; });
      stored.input_log_count = payload.input_log.length;
      stored.input_log_packed = bytesToBase64(BitLog.packInputLog(payload.input_log));
      window.localStorage.setItem(PAYLOAD_KEY_PREFIX + runId, JSON.stringify(stored));
      return true;
    } catch (e) {
      return false; // e.g. storage full -- the run just won't be resubmittable
    }
  }

  // The /submit payload saved for runId, minus display_name, or null.
  function loadPayload(runId) {
    if (!runId) return null;
    try {
      var raw = window.localStorage.getItem(PAYLOAD_KEY_PREFIX + runId);
      if (!raw) return null;
      var stored = JSON.parse(raw);
      var payload = {};
      Object.keys(stored).forEach(function (k) {
        if (k !== 'input_log_count' && k !== 'input_log_packed') payload[k] = stored[k];
      });
      payload.input_log = BitLog.unpackInputLog(base64ToBytes(stored.input_log_packed), stored.input_log_count);
      return payload;
    } catch (e) {
      return null;
    }
  }

  function deletePayload(runId) {
    if (!runId) return;
    try {
      window.localStorage.removeItem(PAYLOAD_KEY_PREFIX + runId);
    } catch (e) {
      // ignore
    }
  }

  // outcome: 'gameover' | 'win' | 'quit'. submitPayload is given only for a
  // run that could be submitted (see Game.noteRunEnd).
  function record(run, submitPayload) {
    var runs = list();
    var saved = !!(submitPayload && run.runId && savePayload(run.runId, submitPayload));
    runs.unshift({
      at: Date.now(),
      runId: run.runId || null,
      startedAt: run.startedAt || null,
      outcome: run.outcome,
      score: Math.floor(run.score),
      world: run.world,
      wave: run.wave,
      hasPayload: saved,
      submitted: false,
      gone: false
    });
    write(runs);
  }

  function update(runId, change) {
    if (!runId) return;
    var runs = list();
    runs.forEach(function (r) { if (r.runId === runId) change(r); });
    write(runs);
  }

  // A 2xx /submit: on the leaderboard, never resubmittable.
  function markSubmitted(runId) {
    update(runId, function (r) { r.submitted = true; r.hasPayload = false; });
    deletePayload(runId);
  }

  // A 404 /submit: the server no longer has the run (already submitted, or
  // expired), so a retry can never succeed.
  function markGone(runId) {
    update(runId, function (r) { r.gone = true; r.hasPayload = false; });
    deletePayload(runId);
  }

  return {
    list: list,
    record: record,
    loadPayload: loadPayload,
    markSubmitted: markSubmitted,
    markGone: markGone
  };
})();
