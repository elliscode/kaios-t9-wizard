// Deterministic PRNG (mulberry32) so a run's randomness is fully reproducible
// from a single seed -- lets a played run be re-simulated later (replayRun in
// js/game.js) from just the seed plus the input log, for score verification.
// Not cryptographic; doesn't need to be.
var Rng = (function () {
  var state = 0;

  function seed(s) {
    state = s >>> 0;
  }

  // Returns a float in [0, 1), same contract as Math.random().
  function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // The internal generator state (distinct from the original seed) advances
  // on every next() call. Resuming a saved run must restore *this*, not
  // re-seed from the original seed -- otherwise post-resume randomness would
  // restart from the beginning of the sequence instead of continuing where
  // the live session left off, diverging from what a from-scratch replay of
  // the same seed + input log would produce.
  function getState() {
    return state;
  }

  function setState(s) {
    state = s >>> 0;
  }

  return { seed: seed, next: next, getState: getState, setState: setState };
})();
