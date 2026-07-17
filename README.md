# T9 Wizard

A "Typing of the Dead"-style typing-combat game built for KaiOS feature phones — instead of a QWERTY keyboard, you fight off incoming words using the T9 numeric keypad (2-9).

Colored blocks carrying a word fall from the top of the screen toward a grey player block at the bottom. Type the T9 digit sequence for a word before its block reaches the player to destroy it. Let one through and you lose a life; run out of lives and it's game over. It's a 50-wave roguelike run: 5 "worlds" of 10 waves each, with a typing boss fight at the end of every world.

## How it plays

- **Canvas**: fills whatever the real browser viewport is, exactly — no fixed resolution, no letterboxing, no scrolling. See [Layout](#layout--hud) below.
- **T9 typing**: words are typed by their numeric-keypad encoding (2=ABC, 3=DEF, 4=GHI, 5=JKL, 6=MNO, 7=PQRS, 8=TUV, 9=WXYZ). E.g. "butterfly" → `288837359`.
- **Targeting (lock-on)**: pressing a digit locks onto a candidate whose code starts with it. Powerups always win an ambiguous match over enemies (they're time-limited and worth prioritizing); within the same kind, whichever is closest to the player wins. Once locked, that target **cannot** be changed or abandoned — wrong digits are simply ignored (no penalty, no reset) until the locked code is fully typed.
- **Lives**: start with 3, shown as red squares in the bottom-left HUD corner (uncapped — extra-life powerups can push it higher; past 5 it collapses to a `+N` suffix). An enemy or boss sentence reaching the player costs one life; 0 lives ends the run.
- **Waves & Worlds**: defeating (or losing) all of a wave's enemies advances it. 10 waves make a World; a boss fight follows every World's 10th wave. Word length scales per-World via a shifting window (World 1 = lengths 2-6 ramping across its waves, up to World 5 = 10-12), and enemy color is a deterministic gradient by word length (LightGray → LimeGreen → Gold → DarkOrange → Crimson → DeepPink). A full-screen "WORLD N / WAVE M" (or "BOSS") announcement shows between stages. See `WORLD_LENGTH_RANGES`, `getWordLengthRangeForWave`, and `Colors.colorForWordLength` in `frontend-v3/js/game.js`/`frontend-v3/js/colors.js`.
- **Bosses**: a colored block whose width scales with its own health (`3 + (world-1)*2` segments, each ~14px wide) — a tougher boss visibly reads as bigger. Health is carved directly into the block itself: an intact segment is indistinguishable from the rest of the boss's color, and each depleted segment turns background-colored, so defeating it looks like biting chunks out of its body. One real sentence at a time (pulled from classic public-domain novels, see [Sentence data](#sentence-data)) falls toward the player like an enemy — complete it in time to chip a segment and get a new sentence; let it reach the player and lose a life instead (health unchanged). The sentence's text freezes in place once it nears the player so a fast/long sentence can never scroll off-screen unread — the block itself keeps falling and can still collide independently of the frozen text. Long sentences word-wrap under the boss; there's no lock-on outline in boss mode since there's only ever one target.
- **Powerups**: killing a regular enemy has a small independent chance (tunable per type) to spawn a colored block that rises *away* from the player at the kill's location. Type its short code before it scrolls off-screen to collect it — miss it and it's lost, no penalty. At most one powerup ever spawns per kill, even if multiple types' rolls hit at once, so two blocks can never stack unreadably on top of each other. Four types: **extra life** (white), **half speed** (lightblue, halves enemy fall speed for 10s), **half length** (lightcoral, shrinks word lengths — including every enemy currently on screen — for 10s), **screen wipe** (khaki, instantly clears all on-screen enemies). Collecting one flashes its name for 2s over live gameplay; a wave won't advance until any on-screen powerups and any in-progress flash have resolved, even if the last enemy is already gone.
- **Legible overlaps**: the currently-locked word always renders on top of everything else, and — among the rest — a block lower on screen (closer to the player, more urgent) draws over one higher up, with powerups always drawing over enemies. Every word also gets a dim, semi-transparent backing panel so it stays readable no matter what's rendered behind it.
- **Pause**: press **1** during play to pause/resume (blocks/boss stay visible but their words are hidden, to prevent reading ahead while frozen). The game also auto-pauses if a frame gap exceeds 500ms (tab backgrounded/suspended), and proactively pauses via `visibilitychange` the instant the tab is hidden.
- **Save & resume**: progress checkpoints to `localStorage` at natural gameplay moments (kills, powerup pickups, wave/boss transitions, pausing). Closing the tab/app and reopening it restores the run — paused, so you get a moment to get oriented rather than being dropped straight back into falling enemies. See `frontend-v3/js/save.js`.
- **Boss rush (testing mode)**: press **\*** from the main menu to skip straight into World 1's boss and chain directly from one world's boss into the next, world by world, with no regular waves in between — a fast way to iterate on boss balance without replaying every wave. It ends in a distinct "BOSS RUSH COMPLETE" screen rather than "YOU WIN", since it's not a genuine full run.
- **Word list**: a curated, filtered list of common conversational English words (not the full dictionary) — see [Word data](#word-data) below.

## Project structure

```
frontend-v3/
  index.html              Canvas + script tags (load order matters)
  manifest.webmanifest    Minimal KaiOS app manifest (W3C manifest fields + a b2g_features
                           extension block for KaiOS-specific ones like version/permissions)
  css/style.css           Canvas fills the viewport exactly (no letterboxing); also styles
                           the real <input> used for leaderboard name entry
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
    save.js               SaveGame: localStorage checkpoint/restore for pausing/closing mid-run
    audio.js               AudioEngine: tiny Web Audio synth engine (oscillator-based, no samples)
    sfx.js                 Declarative sound "recipes" (jingle, success/kill/powerup chirps, etc.)
    api.js                 Thin fetch wrapper for the backend's /start, /submit, /leaderboard
    nameentry.js            Owns the real <input> used to enter a display name before submitting
    game.js                State machine, game loop, waves/worlds/bosses/powerups, pause, boss rush,
                            scoring/combo/multiplier, and the start/submit/leaderboard round trip
    main.js                Bootstrap: wires up keydown handling and starts the game
  data/
    words-data.js          Hard-coded word-by-length data (`WORDS_BY_LENGTH`), loaded via
                            a plain <script> tag — no fetch(), no build step, works from file://
    sentences-data.js       Hard-coded boss sentences by difficulty tier (`SENTENCES_BY_TIER`),
                            same loading convention as words-data.js
  icons/                  Placeholder app icons (solid color, for the KaiOS manifest)
  release.sh              Uploads all .js/.html/.webapp/.css files to S3 (see script for bucket/prefix)
backend/
  A Python API Lambda (start/submit/leaderboard, DynamoDB-backed) plus a Node.js "replay" Lambda
  that re-simulates a submitted run using this exact frontend game logic to verify its score
  server-side before it counts toward the leaderboard. See backend/README.md for setup,
  versioning (each frontend "season" talks to its own frozen ruleset), and endpoint details.
```

## Running it

No build step, no dependencies — just open `frontend-v3/index.html` directly in a browser (`file://` works fine for loading and playing; all game data is a plain script include, not fetched). The backend calls (`/start`, `/submit`, `/leaderboard`) do use `fetch()`, though, which a `file://` origin can't reach — opened this way, the game plays fully offline (a locally-generated seed instead of a server-issued one, and no leaderboard submission). Serve the directory over `http(s)://` for the full round trip.

For on-device KaiOS testing, sideload the directory as a packaged app using `manifest.webmanifest` (see `frontend-v3/kaios-release.sh` for the exact zip contents the store submission itself uses).

Controls: digit keys **2-9** to type, **1** to start/pause/resume (and, from a game-over or win screen with a submittable run, to enter your name and submit your score — or just to return to the main menu if it isn't submittable; pressing it again from the main menu starts a new run), **\*** from the main menu for boss rush (see above), **0** from the main menu to view the leaderboard.

## Layout & HUD

`frontend-v3/js/layout.js` sets the canvas's actual drawing resolution to match `window.innerWidth`/`window.innerHeight` exactly at load, and the CSS displays it 1:1 (`width:100vw; height:100vh`) — so the game always fills the real available viewport with no letterboxing and no scrolling, regardless of how much vertical space a given browser's chrome reserves. There's no separate reserved HUD strip: `renderHUD` (`frontend-v3/js/render.js`) draws the lives squares and wave/boss label as a small overlay directly on the play field's bottom corners, rendered last each frame so it's always on top and visible through every other screen (pause/menu/transition/etc).

## Word data

`frontend-v3/data/words-data.js` is hand-maintained (not regenerated by a build script — the original generation pipeline and source dictionary were removed once the list was finalized). It started from a frequency-ranked common-English-words list, filtered to drop acronyms/abbreviations/brand names, patched for a few common words a dictionary cross-check had incorrectly dropped, and then hand-reviewed to strip profanity, slurs, sexual-content terms, and a few sensitive-topic words (e.g. violent/traumatic terms) that aren't a good fit for a general-audience game. Currently ~6,500 words across lengths 2-12. If you need to add or remove words, edit the arrays in `frontend-v3/data/words-data.js` directly.

## Sentence data

`frontend-v3/data/sentences-data.js` holds hand-curated boss sentences, keyed by difficulty tier 1-5 (tier N feeds World N's boss directly). Sentences are verified quotes from the current top-5 most-downloaded Project Gutenberg books (Moby Dick, Pride and Prejudice, Romeo and Juliet, A Room with a View, Crime and Punishment), lowercased and stripped of all punctuation (`[a-z ]+` only, contractions collapsed rather than split — `"it's"` → `"its"`). Pools are intentionally large (31-52 per tier) so a boss fight never feels repetitive; `frontend-v3/js/game.js` also tracks every sentence used in the current run (`state.usedSentences`) so a line never repeats across a single playthrough. Edit the arrays directly to add more.

## Tuning knobs

Game feel lives as named constants at the top of `frontend-v3/js/game.js` — e.g. `SPAWN_INTERVAL_MS`, `ENEMY_SPEED_JITTER`, `enemyFallSpeedForLength`/`bossSentenceSpeedForWorld` (formulas), `WORLD_LENGTH_RANGES`, `BASE_BOSS_HEALTH_SEGMENTS`, `BOSS_SEGMENT_WIDTH`/`BOSS_SEGMENT_GAP`/`BOSS_SEGMENT_PADDING` (boss box width is derived from these plus its own health), `ENEMIES_PER_WAVE`, `TRANSITION_DURATION_MS`, `AUTO_PAUSE_THRESHOLD_MS`, and the `POWERUP_*` constants (probabilities, colors, display names, effect/flash durations, rise speed, code length). Only word length and enemy/boss speed scale with world/wave by design; spawn rate is intentionally flat.

## Current status

Implemented: full roguelike loop (50 waves / 5 worlds / boss per world), T9 encoding, lock-on typing engine (with kind-aware tie-break, closest-to-player fallback, and unbreakable locks), word bank, sentence bank with no-repeat tracking, boss fights with in-body health segments and word-wrapped multi-sentence typing (text freezes near the player so it can't scroll off-screen unread), all four powerups (capped at one spawn per kill), draw-order priority so the locked word and lower-on-screen blocks are never visually buried, manual + auto-pause, dynamic viewport-filling canvas with an always-visible HUD overlay, win/game-over/return-to-menu flow, localStorage save/resume across app close, a boss-rush testing mode (`*` from the menu) for iterating on boss balance without replaying every wave, a scoring engine (per-letter combo plus a global multiplier that grows on perfectly-typed words/sentences), oscillator-based sound effects (no sample files — start/wave/boss jingle, success/kill/powerup chirps, error buzzer, win fanfare, game-over jingle), and the full backend round trip: a server-issued seed per run (`POST /start`), replay-verified score submission by name on a genuine win *or* game over (`POST /submit` — the server re-simulates the run itself and only a win/game-over ending it actually produced counts, never what the client claims), and a per-version leaderboard screen (`GET /leaderboard`, press **0** from the menu).

Not yet implemented: visual theme/sprites (enemies, powerups, boss, and player are still plain colored rectangles — icons are planned per-powerup), and everything remaining in the TODO list below.

## TODO

- [x] Add score (separate from wave/kill count)
- [x] Add a global leaderboard — needs anti-cheat consideration; ~~**research needed** on how to do this safely~~ (e.g. server-side score validation, replay verification, rate limiting) before implementing. Boss rush runs are intentionally excluded from ever counting toward it (it's a testing/balance tool, not a real run). Built as server-side replay verification — see `backend/README.md`.
- [x] Record full gameplay events (keypresses, kills, powerups, timestamps) to support post-run stats and an eventual leaderboard submission — designed but not yet built; revisit later. Built as a `{tick, key}` input log recorded during play and replayed server-side to verify a submission; derived stats beyond score aren't computed/stored yet (see TODO Stats below).
- [ ] Sprite art / visual theme (enemies, powerups, boss, and player currently placeholder rectangles; powerups specifically are meant to get unique icons)
- [x] Sound and music


## TODO Stats

## Post-Run / Leaderboard Statistics

### Core Stats
- [x] Score
- [ ] Completion Time
- [x] Game Version / Season
- [ ] Accuracy (%)
- [ ] Highest Multiplier Reached
- [ ] Longest Letter Combo
- [ ] Longest Perfect Word Streak
- [ ] Enemies Defeated
- [ ] Bosses Defeated
- [ ] Lives Lost
- [ ] Extra Lives Earned
- [ ] Maximum Lives Held

### Typing Stats
- [ ] Correct Keypresses
- [ ] Incorrect Keypresses
- [ ] Total Keypresses
- [ ] T9 Efficiency (% Correct Keypresses)
- [ ] Words Completed
- [ ] Words Missed
- [ ] Perfect Words
- [ ] Perfect Word Percentage
- [ ] Average Word Length
- [ ] Longest Word Completed

### Boss Stats
- [ ] Boss Sentences Completed
- [ ] Boss Sentences Failed
- [ ] Boss Accuracy (%)
- [ ] Fastest Boss Sentence

### Powerup Stats
- [ ] Powerups Spawned
- [ ] Powerups Collected
- [ ] Powerups Missed
- [ ] Extra Life Powerups Collected
- [ ] Half Speed Powerups Collected
- [ ] Half Length Powerups Collected
- [ ] Screen Wipe Powerups Collected
- [ ] Enemies Destroyed by Screen Wipes
- [ ] Slow Motion Uptime (%)

### Fun Stats
- [ ] Closest Call (smallest distance from player when an enemy was defeated)
- [ ] Clutch Saves (enemies defeated within X pixels of the player)
- [ ] Most Difficult Word Typed
- [ ] Most Common Word Typed
- [ ] Most Pressed T9 Digit
- [ ] Time Spent Paused
- [ ] Longest Continuous Play Session

### Developer / Balancing Stats
- [ ] Average Reaction Time (spawn → first keypress)
- [ ] Average Lock-On Time
- [ ] Mistakes by Word Length
- [ ] Deaths by World/Wave
- [ ] Powerup Collection Rate by Type
- [ ] Average Multiplier Throughout Run

### Lifetime Stats (Future)
- [ ] Total Runs Played
- [ ] Total Play Time
- [ ] Total Score Earned
- [ ] Total Correct Keypresses
- [ ] Total Characters Typed
- [ ] Total Words Completed
- [ ] Total Bosses Defeated
- [ ] Highest Score
- [ ] Highest Multiplier Ever Reached
- [ ] Longest Letter Combo Ever
- [ ] Longest Perfect Word Streak Ever

# KaiOS Store Submission Fields

## Known Issues

No known issues at this time.

## Simple Test Report

1. Launch the app. Confirm the main menu appears with the title "T9 WIZARD" and the options "Press 1 to start" / "Press * for leaderboard".
2. Press **1**. Confirm a brief full-screen "WORLD 1 / WAVE 1" announcement appears, followed by gameplay starting — colored blocks, each carrying a word, begin falling from the top of the screen.
3. Using the numeric keypad, type the T9 digit sequence for a falling word's letters (e.g. 2=ABC, 3=DEF, 4=GHI, 5=JKL, 6=MNO, 7=PQRS, 8=TUV, 9=WXYZ). Confirm the block is destroyed once the full word is typed, and the score in the top-left corner increases.
4. Allow one word to fall all the way to the bottom without typing it. Confirm one life is lost (shown as a red square in the bottom-left HUD disappearing) and the screen briefly flashes red.
5. Press **1** during active gameplay. Confirm the game pauses (a "PAUSED" overlay appears, falling blocks freeze). Press **1** again and confirm gameplay resumes from where it left off.
6. Continue playing (allowing words to fall through, if desired, to end the run quickly) until all lives are lost. Confirm a "GAME OVER" screen appears showing the final score and the world/wave reached.
7. Press **1** from the Game Over screen. If you scored 1000 or more, confirm you go straight to name entry (no ad yet). If you scored under 1000, confirm you see an ad instead, then the app returns to the main menu — skip to step 10.
8. Enter your name and press Enter. Confirm a "SCORE SUBMITTED" screen appears showing your score. Note: your name will not appear immediately, as it requires manual approval to avoid bad words, but your score will be added with a name like "Player NNNN" until it is approved.
9. Press **1**. Confirm you see an ad, then the app returns to the main menu.
10. From the main menu, press **\*** . Confirm a leaderboard screen loads (showing either a list of scores or a "No scores yet" / loading message, depending on network connectivity) — this should never crash the app.
11. From the leaderboard screen, press **1** to return to the main menu.