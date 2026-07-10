// Declarative sound "recipes" for js/audio.js -- plain data, no logic, no
// dependency on Audio itself, so this file (and this file alone) is safe to
// tweak/tune without touching the playback engine. Frequencies can be a
// note name ('C5') or a raw Hz number; Audio.noteToFreq handles the lookup.
//
// NOTE: WIN is an original short fanfare "in the style of" a classic RPG
// victory jingle, not a transcription of any specific existing melody.
var SFX = {
  // Start game / next wave / boss incoming -- one shared cue (see
  // enterTransition in game.js), a quick bright ascending chime like an
  // appliance "done" tone.
  JINGLE: {
    notes: [
      { wave: "triangle", freq: "G5", duration: 0.09, volume: 0.18 },
      { wave: "triangle", freq: "C6", duration: 0.09, volume: 0.18 },
      { wave: "triangle", freq: "E6", duration: 0.16, volume: 0.2 },
    ],
  },

  // Every correct keypress that doesn't finish the word -- deliberately
  // tiny and soft so it can play dozens of times a minute without becoming
  // annoying. See KILL/POWERUP below for what plays on the *completing*
  // keypress instead.
  SUCCESS: { wave: "sine", freq: 1400, duration: 0.05, volume: 0.15, attack: 0.002, release: 0.02 },

  // Defeating an enemy (or completing a boss sentence) -- the same tiny
  // "tap" as SUCCESS, just modulated up a fourth (5 semitones) so the
  // completing keystroke reads as a distinct, slightly brighter chirp.
  KILL: { wave: "sine", freq: 1400 * Math.pow(2, 5 / 12), duration: 0.05, volume: 0.17, attack: 0.002, release: 0.02 },

  // Collecting a powerup -- a quick two-note "cha-ching" instead of the
  // enemy-defeated chirp, so a powerup pickup always reads as a distinctly
  // bigger, more exciting moment than an ordinary kill.
  POWERUP: {
    notes: [
      { wave: "square", freq: "E6", duration: 0.05, volume: 0.2 },
      { wave: "square", freq: "G6", duration: 0.1, volume: 0.22 },
    ],
  },

  // Game over (out of lives) -- a slow descending minor run ending on a
  // note that sags further flat via endFreq, the classic "sad trombone"
  // shape, played soft on a triangle wave to keep it melancholy rather than
  // harsh.
  GAME_OVER: {
    notes: [
      { wave: "triangle", freq: "A4", duration: 0.18, volume: 0.18 },
      { wave: "triangle", freq: "G4", duration: 0.18, volume: 0.18 },
      { wave: "triangle", freq: "F4", duration: 0.18, volume: 0.18 },
      { wave: "triangle", freq: "E4", endFreq: "D4", duration: 0.55, volume: 0.2 },
    ],
  },

  // A real typing mistake (see applyTypingResult in game.js) -- also drives
  // the existing red error-flash.
  ERROR: { wave: "square", freq: 170, duration: 0.2, volume: 0.22, attack: 0.005, release: 0.04 },

  // An enemy or boss sentence reaching the player -- the same buzzer as
  // ERROR, dropped an octave, so the two are distinguishable by ear: a
  // mistake reads as a short buzz, getting hit reads as a deeper thud.
  // See checkCollisions/checkBossCollision in game.js.
  HIT: { wave: "square", freq: 170 / 2, duration: 0.2, volume: 0.22, attack: 0.005, release: 0.04 },

  // Beating the game (all 5 worlds) -- a short two-phrase fanfare: a rising
  // arpeggio held on a first peak, then a faster second run up to a longer
  // sustained final note.
  WIN: {
    notes: [
      { wave: "square", freq: "C5", duration: 0.12, volume: 0.2 },
      { wave: "square", freq: "E5", duration: 0.12, volume: 0.2 },
      { wave: "square", freq: "G5", duration: 0.12, volume: 0.2 },
      { wave: "square", freq: "C6", duration: 0.22, volume: 0.22, gap: 0.06 },
      { wave: "square", freq: "G5", duration: 0.1, volume: 0.2 },
      { wave: "square", freq: "C6", duration: 0.1, volume: 0.2 },
      { wave: "square", freq: "E6", duration: 0.1, volume: 0.2 },
      { wave: "square", freq: "G6", duration: 0.45, volume: 0.25 },
    ],
  },
};
