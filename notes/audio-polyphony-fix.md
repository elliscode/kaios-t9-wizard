# Deferred: same-sound polyphony/stacking fix in `audio.js`

**Status:** Not implemented. Shelved after investigating a "choppy audio deeper into a run"
report — this turned out not to be the cause of that specific symptom (see
`git log`/session notes around the `INPUT_LOG_CHUNK_SIZE` fix in `game.js`/`save.js` for what
actually was). Kept here in case a *different* choppiness symptom shows up later that this
would actually fix.

## The problem this would fix

`frontend-v3/js/audio.js`'s `scheduleSfx`/`playTone` has no polyphony handling at all. Every
`AudioEngine.play(sfx)` call creates a brand-new oscillator scheduled at
`context.currentTime + SCHEDULE_LOOKAHEAD` (30ms), with no awareness of any other instance of
that same sound already sounding. If the *same* short chirp (e.g. `SFX.HIT`) gets triggered
twice within a ~30-50ms window, both instances start at nearly the same `when`, and their
oscillators sum/interfere on the same output — audible as a garbled, clipped, "cut off" chirp
instead of two clean ones.

This is a real, deterministic gameplay path, not just a hypothetical: `checkCollisions()`
(`game.js`, `function checkCollisions()`) iterates `state.enemies` and calls
`AudioEngine.play(SFX.HIT)` **inside the loop**, once per enemy that reaches the player in that
tick — if 2+ enemies escape in the same tick, `HIT` fires 2+ times back-to-back synchronously.
Enemy fall speed and spawn density both scale up with world/wave, so simultaneous escapes
become more likely in later waves.

**Why this did NOT explain the reported "SUCCESS chirp gets choppy deeper into a run"
symptom:** `SUCCESS` only ever fires once per real keypress (`applyTypingResult`/
`handleDigitKey`), never in a loop — it can't self-overlap the way `HIT` can from
`checkCollisions`'s forEach. The user's own typing rate also doesn't change over a run, so the
*trigger rate* for `SUCCESS` stays constant throughout — ruling out a same-sound-stacking
explanation for that specific chirp. (The actual fix for that symptom was capping
`SaveGame.save()`'s hot-path serialization cost via chunked `inputLog` storage — see
`INPUT_LOG_CHUNK_SIZE` in `game.js`.)

## The fix, if/when needed

Track, per distinct `sfx` spec object (identity, not by name — `SFX.KILL`/`SFX.HIT`/etc. are
stable object references every call), the absolute `AudioContext` time its most recently
scheduled instance finishes. A new trigger for that *same* spec is never allowed to start
before the previous instance has finished — it's pushed later instead of dropped, so rapid
legitimate repeats (e.g. two enemies escaping the same tick) still both play, back-to-back and
clean, instead of summing into noise. Different sound types are unaffected and can still
overlap each other freely (that's fine/desired).

```js
// Per-sfx-object last-scheduled-end time -- stops repeats of the *same*
// sound from starting on top of each other (e.g. two enemies escaping in
// the same tick both trigger HIT), which otherwise sums/interferes into a
// garbled, "cut off"-sounding chirp. Different sfx are unaffected.
var lastScheduledEnd = new WeakMap();

function scheduleSfx(context, sfx) {
  var earliestStart = context.currentTime + SCHEDULE_LOOKAHEAD;
  var prevEnd = lastScheduledEnd.get(sfx) || 0;
  var when = Math.max(earliestStart, prevEnd);
  if (sfx.notes) {
    sfx.notes.forEach(function (note) {
      playTone(context, when, note);
      when += note.duration + (note.gap || 0);
    });
  } else {
    playTone(context, when, sfx);
    when += sfx.duration || 0.1;
  }
  lastScheduledEnd.set(sfx, when);
}
```

No change needed to `playTone`, `play()`, or `sfx.js`. `WeakMap` is a built-in (not new syntax
the codebase otherwise avoids) and the runtime already relies on comparable ES6 APIs
(`AudioContext`, `Promise`), so this should be safe on the same target as the rest of the audio
engine.

## Verification, if implemented

- Mock `AudioContext`/oscillator (a fake `createOscillator`/`createGain` that records every
  `start(when)` call), trigger `AudioEngine.play(SFX.HIT)` twice back-to-back synchronously
  (simulating two enemies escaping in the same tick), and assert the second call's scheduled
  `when` is >= the first call's `when + duration` (no overlap) rather than being ~equal to it
  (the bug this fixes).
- Re-run the existing sfx regression scripts (`drive-sfx2.js`, `drive-sfx3.js`,
  `drive-hit-sound-and-name.js`) to confirm normal single-trigger sound sequences are
  unaffected (same sfx names still fire, same order).
