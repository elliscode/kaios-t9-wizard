# V2 TODO

Feature/fix ideas for the next season, captured for later — none of this is
implemented yet. See `docs/replay-recording-tool.md` for the unrelated
season-recap-video design sketch, and `README.md`'s own `## TODO`/`## TODO
Stats` sections for the v1-era backlog this one continues from.

- [ ] **New powerup: Multiplier Shield**
  - Stacks like lives (you can hold more than one at a time), 1% spawn
    probability — same tier as the existing four (`POWERUP_PROBABILITIES` in
    `frontend-v3/js/game.js`, currently `extraLife`/`halfSpeed`/`halfLength`/
    `screenWipe`, each `1/100`).
  - Consumed one at a time to *block* the usual "real mistake" penalty
    (`wordCombo = 0; scoreMultiplier = 1;`) that currently fires
    unconditionally on a real typo (`applyTypingResult`) or an
    enemy/boss-sentence reaching the player (`checkCollisions`/
    `checkBossCollision`) — i.e. the multiplier streak survives instead of
    resetting, at the cost of one shield.
  - HUD: small yellow shield icons, positioned like the lives squares —
    mirror `renderHUD`'s `MAX_LIFE_SQUARES`/`HUD_SQUARE_SIZE` pattern
    (`frontend-v3/js/render.js`) including the same "+N" overflow text once
    the icon row is full, placed underneath the multiplier readout rather
    than next to the lives squares.
  - Open question: does a shield also block *losing a life* on that same
    event, or only the multiplier reset? Re-read as "guard against losing
    your multiplier," so current read is life loss still happens normally —
    confirm before building.

- [ ] **New powerup: Score Doubler (10s)**
  - Multiplies the active `scoreMultiplier` by 2x for 10 seconds — reuse the
    existing `POWERUP_EFFECT_DURATION_MS` constant (already `10000`, same
    duration as `halfSpeed`/`halfLength` today) rather than a new one.
  - Needs its own remaining-duration field alongside
    `halfSpeedRemainingMs`/`halfLengthRemainingMs`, ticked down in
    `updatePowerupTimers` the same way.
  - HUD: the multiplier readout (`renderScoreHUD`) renders in gold/yellow
    while active instead of the normal white — open question: does the
    doubling apply on top of the normal per-word `PERFECT_WORD_MULTIPLIER_BONUS`
    growth (i.e. `effectiveMultiplier = scoreMultiplier * 2`), or does it
    freeze/replace the multiplier for the duration? "Increases your
    multiplier by 2x" reads as the former — confirm before building, and
    decide what a real mistake during the doubled window does (reset the
    *underlying* `scoreMultiplier` as normal, still doubled once it rebuilds?
    or cancel the powerup outright?).

- [ ] **New powerup: Bonus Words**
  - Spawns additional enemies that move horizontally (left-to-right or
    right-to-left) rather than falling toward the player — can never hit/hurt
    the player, purely optional bonus points. Long words (~12 letters) for a
    proportionally bigger score payoff per completion.
  - The risk/reward is attention, not danger: typing a bonus word means
    *not* typing whatever's currently falling toward you, so it's a genuine
    trade-off rather than a free bonus.
  - Needs: a new enemy/movement variant (current `Enemy`/`updateEnemies` only
    ever move straight down — see `frontend-v3/js/enemy.js` and
    `updateEnemies` in `game.js`) and off-screen despawn when they exit the
    opposite edge (no penalty, unlike a normal enemy escaping downward,
    which costs a life today — bonus words must NOT do that). Word supply is
    already fine: `words-data.js` tops out at exactly length 12, with 191
    words available at that length, so no new word-bank content is needed.

- [ ] **New powerup: Time Freeze**
  - Freezes every enemy/boss currently on screen in place for a short
    duration (exact seconds TBD — "0 seconds" in the original note is
    presumably a typo) so the player gets a breather to catch up rather than
    an outright pause — typing still works normally during the freeze.
  - Hooks into the same pattern `halfSpeed` already uses: `updateEnemies`
    computes `var multiplier = state.halfSpeedRemainingMs > 0 ? 0.5 : 1;`
    against each enemy's immutable `baseSpeed` — a freeze is the same idea
    with `multiplier = 0` for its own `timeFreezeRemainingMs` field. Two
    things `halfSpeed` *doesn't* currently do that a real freeze probably
    needs: `updateBoss` has no multiplier at all today (boss fall speed
    always ignores `halfSpeed` entirely — a freeze would be the first thing
    to actually touch it), and `updateSpawning` isn't gated by `halfSpeed`
    either (new enemies keep spawning on schedule even at half speed) — a
    freeze that doesn't also pause spawning would fill the screen with
    fresh, still-moving enemies while the frozen ones just sit there, which
    undercuts the "catch a breather" point of the powerup.
  - Explicitly called out as probably mutually exclusive with `halfSpeed` —
    open question is *how*: reject/no-op collecting one while the other's
    timer is still running, or let both be collected but have freeze
    (multiplier 0) simply take priority over half-speed (multiplier 0.5)
    whenever both timers are active, same as how multiple `halfSpeed`
    pickups already just refresh the one timer today rather than stacking.

- [ ] **Bug fix: powerup flash text lingers through game-over/submission**
  - Root cause (confirmed): `renderPowerupFlash` is called unconditionally
    whenever `state.powerupFlash` is truthy (`render.js`'s `renderFrame`:
    `if (state.powerupFlash) renderPowerupFlash(ctx, state);`), but the
    timer that counts it down and eventually nulls it out
    (`updatePowerupTimers`) is only ever invoked from `update()`'s
    `STATE.PLAYING` branch. The moment a game over interrupts a still-active
    flash (`checkCollisions`/`checkBossCollision` jumping straight to
    `STATE.GAMEOVER`), the timer stops advancing but the flash keeps
    rendering — blinking on top of GAME OVER, SUBMIT FAILED/SCORE SUBMITTED,
    etc., all the way until `returnToMenu()` finally wipes it via a fresh
    `makeInitialState()`.
  - Fix direction: clear `state.powerupFlash = null` explicitly wherever
    mode transitions away from PLAYING/BOSS into a terminal state
    (`checkCollisions`'s and `checkBossCollision`'s `GAMEOVER` branches,
    `handleBossDefeated`'s `WIN` branch) — simpler than trying to make
    rendering mode-conditional, since the flash legitimately should keep
    showing through BOSS mode and transitions, just not past a run actually
    ending.

- [ ] **Tips & tricks section**
  - Not many natural loading/idle moments in this game to put it. Leading
    idea: the world/wave transition screen (`renderTransitionOverlay` in
    `render.js`, the ~2s `WORLD N` / `WAVE N` interstitial between waves) —
    add a small line at the bottom, e.g. "Protip: save your lives for the
    final boss, sentences are worth way more than single words."
  - Needs: a tip content list (new `frontend-v3/data/tips-data.js`,
    following the existing `words-data.js`/`sentences-data.js` pattern) and
    a pick strategy — could reuse `SentenceBank`'s no-repeat-per-run
    approach (`usedSentences`), or just pick uniformly at random each
    transition since tips repeating across a run is much lower-stakes than a
    sentence repeating.
  - Given `TRANSITION_DURATION_MS` is only ~2s, a tip needs to be short
    enough to actually read in that window, or the transition needs to
    linger slightly longer when a tip is showing (worth deciding).

- [ ] **Seasonal word dictionary**
  - Add new words to `frontend-v3/data/words-data.js` per season — e.g.
    pulling from Merriam-Webster's/Dictionary.com's yearly "new words added"
    lists — so the word pool very gradually grows/refreshes over time
    instead of staying permanently fixed at whatever it was when the game
    launched.
  - Mechanically this is nearly free with the existing versioning setup:
    `cut-version.sh` already snapshots `words-data.js` into
    `backend/lambda-replay/vendored/v<N>/` per season (see
    `SOURCE_FILE_NAMES` in `backend/lambda-replay/index.js`), and words are
    only ever bucketed by length (`wordsByLength["<len>"]` — see
    `WordBank.pickWord` in `frontend-v3/js/words.js`), not by theme/category,
    so adding a season's new words is just appending to the right
    length-bucket array before cutting that season's version — no new
    mechanism needed, just an editorial step each season.
  - Still needs the same manual review pass the original word list got (see
    `README.md`'s "Word data" section — profanity/slurs/sensitive-topic
    filtering) applied to whatever's pulled in each year.

- [ ] **Design decision: cap active powerups at 4, rotate 3 of them per season**
  - Keep the *total number of concurrently-live powerup types* fixed at 4
    (matches today's `POWERUP_PROBABILITIES` size), but make it a fixed slot
    + a rotating pool rather than a hardcoded set:
    - `extraLife` is always one of the 4, every season (removing the "more
      lives" option entirely would probably feel bad).
    - The other 3 slots are picked each season from a larger accumulated
      pool — today's `halfSpeed`/`halfLength`/`screenWipe`, plus whatever
      ships from this doc (`multiplierShield`, `scoreDoubler`, `bonusWords`,
      `timeFreeze`, any later ones) — so a season "reskins" the powerup meta
      by simply choosing a different 3-of-N combination, not by building
      anything new.
  - Point of this: once the pool is bigger than 3, most seasons need zero
    new powerup *code* — just flipping which 3 are wired into
    `POWERUP_PROBABILITIES`/`POWERUP_COLORS`/`POWERUP_DISPLAY_NAMES` (and
    whatever per-type state each one needs in `makeInitialState`/
    `updatePowerupTimers`) before cutting that season's version. Implies the
    powerup ideas above (shield, doubler, bonus words, time freeze) don't
    all need to ship in the same season — building 4-6 total over time and
    rotating 3 of them per season is the actual goal, not shipping
    everything at once.
  - Open question: does an unused-this-season powerup's dormant code stay in
    `frontend-v3/` year-round (just excluded from that season's
    `POWERUP_PROBABILITIES`), or does it only exist in whichever vendored
    version last used it? Given `cut-version.sh` snapshots whatever's
    currently in `frontend-v3/` at cut time, keeping all powerup code live
    in `frontend-v3/` permanently (toggled via `POWERUP_PROBABILITIES`
    membership) is simpler than trying to resurrect removed code each time a
    powerup rotates back in.
