# T9 Wizard

A "Typing of the Dead"-style typing-combat game built for KaiOS feature phones — instead of a QWERTY keyboard, you fight off incoming words using the T9 numeric keypad (2-9).

Colored blocks carrying a word fall from the top of the screen toward a grey player block at the bottom. Type the T9 digit sequence for a word before its block reaches the player to destroy it. Let one through and you lose a life; run out of lives and it's game over. It's a 50-wave roguelike run: 5 "worlds" of 10 waves each, with a typing boss fight at the end of every world.

## How it plays

- **Canvas**: fills whatever the real browser viewport is, exactly — no fixed resolution, no letterboxing, no scrolling. See [Layout](#layout--hud) below.
- **T9 typing**: words are typed by their numeric-keypad encoding (2=ABC, 3=DEF, 4=GHI, 5=JKL, 6=MNO, 7=PQRS, 8=TUV, 9=WXYZ). E.g. "butterfly" → `288837359`.
- **Targeting (lock-on)**: pressing a digit locks onto a candidate whose code starts with it. Powerups always win an ambiguous match over enemies (they're time-limited and worth prioritizing); within the same kind, whichever is closest to the player wins. Once locked, that target **cannot** be changed or abandoned — wrong digits are simply ignored (no penalty, no reset) until the locked code is fully typed.
- **Lives**: start with 3, shown as red squares in the bottom-left HUD corner (uncapped — extra-life powerups can push it higher; past 5 it collapses to a `+N` suffix). An enemy or boss sentence reaching the player costs one life; 0 lives ends the run.
- **Waves & Worlds**: defeating (or losing) all of a wave's enemies advances it. 10 waves make a World; a boss fight follows every World's 10th wave. Word length scales per-World via a shifting window (World 1 = lengths 2-6 ramping across its waves, up to World 5 = 10-12), and enemy color is a deterministic gradient by word length (LightGray → LimeGreen → Gold → DarkOrange → Crimson → DeepPink). A full-screen "WORLD N / WAVE M" (or "BOSS") announcement shows between stages. See `WORLD_LENGTH_RANGES`, `getWordLengthRangeForWave`, and `Colors.colorForWordLength` in `js/game.js`/`js/colors.js`.
- **Bosses**: a large colored block with a health bar (`3 + (world-1)*2` segments). One real sentence at a time (pulled from classic public-domain novels, see [Sentence data](#sentence-data)) falls toward the player like an enemy — complete it in time to chip a health segment and get a new sentence; let it reach the player and lose a life instead (health unchanged). Long sentences word-wrap under the boss.
- **Powerups**: killing a regular enemy has a small independent chance (tunable per type) to spawn a colored block that rises *away* from the player at the kill's location. Type its short code before it scrolls off-screen to collect it — miss it and it's lost, no penalty. Four types: **extra life** (white), **half speed** (lightblue, halves enemy fall speed for 10s), **half length** (lightcoral, shrinks word lengths — including every enemy currently on screen — for 10s), **screen wipe** (khaki, instantly clears all on-screen enemies). Collecting one flashes its name for 2s over live gameplay; a wave won't advance until any on-screen powerups and any in-progress flash have resolved, even if the last enemy is already gone.
- **Pause**: press **1** during play to pause/resume (blocks/boss stay visible but their words are hidden, to prevent reading ahead while frozen). The game also auto-pauses if a frame gap exceeds 500ms (tab backgrounded/suspended), and proactively pauses via `visibilitychange` the instant the tab is hidden.
- **Word list**: a curated, filtered list of common conversational English words (not the full dictionary) — see [Word data](#word-data) below.

## Project structure

```
index.html              Canvas + script tags (load order matters)
manifest.webapp         Minimal KaiOS app manifest
css/style.css           Canvas fills the viewport exactly (no letterboxing)
js/
  layout.js             Sizes the canvas to the real viewport (window.innerWidth/innerHeight)
  t9.js                 Letter -> T9 digit map + wordToT9Code() (skips unmapped chars, e.g. spaces)
  words.js              WordBank: picks a random word for a given length range
  sentences.js          SentenceBank: picks a boss sentence for a given difficulty tier
  enemy.js              Enemy data factory
  powerup.js            Powerup data factory
  boss.js               Boss data factory
  colors.js             Word-length -> color gradient + per-world boss colors
  input.js              InputEngine: the lock-on/typing state machine (core mechanic)
  render.js             All canvas drawing (play field, entities, HUD overlay, screen overlays)
  game.js               State machine, game loop, waves/worlds/bosses/powerups, pause
  main.js                Bootstrap: wires up keydown handling and starts the game
data/
  words-data.js          Hard-coded word-by-length data (`WORDS_BY_LENGTH`), loaded via
                          a plain <script> tag — no fetch(), no build step, works from file://
  sentences-data.js       Hard-coded boss sentences by difficulty tier (`SENTENCES_BY_TIER`),
                          same loading convention as words-data.js
icons/                  Placeholder app icons (solid color, for the KaiOS manifest)
release.sh              Uploads all .js/.html/.webapp/.css files to S3 (see script for bucket/prefix)
```

## Running it

No build step, no dependencies, no server required — just open `index.html` directly in a browser (`file://` works fine, since all game data is a plain script include rather than fetched).

For on-device KaiOS testing, sideload the directory as a packaged app using `manifest.webapp`.

Controls: digit keys **2-9** to type, **1** to start/restart/pause/resume.

## Layout & HUD

`js/layout.js` sets the canvas's actual drawing resolution to match `window.innerWidth`/`window.innerHeight` exactly at load, and the CSS displays it 1:1 (`width:100vw; height:100vh`) — so the game always fills the real available viewport with no letterboxing and no scrolling, regardless of how much vertical space a given browser's chrome reserves. There's no separate reserved HUD strip: `renderHUD` (`js/render.js`) draws the lives squares and wave/boss label as a small overlay directly on the play field's bottom corners, rendered last each frame so it's always on top and visible through every other screen (pause/menu/transition/etc).

## Word data

`data/words-data.js` is hand-maintained (not regenerated by a build script — the original generation pipeline and source dictionary were removed once the list was finalized). It started from a frequency-ranked common-English-words list, filtered to drop acronyms/abbreviations/brand names, patched for a few common words a dictionary cross-check had incorrectly dropped, and then hand-reviewed to strip profanity, slurs, sexual-content terms, and a few sensitive-topic words (e.g. violent/traumatic terms) that aren't a good fit for a general-audience game. Currently ~6,500 words across lengths 2-12. If you need to add or remove words, edit the arrays in `data/words-data.js` directly.

## Sentence data

`data/sentences-data.js` holds hand-curated boss sentences, keyed by difficulty tier 1-5 (tier N feeds World N's boss directly). Sentences are verified quotes from the current top-5 most-downloaded Project Gutenberg books (Moby Dick, Pride and Prejudice, Romeo and Juliet, A Room with a View, Crime and Punishment), lowercased and stripped of all punctuation (`[a-z ]+` only, contractions collapsed rather than split — `"it's"` → `"its"`). Pools are intentionally large (31-52 per tier) so a boss fight never feels repetitive; `js/game.js` also tracks every sentence used in the current run (`state.usedSentences`) so a line never repeats across a single playthrough. Edit the arrays directly to add more.

## Tuning knobs

Game feel lives as named constants at the top of `js/game.js` — e.g. `SPAWN_INTERVAL_MS`, `ENEMY_SPEED_JITTER`, `enemyFallSpeedForLength`/`bossSentenceSpeedForWorld` (formulas), `WORLD_LENGTH_RANGES`, `BASE_BOSS_HEALTH_SEGMENTS`, `ENEMIES_PER_WAVE`, `TRANSITION_DURATION_MS`, `AUTO_PAUSE_THRESHOLD_MS`, and the `POWERUP_*` constants (probabilities, colors, display names, effect/flash durations, rise speed, code length). Only word length and enemy/boss speed scale with world/wave by design; spawn rate is intentionally flat.

## Current status

Implemented: full roguelike loop (50 waves / 5 worlds / boss per world), T9 encoding, lock-on typing engine (with kind-aware tie-break, closest-to-player fallback, and unbreakable locks), word bank, sentence bank with no-repeat tracking, boss fights with health bars and word-wrapped multi-sentence typing, all four powerups, manual + auto-pause, dynamic viewport-filling canvas with an always-visible HUD overlay, win/game-over/restart flow.

Not yet implemented: visual theme/sprites (enemies, powerups, boss, and player are still plain colored rectangles — icons are planned per-powerup), sound/music, and everything in the TODO list below.

## TODO

- [ ] Add score (separate from wave/kill count)
- [ ] Add a global leaderboard — needs anti-cheat consideration; **research needed** on how to do this safely (e.g. server-side score validation, replay verification, rate limiting) before implementing
- [ ] Sprite art / visual theme (enemies, powerups, boss, and player currently placeholder rectangles; powerups specifically are meant to get unique icons)
- [ ] Sound and music
