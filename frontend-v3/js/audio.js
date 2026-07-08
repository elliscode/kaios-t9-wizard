// Tiny Web Audio synth engine -- no libraries, no sample files. Every sound
// is a "recipe" (js/sfx.js) interpreted into oscillators generated on the
// fly, so the entire sound system costs a few KB of source and effectively
// no memory, which matters on KaiOS hardware. One AudioContext is created
// lazily (on the first play() call, which in practice always happens inside
// a user-gesture-driven keypress, satisfying browsers' autoplay policy) and
// reused forever -- creating a context per sound would be needlessly
// expensive; oscillators themselves are cheap and disposable.
//
// Playing a sound is a nice-to-have, exactly like SaveGame's localStorage
// calls -- any failure (unsupported API, a browser quirk) is swallowed so
// it can never break gameplay.
// Named AudioEngine, not "Audio" -- `Audio` is already the built-in
// <audio>-element constructor global, and shadowing it would be a footgun.
var AudioEngine = (function () {
  var ctx = null;
  var masterGain = null;

  // There's always some hand-off latency between the JS control thread
  // (where currentTime is read and start() is called) and the separate
  // audio-rendering thread that actually executes the schedule. Scheduling
  // exactly at currentTime leaves zero margin for that latency -- on slow
  // hardware it can eat a big chunk of a very short sound's attack, or miss
  // it entirely, while barely registering against a longer sound. This
  // lookahead gives every sound guaranteed headroom without adding
  // noticeable input-to-sound lag.
  var SCHEDULE_LOOKAHEAD = 0.02;

  var NOTE_OFFSETS = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };

  function noteToFreq(note) {
    var match = /^([A-G]#?)(\d)$/.exec(note);
    if (!match) return null;
    var semitoneOffset = NOTE_OFFSETS[match[1]] + (parseInt(match[2], 10) - 4) * 12;
    return 440 * Math.pow(2, semitoneOffset / 12);
  }

  function resolveFreq(freq) {
    return typeof freq === "string" ? noteToFreq(freq) : freq;
  }

  function ensureContext() {
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  // Envelope: linear ramp up (attack) to avoid a click at note-on, hold,
  // then ramp down (release) to avoid a click at note-off -- important even
  // for very short (~50ms) sounds, where a hard on/off step is audible as
  // an unpleasant tick.
  function playTone(context, when, spec) {
    var freq = resolveFreq(spec.freq);
    if (freq == null) return;
    var duration = spec.duration || 0.1;
    var volume = spec.volume != null ? spec.volume : 0.2;
    var attack = spec.attack != null ? spec.attack : 0.005;
    var release = spec.release != null ? spec.release : Math.min(0.05, duration / 2);

    var osc = context.createOscillator();
    var gain = context.createGain();
    osc.type = spec.wave || "sine";
    osc.frequency.setValueAtTime(freq, when);
    if (spec.endFreq != null) {
      var endFreq = resolveFreq(spec.endFreq);
      osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), when + duration);
    }

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + attack);
    gain.gain.setValueAtTime(volume, Math.max(when + attack, when + duration - release));
    gain.gain.linearRampToValueAtTime(0, when + duration);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
    // Explicitly disconnect as soon as playback ends, rather than leaving
    // nodes connected (and thus part of the graph the audio thread has to
    // process every quantum) until garbage collection eventually gets to
    // them.
    osc.onended = function () {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {
        // already disconnected/torn down -- fine.
      }
    };
  }

  // A `sfx` is either a single tone spec, or `{ notes: [...] }` -- a
  // sequence of tone specs played back-to-back (a jingle/fanfare), each
  // optionally followed by a silent `gap` before the next one starts.
  // Scheduled via AudioContext.currentTime offsets (sample-accurate),
  // not setTimeout (which drifts and can stutter under load).
  function scheduleSfx(context, sfx) {
    var when = context.currentTime + SCHEDULE_LOOKAHEAD;
    if (sfx.notes) {
      sfx.notes.forEach(function (note) {
        playTone(context, when, note);
        when += note.duration + (note.gap || 0);
      });
    } else {
      playTone(context, when, sfx);
    }
  }

  function play(sfx) {
    if (!sfx) return;
    try {
      var context = ensureContext();
      if (!context) return;
      if (context.state === "running") {
        scheduleSfx(context, sfx);
      } else if (context.resume) {
        // resume() is async -- scheduling immediately without waiting for
        // it can silently drop the sound. This isn't just a one-time
        // "first sound ever" concern: some browsers suspend an idle
        // context to save power, so this path can be hit again after any
        // pause in play, not only on the very first play() call.
        context.resume().then(function () {
          scheduleSfx(context, sfx);
        }).catch(function () {
          // Nothing we can do -- see the top-level try/catch's comment.
        });
      }
    } catch (e) {
      // Never let a sound failure break gameplay.
    }
  }

  return { play: play, noteToFreq: noteToFreq };
})();
