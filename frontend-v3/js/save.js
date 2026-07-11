var SaveGame = (function () {
  var STORAGE_KEY = 't9wizard.save';
  var CHUNK_KEY_PREFIX = 't9wizard.save.chunk.';
  var SAVE_VERSION = 1;

  // Only PLAYING/BOSS/PAUSED carry anything worth resuming — MENU has
  // nothing in progress, and GAMEOVER/WIN are explicitly cleared elsewhere.
  // TRANSITION is deliberately never saved (it's a brief ~2s interstitial;
  // closing the app in that exact window just resumes from the last real
  // checkpoint instead, which is an acceptable, rare edge case).
  function save(state) {
    var resumeMode = state.mode === 'paused' ? state.pausedFromMode : state.mode;
    if (resumeMode !== 'playing' && resumeMode !== 'boss') return;

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
      seed: state.seed,
      // currentChunk is hard-capped at INPUT_LOG_CHUNK_SIZE (game.js) --
      // completed chunks live under their own CHUNK_KEY_PREFIX keys (see
      // saveLogChunk), written once each and never re-serialized here, so
      // this payload's size stays flat regardless of how long the run has
      // been going.
      currentChunk: state.currentChunk,
      chunkCount: (state.completedChunks || []).length,
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
      rngState: Rng.getState()
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Storage can fail (quota, private-browsing mode, disabled entirely) —
      // saving is a nice-to-have convenience, never allowed to break the game.
    }
  }

  // Called once per filled chunk (see INPUT_LOG_CHUNK_SIZE in game.js),
  // never from the hot-path save() above -- a filled chunk is written
  // exactly once, at a fixed size, and never touched again, which is what
  // actually keeps save()'s cost constant regardless of how far into the
  // run the player already is.
  function saveLogChunk(chunkNumber, chunk) {
    try {
      window.localStorage.setItem(CHUNK_KEY_PREFIX + chunkNumber, JSON.stringify(chunk));
    } catch (e) {
      // Storage can fail (quota, private-browsing mode, disabled entirely) —
      // saving is a nice-to-have convenience, never allowed to break the game.
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

    var completedChunks = [];
    for (var i = 1; i <= (parsed.chunkCount || 0); i++) {
      var chunkRaw = null;
      try {
        chunkRaw = window.localStorage.getItem(CHUNK_KEY_PREFIX + i);
      } catch (e) {}
      // A missing/corrupt chunk makes the whole save unusable -- a gap here
      // would make the eventual submitted input_log incomplete, and the
      // server's replay would diverge and reject the score. Better to fall
      // back to "no resumable save" (same as a bad saveVersion/resumeMode
      // above) than resume into a run that can never legitimately submit.
      if (!chunkRaw) return null;
      try {
        completedChunks.push(JSON.parse(chunkRaw));
      } catch (e) {
        return null;
      }
    }
    parsed.completedChunks = completedChunks;
    return parsed;
  }

  // Reads the meta key's own chunkCount first (rather than looping over a
  // hardcoded guess) so this stays correct regardless of how long a run got
  // before it was cleared -- a long run can rack up more than a handful of
  // INPUT_LOG_CHUNK_SIZE-sized chunks.
  function clear() {
    var chunkCount = 0;
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) chunkCount = JSON.parse(raw).chunkCount || 0;
    } catch (e) {
      // ignore -- worst case we just don't know how many chunk keys to
      // clean up below, same as if there was never a save to begin with.
    }
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    for (var i = 1; i <= chunkCount; i++) {
      try {
        window.localStorage.removeItem(CHUNK_KEY_PREFIX + i);
      } catch (e) {
        // ignore
      }
    }
  }

  return { save: save, saveLogChunk: saveLogChunk, load: load, clear: clear };
})();
