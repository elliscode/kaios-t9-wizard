var SaveGame = (function () {
  var STORAGE_KEY = 't9wizard.save';
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
      inputLog: state.inputLog,
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
    return parsed;
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  }

  return { save: save, load: load, clear: clear };
})();
