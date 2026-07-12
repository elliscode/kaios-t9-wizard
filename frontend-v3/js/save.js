var SaveGame = (function () {
  var STORAGE_KEY = 't9wizard.save';
  var CHUNK_KEY_PREFIX = 't9wizard.save.chunk.';
  var SAVE_VERSION = 1;

  // In-memory only (never itself dependent on localStorage, since that's the
  // thing that might be failing) -- lets a caller notice a write failed
  // instead of the try/catch below silently absorbing it forever. See
  // game.js's chunk-flush block for the one place a failure here actually
  // changes behavior (a failed chunk write must never be treated as flushed);
  // everywhere else this is purely diagnostic, reported alongside
  // client_score at submit time.
  var storageFailureCount = 0;
  var lastStorageError = null;

  function recordStorageFailure(e) {
    storageFailureCount++;
    lastStorageError = (e && e.name) ? (e.name + ': ' + e.message) : String(e);
  }

  function getStorageDiagnostics() {
    return { failureCount: storageFailureCount, lastError: lastStorageError };
  }

  // Only PLAYING/BOSS/PAUSED carry anything worth resuming — MENU has
  // nothing in progress, and GAMEOVER/WIN are explicitly cleared elsewhere.
  // TRANSITION is deliberately never saved (it's a brief ~2s interstitial;
  // closing the app in that exact window just resumes from the last real
  // checkpoint instead, which is an acceptable, rare edge case).
  // Returns true if the save either succeeded or legitimately wasn't needed
  // (wrong mode to persist), false only on an actual write failure -- lets a
  // caller distinguish "nothing to do" from "tried and failed" if it cares.
  function save(state) {
    var resumeMode = state.mode === 'paused' ? state.pausedFromMode : state.mode;
    if (resumeMode !== 'playing' && resumeMode !== 'boss') return true;

    var payload = {
      saveVersion: SAVE_VERSION,
      resumeMode: resumeMode,
      wave: state.wave,
      lives: state.lives,
      bossRush: state.bossRush,
      spawnedThisWave: state.spawnedThisWave,
      resolvedThisWave: state.resolvedThisWave,
      nextEntityId: state.nextEntityId,
      enemies: state.enemies,
      powerups: state.powerups,
      boss: state.boss,
      halfSpeedRemainingMs: state.halfSpeedRemainingMs,
      halfLengthRemainingMs: state.halfLengthRemainingMs,
      usedSentences: state.usedSentences,
      // Every one of these three feeds directly into *when* things happen
      // tick-by-tick (spawnAccumulator controls exactly which tick the next
      // enemy spawns on, hence which tick consumes the next Rng.next() call
      // for its position; waveCompletePending/powerupFlash gate exactly
      // which tick a wave transition fires). The server's replay is a
      // single continuous simulation with no concept of pausing -- it just
      // runs update() tick after tick from 0. If a resume silently reset
      // any of these (as they used to, before this fix), the *live*
      // session's spawn/transition timing would drift from what that
      // from-scratch replay computes, and every Rng.next() draw from that
      // point on would diverge -- explaining scores coming back far lower
      // (or a different mode entirely) than what was actually played,
      // regardless of how short the run was.
      spawnAccumulator: state.spawnAccumulator,
      waveCompletePending: state.waveCompletePending,
      powerupFlash: state.powerupFlash,
      seed: state.seed,
      // currentChunk is hard-capped at INPUT_LOG_CHUNK_SIZE (game.js) --
      // completed chunks live under their own CHUNK_KEY_PREFIX keys (see
      // saveLogChunk), written once each and never re-serialized here, so
      // this payload's size stays flat regardless of how long the run has
      // been going. Deliberately no chunkCount field here -- see load()'s
      // comment for why a separately-written count can never be trusted.
      currentChunk: state.currentChunk,
      runId: state.runId,
      runStartedAt: state.runStartedAt,
      tickCount: state.tickCount,
      score: state.score,
      scoreMultiplier: state.scoreMultiplier,
      wordCombo: state.wordCombo,
      currentWordHadMistake: state.currentWordHadMistake,
      // The RNG's live generator position, not just the seed -- resuming
      // must continue the same random sequence a from-scratch replay of
      // this seed + input log would produce, not restart it.
      rngState: Rng.getState(),
      // InputEngine is a separate module-level singleton, not part of
      // `state` -- without this, a saved-and-reloaded boss sentence (world
      // 5's run 100+ characters) would resume with the boss's position
      // intact but typed progress silently wiped back to zero. Read
      // directly from the live singleton, same pattern as Rng.getState()
      // above.
      inputBuffer: InputEngine.getBuffer(),
      inputLockedEnemyId: InputEngine.getLockedEnemyId()
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      // Storage can fail (quota, private-browsing mode, disabled entirely) —
      // saving is a nice-to-have convenience, never allowed to break the
      // game -- but the failure itself is recorded (see
      // getStorageDiagnostics) rather than vanishing entirely.
      recordStorageFailure(e);
      return false;
    }
  }

  // Called once per filled chunk (see INPUT_LOG_CHUNK_SIZE in game.js),
  // never from the hot-path save() above -- a filled chunk is written
  // exactly once, at a fixed size, and never touched again, which is what
  // actually keeps save()'s cost constant regardless of how far into the
  // run the player already is.
  // Returns true/false the same way save() does -- the caller (game.js's
  // chunk-flush block) depends on this to know whether it's safe to treat
  // the chunk as durably flushed.
  function saveLogChunk(chunkNumber, chunk) {
    try {
      window.localStorage.setItem(CHUNK_KEY_PREFIX + chunkNumber, JSON.stringify(chunk));
      return true;
    } catch (e) {
      // Storage can fail (quota, private-browsing mode, disabled entirely) —
      // saving is a nice-to-have convenience, never allowed to break the
      // game -- but the failure itself is recorded (see
      // getStorageDiagnostics) rather than vanishing entirely.
      recordStorageFailure(e);
      return false;
    }
  }

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!parsed || parsed.saveVersion !== SAVE_VERSION) return null;
    if (parsed.resumeMode !== 'playing' && parsed.resumeMode !== 'boss') return null;

    parsed.completedChunks = readAllChunks();
    return parsed;
  }

  // Reads chunk.1, chunk.2, ... by directly probing storage, stopping at the
  // first missing or corrupt one -- deliberately NOT driven by a count
  // stored anywhere else. A chunk's own write (saveLogChunk) is a single
  // localStorage.setItem call, so it's atomic on its own; a *separate*
  // "how many chunks exist" counter written afterward never can be truly
  // atomic *with* it, no matter how immediately it follows -- an app kill
  // landing between the two leaves the counter stale (under-claiming what's
  // actually on disk), and a loop bounded by that stale count would never
  // even look for a chunk that's genuinely sitting right there. Probing
  // avoids the second write (and thus the gap) entirely: whatever's
  // durably on disk is exactly what gets found, nothing more coordinated to
  // fall out of sync. A gap partway through (rather than at the very start)
  // is indistinguishable from "that's all there was" here -- both safely
  // stop at the boundary rather than skip over a hole, which is the only
  // sound choice either way (ticks past a real gap can never be validly
  // reassembled into a contiguous input_log).
  function readAllChunks() {
    var chunks = [];
    var i = 1;
    while (true) {
      var chunkRaw = null;
      try {
        chunkRaw = window.localStorage.getItem(CHUNK_KEY_PREFIX + i);
      } catch (e) {
        break;
      }
      if (!chunkRaw) break;
      try {
        chunks.push(JSON.parse(chunkRaw));
      } catch (e) {
        break;
      }
      i += 1;
    }
    return chunks;
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    // Same probing approach as load()/readAllChunks() -- no stored count to
    // trust, so just keep removing consecutively-numbered keys until one
    // isn't there.
    var i = 1;
    while (true) {
      var key = CHUNK_KEY_PREFIX + i;
      var exists;
      try {
        exists = window.localStorage.getItem(key) !== null;
      } catch (e) {
        break;
      }
      if (!exists) break;
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        // ignore
      }
      i += 1;
    }
  }

  return { save: save, saveLogChunk: saveLogChunk, load: load, clear: clear, getStorageDiagnostics: getStorageDiagnostics };
})();
