var Game = (function () {
  var CANVAS_WIDTH = Layout.CANVAS_WIDTH;
  var CANVAS_HEIGHT = Layout.CANVAS_HEIGHT;

  var STATE = {
    MENU: 'menu', PLAYING: 'playing', TRANSITION: 'transition', BOSS: 'boss', PAUSED: 'paused',
    GAMEOVER: 'gameover', WIN: 'win',
    // Real-backend round trip: CONNECTING while waiting on POST /start (see
    // resetGame), NAME_ENTRY/SUBMITTING/SUBMITTED around POST /submit on a
    // genuine win (see enterNameEntry/handleNameSubmitted), LEADERBOARD for
    // GET /leaderboard from the menu (see enterLeaderboard).
    CONNECTING: 'connecting', NAME_ENTRY: 'name_entry', SUBMITTING: 'submitting', SUBMITTED: 'submitted',
    LEADERBOARD: 'leaderboard',
    // A confirmation step between PAUSED and actually quitting -- see
    // handleQuitKey -- so an accidental '*' press can't abandon a run.
    CONFIRM_QUIT: 'confirm_quit',
    // Gated interstitial ad -- see showGatedAd -- entered from GAMEOVER or
    // CONFIRM_QUIT, never from WIN. Sim is already stopped in both source
    // states, so nothing needs to "unwrap" through this mode the way
    // PAUSED/CONFIRM_QUIT unwrap to the frozen sim underneath.
    AD: 'ad'
  };

  var ENEMIES_PER_WAVE = 20;
  var STARTING_LIVES = 3;
  var TRANSITION_DURATION_MS = 2000;
  var AUTO_PAUSE_THRESHOLD_MS = 500; // a frame gap this large means the tab was backgrounded/suspended
  // Fixed simulation step (~30 ticks/sec) -- decouples game logic from render
  // framerate (which still runs at requestAnimationFrame's native rate) so a
  // seed + input log can be replayed deterministically (see replayRun below).
  var TICK_MS = 33;

  // Tunable, NOT wave-scaled: only word length scales with wave/world per spec.
  var SPAWN_INTERVAL_MS = 1800;
  var ENEMY_SPEED_JITTER = 0.2; // +/-20% cosmetic randomness only

  var MIN_BLOCK_WIDTH = 28;
  var CHAR_WIDTH_ESTIMATE = 10;
  var BLOCK_HEIGHT = 18;

  // Scoring — see applyTypingResult. Every word/sentence finished with zero
  // real mistakes bumps the global multiplier for subsequent words; any
  // imperfect or failed (escaped/timed-out) attempt resets it back to 1x.
  var PERFECT_WORD_MULTIPLIER_BONUS = 0.1;
  var ERROR_FLASH_DURATION_MS = 200; // brief dark-red playfield flash on a real mistake

  var BASE_BOSS_HEALTH_SEGMENTS = 3; // tunable — world N has BASE + (N-1)*2 segments
  var BOSS_HEIGHT = 32;
  // Health is drawn as segments carved directly into the boss's own body
  // (see renderBoss), so the box's width is derived from its own segment
  // count rather than a fixed constant — a tougher boss reads as visibly
  // bigger. js/render.js reads these same constants (via the exports below)
  // to lay segments out identically to how they were sized here.
  var BOSS_SEGMENT_WIDTH = 14;
  var BOSS_SEGMENT_GAP = 4;
  var BOSS_SEGMENT_PADDING = 8; // margin between the box edge and the first/last segment

  // Powerups — each type's probability is independently rolled per player-typed
  // kill, tunable individually here. At most one powerup ever spawns per kill
  // (see rollPowerupSpawns) — letting more than one hit on the same kill would
  // stack multiple blocks at the exact same spot, rendering unreadable.
  var POWERUP_PROBABILITIES = { extraLife: 1 / 100, halfSpeed: 1 / 100, halfLength: 1 / 100, screenWipe: 1 / 100 };
  var POWERUP_COLORS = { extraLife: 'white', halfSpeed: 'lightblue', halfLength: 'lightcoral', screenWipe: 'khaki' };
  var POWERUP_DISPLAY_NAMES = { extraLife: 'EXTRA LIFE', halfSpeed: 'HALF SPEED', halfLength: 'SHORT WORDS', screenWipe: 'SCREEN WIPE' };
  var POWERUP_EFFECT_DURATION_MS = 10000;
  var POWERUP_FLASH_DURATION_MS = 2000;
  var POWERUP_RISE_SPEED = 20; // px/sec, tunable
  var POWERUP_SIZE = 24; // small fixed square; icons come later, no word-length sizing needed
  var POWERUP_CODE_MIN_LEN = 2;
  var POWERUP_CODE_MAX_LEN = 3;

  var WORLD_LENGTH_RANGES = {
    1: { min: 2, max: 6 },
    2: { min: 4, max: 8 },
    3: { min: 6, max: 10 },
    4: { min: 8, max: 12 },
    5: { min: 10, max: 12 }
  };
  var TOTAL_WORLDS = 5;
  var WAVES_PER_WORLD = 10;

  var ctx = null;
  var state = null;

  function worldOfWave(wave) {
    return Math.ceil(wave / WAVES_PER_WORLD);
  }

  function waveInWorld(wave) {
    return ((wave - 1) % WAVES_PER_WORLD) + 1;
  }

  // TUNABLE — length 4 was the reference "feels right" speed (30px/sec, the
  // cap); longer words take longer to fall to make the game fair
  function enemyFallSpeedForLength(len) {
    return Math.min(30, 333.3307482896682 / Math.pow(len, 1.73696));
  }

  // TUNABLE — boss sentences fall slower than regular enemies since they're
  // much longer to type; later worlds' bosses fall slightly slower still to
  // offset their longer sentences and larger health pools.
  function bossSentenceSpeedForWorld(world) {
    return 30 / world;
  }

  function makeInitialState() {
    return {
      mode: STATE.MENU,
      pausedFromMode: null,
      enemies: [],
      powerups: [],
      boss: null,
      transition: null,
      nextEntityId: 1,
      lives: STARTING_LIVES,
      wave: 1,
      spawnedThisWave: 0,
      resolvedThisWave: 0,
      bossRush: false,
      usedSentences: {},
      halfSpeedRemainingMs: 0,
      halfLengthRemainingMs: 0,
      powerupFlash: null,
      waveCompletePending: false,
      spawnAccumulator: 0,
      lastTimestamp: null,
      simAccumulator: 0,
      tickCount: 0,
      seed: null,
      inputLog: null,
      runId: null,
      submitResult: null,
      submitError: null,
      leaderboardEntries: null,
      leaderboardError: null,
      score: 0,
      scoreMultiplier: 1,
      wordCombo: 0,
      currentWordHadMistake: false,
      errorFlash: null,
      player: {
        x: CANVAS_WIDTH / 2 - 20,
        y: CANVAS_HEIGHT - 20,
        width: 40,
        height: 16,
        color: '#999'
      }
    };
  }

  function getWordLengthRangeForWave(wave) {
    // TUNABLE — a reasonable default, not gospel. Same "3-length shifting
    // window" shape as before, rescoped to each world's [min,max] band.
    var band = WORLD_LENGTH_RANGES[worldOfWave(wave)];
    var progress = (waveInWorld(wave) - 1) / (WAVES_PER_WORLD - 1);
    var minLen = Math.round(band.min + progress * (band.max - band.min - 2));
    return { minLen: minLen, maxLen: minLen + 2 };
  }

  function findNonOverlappingX(width) {
    for (var attempt = 0; attempt < 5; attempt++) {
      var x = Math.floor(Rng.next() * (CANVAS_WIDTH - width));
      var overlaps = state.enemies.some(function (e) {
        return e.y < 40 && x < e.x + e.width && x + width > e.x;
      });
      if (!overlaps) return x;
    }
    return Math.floor(Rng.next() * (CANVAS_WIDTH - width));
  }

  function spawnEnemy() {
    var range = getWordLengthRangeForWave(state.wave);
    var activeWords = {};
    state.enemies.forEach(function (e) { activeWords[e.word] = true; });
    var activeWordsSet = {
      has: function (w) { return !!activeWords[w]; }
    };

    var word = WordBank.pickWord(range.minLen, range.maxLen, activeWordsSet);

    // While the half-length powerup is active, spawn a genuinely shorter
    // real word instead — re-picking (not truncating the one just chosen)
    // so it always reads as a complete word, never a cut-off fragment.
    // Existing on-screen enemies are left untouched (see collectPowerup).
    if (state.halfLengthRemainingMs > 0) {
      var halvedLen = Math.max(2, Math.floor(word.length / 2));
      word = WordBank.pickWord(halvedLen, halvedLen, activeWordsSet);
    }

    var code = T9.wordToT9Code(word);
    var width = Math.max(MIN_BLOCK_WIDTH, word.length * CHAR_WIDTH_ESTIMATE * 0.6 + 12);

    var x = findNonOverlappingX(width);
    var jitteredBaseSpeed = enemyFallSpeedForLength(word.length) * (1 + (Rng.next() * 2 - 1) * ENEMY_SPEED_JITTER);
    var color = Colors.colorForWordLength(word.length);

    state.enemies.push(Enemy.createEnemy({
      id: state.nextEntityId++,
      word: word,
      code: code,
      x: x,
      y: -BLOCK_HEIGHT,
      width: width,
      height: BLOCK_HEIGHT,
      color: color,
      baseSpeed: jitteredBaseSpeed
    }));
  }

  function updateSpawning(dt) {
    if (state.spawnedThisWave >= ENEMIES_PER_WAVE) return;
    state.spawnAccumulator += dt;
    while (state.spawnAccumulator >= SPAWN_INTERVAL_MS && state.spawnedThisWave < ENEMIES_PER_WAVE) {
      spawnEnemy();
      state.spawnedThisWave += 1;
      state.spawnAccumulator -= SPAWN_INTERVAL_MS;
    }
  }

  function updateEnemies(dt) {
    var dtSeconds = dt / 1000;
    // Effective speed is computed fresh every frame from an immutable
    // baseSpeed rather than mutating .speed on collection — so repeat
    // half-speed pickups can never compound toward zero, and speed reverts
    // to normal the instant the effect's duration elapses.
    var multiplier = state.halfSpeedRemainingMs > 0 ? 0.5 : 1;
    state.enemies.forEach(function (e) {
      e.y += e.baseSpeed * multiplier * dtSeconds;
    });
  }

  function checkCollisions() {
    var stillAlive = [];
    var escaped = 0;
    state.enemies.forEach(function (enemy) {
      if (enemy.y + enemy.height >= state.player.y) {
        state.lives -= 1;
        escaped += 1;
        // Getting hit always breaks the perfect-word streak and flashes the
        // screen, exactly like a real typing mistake -- regardless of
        // whether this particular enemy was the one actually locked/typed.
        state.wordCombo = 0;
        state.scoreMultiplier = 1;
        state.errorFlash = { timerMs: ERROR_FLASH_DURATION_MS };
        if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.HIT);
        // Only clear the typing buffer if THIS enemy was the locked one --
        // otherwise the player is mid-typing a different enemy and
        // shouldn't lose that progress just because some other one escaped.
        if (enemy.id === InputEngine.getLockedEnemyId()) InputEngine.reset();
      } else {
        stillAlive.push(enemy);
      }
    });
    state.enemies = stillAlive;
    state.resolvedThisWave += escaped;
    if (state.lives <= 0) {
      state.mode = STATE.GAMEOVER;
      SaveGame.clear();
      if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.GAME_OVER);
      return;
    }
    checkWaveComplete();
    SaveGame.save(state);
  }

  function enterTransition(isBoss) {
    state.enemies = [];
    // Any not-yet-collected powerup is discarded at a wave-transition/boss
    // boundary — otherwise it would freeze mid-flight (invisible, uncollectible)
    // through the transition and any subsequent boss fight, then reappear
    // later. Consistent with the existing "scrolled off = lost, no penalty".
    state.powerups = [];
    InputEngine.reset();
    state.mode = STATE.TRANSITION;
    state.transition = { timerMs: TRANSITION_DURATION_MS, isBoss: isBoss };
    // Single shared cue for start-game/next-wave/boss-incoming, since every
    // one of those paths already funnels through here (resetGame and
    // proceedToNextWaveOrBoss both call this). Guarded: AudioEngine isn't
    // loaded in the headless replay Lambda's sandbox (see backend/lambda-replay),
    // and sound has no bearing on game logic/scoring anyway.
    if (typeof AudioEngine !== "undefined") AudioEngine.play(SFX.JINGLE);
  }

  function updateTransition(dt) {
    state.transition.timerMs -= dt;
    if (state.transition.timerMs > 0) return;
    var isBoss = state.transition.isBoss;
    state.transition = null;
    if (isBoss) {
      startBossFight(worldOfWave(state.wave));
      state.mode = STATE.BOSS;
    } else {
      state.spawnAccumulator = 0;
      state.spawnedThisWave = 0;
      state.resolvedThisWave = 0;
      state.mode = STATE.PLAYING;
    }
    SaveGame.save(state);
  }

  function handleKill(enemyId) {
    var defeated = null;
    state.enemies = state.enemies.filter(function (e) {
      if (e.id === enemyId) { defeated = e; return false; }
      return true;
    });
    state.resolvedThisWave += 1;
    if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.KILL);
    // Powerup rolls only happen on a player-typed kill — not on escapes
    // (checkCollisions) or on screenWipe's own kills — to avoid any risk of
    // cascading spawns.
    if (defeated) rollPowerupSpawns(defeated.x, defeated.y);
    checkWaveComplete();
    SaveGame.save(state);
  }

  // A wave is complete once all of its (capped-at-20) enemies have been
  // resolved, one way or another — killed by the player or escaped past
  // them — rather than requiring exactly 20 successful kills. This is what
  // keeps the enemy count for a wave honestly capped at 20: spawning stops
  // at 20 (see updateSpawning), and the wave doesn't end until every one of
  // those 20 is actually off the screen, so nothing is ever force-cleared
  // mid-fight.
  function checkWaveComplete() {
    // Defensive: only meaningful during PLAYING. Guards against a redundant
    // call landing after mode has already moved on within the same tick.
    if (state.mode !== STATE.PLAYING) return;
    if (state.spawnedThisWave < ENEMIES_PER_WAVE) return;
    if (state.enemies.length > 0) return;
    // Give the player a chance to still grab (or lose) any powerups still
    // in flight before moving on — killing the last enemy shouldn't yank
    // away powerups the player hasn't had a chance to type yet.
    if (state.powerups.length > 0) return;
    // Don't cut a powerup announcement short by jumping into the next-wave/
    // boss transition mid-flash — finish showing it first. updatePowerupTimers
    // picks this back up and proceeds the instant the flash naturally clears.
    if (state.powerupFlash) {
      state.waveCompletePending = true;
      return;
    }
    proceedToNextWaveOrBoss();
  }

  function proceedToNextWaveOrBoss() {
    if (waveInWorld(state.wave) === WAVES_PER_WORLD) {
      enterTransition(true);
    } else {
      state.wave += 1;
      enterTransition(false);
    }
  }

  function rollPowerupSpawns(x, y) {
    var types = Object.keys(POWERUP_PROBABILITIES);
    // Shuffle so that on the rare tick where more than one type's roll would
    // hit, which one actually spawns isn't biased toward whichever key
    // happens to be listed first in POWERUP_PROBABILITIES.
    for (var i = types.length - 1; i > 0; i--) {
      var j = Math.floor(Rng.next() * (i + 1));
      var tmp = types[i]; types[i] = types[j]; types[j] = tmp;
    }
    for (var k = 0; k < types.length; k++) {
      if (Rng.next() < POWERUP_PROBABILITIES[types[k]]) {
        spawnPowerup(types[k], x, y);
        return; // at most one powerup per kill, ever -- see comment above.
      }
    }
  }

  function spawnPowerup(type, x, y) {
    var word = WordBank.pickWord(POWERUP_CODE_MIN_LEN, POWERUP_CODE_MAX_LEN, null);
    var code = T9.wordToT9Code(word);
    state.powerups.push(Powerup.createPowerup({
      id: state.nextEntityId++,
      type: type,
      word: word,
      code: code,
      x: x,
      y: y,
      width: POWERUP_SIZE,
      height: POWERUP_SIZE,
      color: POWERUP_COLORS[type],
      speed: POWERUP_RISE_SPEED
    }));
  }

  function updatePowerups(dt) {
    var dtSeconds = dt / 1000;
    var stillRising = [];
    state.powerups.forEach(function (p) {
      p.y -= p.speed * dtSeconds;
      if (p.y + p.height >= 0) {
        stillRising.push(p);
      } else if (p.id === InputEngine.getLockedEnemyId()) {
        InputEngine.reset(); // mirrors the escaped-enemy pattern in checkCollisions
      }
    });
    state.powerups = stillRising;
    // A powerup scrolling off-screen can be the last thing the (already
    // enemy-cleared) wave was waiting on.
    checkWaveComplete();
  }

  // Screen wipe should score exactly as if the player had typed every
  // on-screen enemy perfectly, back to back, closest to the player first
  // (the order they'd naturally be typed in) -- same per-letter combo
  // growth and per-word multiplier bump as real typing, just driven by
  // synthetic results instead of real keypresses. Deliberately ignores any
  // partial progress already typed into whichever enemy was locked when the
  // powerup landed (a rare, small overcount) rather than adding the
  // complexity of reconciling it against InputEngine's buffer.
  function wipeScreen() {
    var order = state.enemies.slice().sort(function (a, b) { return b.y - a.y; });
    order.forEach(function (enemy) {
      var len = enemy.word.length;
      for (var i = 0; i < len; i++) {
        var firstLetter = i === 0;
        var isLast = i === len - 1;
        applyScoreForResult({ type: isLast ? 'kill' : 'progress', firstLetter: firstLetter });
      }
    });
    state.resolvedThisWave += state.enemies.length;
    state.enemies = [];
    InputEngine.reset();
    checkWaveComplete();
  }

  // Shrinks every enemy currently on screen to half its word length (rounded
  // down, min 2), re-picking a genuine shorter word for each — same rule as
  // newly-spawned enemies while the effect is active. The enemy InputEngine
  // currently has locked (if any) is deliberately skipped: shrinking its
  // code out from under an in-progress typed buffer would leave the buffer
  // no longer a valid prefix of the new (shorter) code, permanently
  // soft-locking it — no digit could ever complete it again. Every other
  // on-screen enemy is safe to shrink since nothing has been typed against
  // it yet.
  function applyHalfLengthToExistingEnemies() {
    var lockedId = InputEngine.getLockedEnemyId();
    state.enemies.forEach(function (e) {
      if (e.id === lockedId) return;
      var newLen = Math.max(2, Math.floor(e.word.length / 2));
      if (newLen >= e.word.length) return;
      var activeWords = {};
      state.enemies.forEach(function (other) { if (other !== e) activeWords[other.word] = true; });
      var newWord = WordBank.pickWord(newLen, newLen, { has: function (w) { return !!activeWords[w]; } });
      e.word = newWord;
      e.code = T9.wordToT9Code(newWord);
      e.width = Math.max(MIN_BLOCK_WIDTH, newWord.length * CHAR_WIDTH_ESTIMATE * 0.6 + 12);
      e.color = Colors.colorForWordLength(newWord.length);
    });
  }

  function applyPowerupEffect(type) {
    if (type === 'extraLife') {
      state.lives += 1;
    } else if (type === 'halfSpeed') {
      state.halfSpeedRemainingMs = POWERUP_EFFECT_DURATION_MS;
    } else if (type === 'halfLength') {
      state.halfLengthRemainingMs = POWERUP_EFFECT_DURATION_MS;
      applyHalfLengthToExistingEnemies();
    } else if (type === 'screenWipe') {
      wipeScreen();
    }
  }

  function collectPowerup(id) {
    var collected = null;
    state.powerups = state.powerups.filter(function (p) {
      if (p.id === id) { collected = p; return false; }
      return true;
    });
    if (!collected) return;
    if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.POWERUP);
    // Set the flash BEFORE applying the effect: screenWipe's effect can
    // itself trigger checkWaveComplete() synchronously (via wipeScreen), and
    // that check needs to already see an active flash in order to defer the
    // transition instead of entering it immediately.
    state.powerupFlash = { type: collected.type, timerMs: POWERUP_FLASH_DURATION_MS };
    applyPowerupEffect(collected.type);
    // Collecting the last remaining powerup can be the last thing the
    // (already enemy-cleared) wave was waiting on — screenWipe's own effect
    // already reaches checkWaveComplete via wipeScreen, but the other three
    // types don't, so this call is what covers those cases uniformly.
    checkWaveComplete();
    SaveGame.save(state);
  }

  function spawnBossSentence(boss) {
    // Excludes every sentence shown anywhere in this run (not just this
    // boss), so the same line never repeats across a single playthrough.
    // Reset only happens via a fresh makeInitialState() on resetGame().
    var usedSet = { has: function (s) { return !!state.usedSentences[s]; } };
    boss.sentence = SentenceBank.pickSentence(boss.world, usedSet);
    state.usedSentences[boss.sentence] = true;
    boss.code = T9.wordToT9Code(boss.sentence);
    boss.y = -boss.height;
  }

  function healthSegmentsForWorld(world) {
    return BASE_BOSS_HEALTH_SEGMENTS + (world - 1) * 2;
  }

  function bossWidthForHealth(maxHealth) {
    return BOSS_SEGMENT_PADDING * 2 + maxHealth * BOSS_SEGMENT_WIDTH + (maxHealth - 1) * BOSS_SEGMENT_GAP;
  }

  function startBossFight(world) {
    var health = healthSegmentsForWorld(world);
    var width = bossWidthForHealth(health);
    state.boss = Boss.createBoss({
      id: 'boss-' + world,
      world: world,
      health: health,
      maxHealth: health,
      x: (CANVAS_WIDTH - width) / 2,
      y: -BOSS_HEIGHT,
      width: width,
      height: BOSS_HEIGHT,
      color: Colors.bossColorForWorld(world),
      speed: bossSentenceSpeedForWorld(world)
    });
    spawnBossSentence(state.boss);
  }

  function updateBoss(dt) {
    state.boss.y += state.boss.speed * (dt / 1000);
  }

  function checkBossCollision() {
    var boss = state.boss;
    if (boss.y + boss.height >= state.player.y) {
      state.lives -= 1;
      InputEngine.reset();
      // An incomplete sentence reaching the player is a failed attempt at
      // "one long word" -- breaks the perfect-word multiplier streak and
      // flashes the screen, exactly like a real typing mistake.
      state.wordCombo = 0;
      state.scoreMultiplier = 1;
      state.errorFlash = { timerMs: ERROR_FLASH_DURATION_MS };
      if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.HIT);
      if (state.lives <= 0) {
        state.mode = STATE.GAMEOVER;
        state.boss = null;
        SaveGame.clear();
        if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.GAME_OVER);
      } else {
        spawnBossSentence(boss);
        SaveGame.save(state);
      }
    }
  }

  function handleBossDefeated() {
    var world = state.boss.world;
    state.boss = null;
    if (world === TOTAL_WORLDS) {
      state.mode = STATE.WIN;
      SaveGame.clear();
      if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.WIN);
    } else if (state.bossRush) {
      // Skip straight to the next world's boss — jump wave to that world's
      // final wave number so enterTransition(true) lands on the right world
      // via the same worldOfWave/waveInWorld math the normal flow uses.
      state.wave = (world + 1) * WAVES_PER_WORLD;
      enterTransition(true);
    } else {
      state.wave = world * WAVES_PER_WORLD + 1;
      enterTransition(false);
    }
  }

  function handleBossSentenceCompleted() {
    state.boss.health -= 1;
    if (state.boss.health <= 0) {
      // handleBossDefeated() plays its own cue (WIN fanfare, or the shared
      // JINGLE via enterTransition for the next boss) -- no chirp here too,
      // so the actual defeat moment doesn't get cluttered with both sounds.
      handleBossDefeated();
    } else {
      if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.KILL);
      spawnBossSentence(state.boss);
      SaveGame.save(state);
    }
  }

  function updatePowerupTimers(dt) {
    if (state.halfSpeedRemainingMs > 0) {
      state.halfSpeedRemainingMs = Math.max(0, state.halfSpeedRemainingMs - dt);
    }
    if (state.halfLengthRemainingMs > 0) {
      state.halfLengthRemainingMs = Math.max(0, state.halfLengthRemainingMs - dt);
    }
    if (state.powerupFlash) {
      state.powerupFlash.timerMs -= dt;
      if (state.powerupFlash.timerMs <= 0) {
        state.powerupFlash = null;
        if (state.waveCompletePending) {
          state.waveCompletePending = false;
          proceedToNextWaveOrBoss();
        }
      }
    }
  }

  function update(dt) {
    // Runs regardless of PLAYING/TRANSITION/BOSS -- a mistake can happen
    // during a boss fight too, and this is simpler than duplicating the
    // decrement in every mode's own update path.
    if (state.errorFlash) {
      state.errorFlash.timerMs -= dt;
      if (state.errorFlash.timerMs <= 0) state.errorFlash = null;
    }
    if (state.mode === STATE.PLAYING) {
      updatePowerupTimers(dt);
      // updatePowerupTimers can itself trigger a deferred wave-transition
      // (see checkWaveComplete/proceedToNextWaveOrBoss) and flip us out of
      // PLAYING mid-tick — bail immediately so the remaining PLAYING-only
      // steps below don't run against a mode that already moved on (which
      // would otherwise let checkCollisions's own checkWaveComplete() call
      // fire a second, redundant wave-advance in the same frame).
      if (state.mode !== STATE.PLAYING) return;
      updateSpawning(dt);
      updateEnemies(dt);
      updatePowerups(dt);
      checkCollisions();
    } else if (state.mode === STATE.TRANSITION) {
      updateTransition(dt);
    } else if (state.mode === STATE.BOSS) {
      updateBoss(dt);
      checkBossCollision();
    }
  }

  // A fresh run's seed comes from the server (POST /start) so the run_id it
  // returns can later be replayed server-side (see backend/lambda-replay) to
  // verify a submitted score -- a client-chosen seed would let a player
  // submit a fabricated input_log/score pair with no way to catch it.
  // CONNECTING is shown for however long that fetch takes; if it fails
  // (offline, timeout), the run still starts -- with a local fallback seed
  // and runId left null -- rather than blocking play entirely, matching the
  // "never let X break gameplay" approach already used by SaveGame/AudioEngine.
  // The one cost of that fallback: a run started offline can never be
  // submitted, since there's no run_id for the server to verify against.
  function beginRun(afterSeeded) {
    // Clear any existing save immediately — otherwise, if the app closes
    // before the first checkpoint of this fresh run, the next launch would
    // resume the *previous* run instead of starting the new one.
    SaveGame.clear();
    state = makeInitialState();
    // Every key handler no-ops outside the modes it explicitly checks, and
    // none of them list CONNECTING, so the player can't trigger another
    // state reassignment while this fetch is in flight in practice -- this
    // is just cheap insurance against a stale callback mutating a
    // since-replaced state object if that ever stops being true.
    var thisRun = state;
    state.mode = STATE.CONNECTING;
    state.inputLog = [];
    if (typeof Api === 'undefined') {
      thisRun.seed = Math.floor(Math.random() * 0x7fffffff);
      Rng.seed(thisRun.seed);
      afterSeeded();
      return;
    }
    Api.start().then(function (result) {
      if (state !== thisRun) return; // superseded while the fetch was in flight
      if (result.ok && result.body && result.body.run_id) {
        thisRun.runId = result.body.run_id;
        thisRun.seed = result.body.seed;
      } else {
        thisRun.seed = Math.floor(Math.random() * 0x7fffffff);
      }
      Rng.seed(thisRun.seed);
      afterSeeded();
    });
  }

  function resetGame() {
    beginRun(function () {
      InputEngine.reset();
      enterTransition(false);
    });
  }

  // Testing/balance-tuning aid: play through only the bosses, world by
  // world, skipping every regular wave — see handleBossDefeated's bossRush
  // branch for how each subsequent boss is chained.
  function startBossRush() {
    SaveGame.clear();
    state = makeInitialState();
    state.bossRush = true;
    state.wave = WAVES_PER_WORLD;
    // Still seeded (so its randomness behaves identically to a real run),
    // but state.seed/inputLog are deliberately left null -- boss rush never
    // counts toward the leaderboard, so recording it would be pure overhead.
    Rng.seed(Math.floor(Math.random() * 0x7fffffff));
    InputEngine.reset();
    enterTransition(true);
  }

  // From game-over/win, "Press 1" now returns to the main menu screen rather
  // than immediately starting a new run — makeInitialState() already defaults
  // to STATE.MENU, so this doubles as a full, clean reset of HUD/state too.
  function returnToMenu() {
    state = makeInitialState();
  }

  // The exact three modes that advance time — the only ones that can be
  // paused, and the only ones the auto-pause dt-check needs to guard.
  // pauseGame() must only ever be called while this is true, so it never
  // stomps pausedFromMode with 'paused' itself; both call sites (loop()'s
  // auto-pause and handleMenuKey()'s manual pause) already respect this.
  function isActiveSimulationMode() {
    return state.mode === STATE.PLAYING || state.mode === STATE.TRANSITION || state.mode === STATE.BOSS;
  }

  function pauseGame() {
    state.pausedFromMode = state.mode;
    state.mode = STATE.PAUSED;
    // Pausing (manual, auto-on-stall, or the tab being hidden) is exactly
    // the moment the app might get backgrounded/closed next, so it doubles
    // as a save checkpoint.
    SaveGame.save(state);
  }

  function resumeGame() {
    state.mode = state.pausedFromMode;
    state.pausedFromMode = null;
  }

  // A win only counts toward the leaderboard if it has a run_id (the
  // server-issued seed round trip actually succeeded -- see beginRun) and
  // isn't a boss-rush practice run (startBossRush deliberately never sets
  // one, so this second check is mostly redundant with the first, but
  // makes the real requirement explicit rather than relying on that as an
  // implementation detail).
  function isRunSubmittable() {
    return !state.bossRush && state.runId != null;
  }

  // Shown only on losing (GAMEOVER) or confirming a quit -- never on WIN --
  // as a "punishment" for not finishing the run. Enters STATE.AD, asks
  // AdsEngine to display whatever it has (a preloaded ad, a freshly
  // requested one, or nothing at all if unavailable/disallowed), then runs
  // onDone. The thisState guard matches enterLeaderboard/enterNameEntry's
  // existing pattern -- if something else already moved state on (e.g. the
  // player somehow gets back to the menu another way while the ad's async
  // callback is still pending), onDone must not fire against a stale state.
  function showGatedAd(onDone) {
    state.mode = STATE.AD;
    if (typeof AdsEngine === 'undefined') {
      onDone();
      return;
    }
    var thisState = state;
    AdsEngine.showAd(function () {
      if (state !== thisState) return;
      onDone();
    });
  }

  function handleMenuKey() {
    if (state.mode === STATE.MENU) {
      resetGame();
    } else if (state.mode === STATE.WIN) {
      // A win never shows an ad -- only losing/quitting does (see
      // showGatedAd).
      if (isRunSubmittable()) {
        enterNameEntry();
      } else {
        returnToMenu();
      }
    } else if (state.mode === STATE.GAMEOVER) {
      showGatedAd(function () {
        // A game over is a legitimate, submittable result too (see
        // submit_route) -- not just a real win. Same gate either way: no
        // run_id (offline start, or a boss-rush practice run) just returns
        // to the menu instead.
        if (isRunSubmittable()) {
          enterNameEntry();
        } else {
          returnToMenu();
        }
      });
    } else if (state.mode === STATE.SUBMITTED || state.mode === STATE.LEADERBOARD) {
      returnToMenu();
    } else if (state.mode === STATE.PAUSED) {
      resumeGame();
    } else if (state.mode === STATE.CONFIRM_QUIT) {
      // '1' confirms the quit prompted by handleQuitKey.
      showGatedAd(function () {
        SaveGame.clear();
        returnToMenu();
      });
    } else if (isActiveSimulationMode()) {
      pauseGame();
    }
  }

  // Only available while paused (not a general "abandon run" shortcut mid-
  // gameplay) -- quitting is a deliberate choice to abandon the run, gated
  // behind a confirmation (see handleMenuKey's CONFIRM_QUIT branch for the
  // actual quit, and STATE.CONFIRM_QUIT's comment) so an accidental '*'
  // press can't lose one. '*' also cancels back out of that confirmation --
  // this same handler covers both, since main.js already routes '*' here
  // unconditionally regardless of which of the two modes is current.
  function handleQuitKey() {
    if (state.mode === STATE.PAUSED) {
      state.mode = STATE.CONFIRM_QUIT;
    } else if (state.mode === STATE.CONFIRM_QUIT) {
      state.mode = STATE.PAUSED;
    }
  }

  function handleBossRushKey() {
    if (state.mode === STATE.MENU || state.mode === STATE.GAMEOVER || state.mode === STATE.WIN) {
      startBossRush();
    }
  }

  // '*' from the menu opens the in-game (top-10) leaderboard; '*' again
  // while already there opens the full (top-500) leaderboard in an actual
  // browser tab -- same multi-purpose-single-key pattern used elsewhere
  // (see handleQuitKey), gated on mutually exclusive modes.
  function handleLeaderboardKey() {
    if (state.mode === STATE.MENU) {
      enterLeaderboard();
    } else if (state.mode === STATE.LEADERBOARD) {
      try {
        if (typeof window !== 'undefined' && window.open) {
          window.open('https://elliscode.com/t9-wizard/leaderboard.html', '_blank');
        }
      } catch (e) {
        // Never let this break the game -- same philosophy as AudioEngine/SaveGame.
      }
    }
  }

  function enterLeaderboard() {
    state.mode = STATE.LEADERBOARD;
    state.leaderboardEntries = null;
    state.leaderboardError = null;
    if (typeof Api === 'undefined') return;
    var thisState = state;
    Api.leaderboard().then(function (result) {
      if (state !== thisState) return;
      if (result.ok && result.body && result.body.leaderboard) {
        state.leaderboardEntries = result.body.leaderboard;
      } else {
        state.leaderboardError = 'Could not load leaderboard';
      }
    });
  }

  function enterNameEntry() {
    state.mode = STATE.NAME_ENTRY;
    if (typeof NameEntry !== 'undefined') NameEntry.show(handleNameSubmitted);
  }

  // Fires once the player confirms a name in the real <input> (see
  // js/nameentry.js) on a genuine, submittable win. The server is the only
  // thing that ever gets to say whether the run was legitimate and what it
  // actually scored (see submit_route/backend/lambda-replay) -- this just
  // packages up exactly what replayRun itself would need to reproduce the
  // run and hands it over.
  function handleNameSubmitted(name) {
    state.mode = STATE.SUBMITTING;
    // Hide (and thus deactivate) the real <input> immediately, not once the
    // request resolves -- otherwise it stays focused/active for the whole
    // round trip, and a second Enter press in that window re-fires this
    // same handler, sending a duplicate /submit before the first response
    // even comes back. This runs synchronously before Api.submit() is even
    // called, so it closes the race even against a duplicate hardware
    // keydown event for the same physical press.
    if (typeof NameEntry !== 'undefined') NameEntry.hide();
    if (typeof Api === 'undefined') return;
    var thisState = state;
    Api.submit({
      run_id: state.runId,
      display_name: name,
      tick_count: state.tickCount,
      canvas_width: Layout.CANVAS_WIDTH,
      canvas_height: Layout.CANVAS_HEIGHT,
      input_log: state.inputLog
    }).then(function (result) {
      if (state !== thisState) return;
      if (result.ok && result.body && result.body.score != null) {
        state.submitResult = { score: result.body.score };
        state.submitError = null;
      } else {
        state.submitResult = null;
        state.submitError = (result.body && result.body.message) || 'Score submission failed';
      }
      state.mode = STATE.SUBMITTED;
    });
  }

  // Scoring engine: an escalating per-word combo (1, 2, 3, ... for each
  // correct letter, reset by a real mistake) plus a global multiplier that
  // grows on a perfectly-typed word/sentence and resets to 1x on an
  // imperfect one. Shared unmodified by regular enemies and the boss (a
  // full boss sentence is just treated as one long word, per design) -- see
  // the plan's worked "doggy"/"litter" example for the exact intended math.
  // `result.firstLetter` marks the start of a fresh word (including a
  // single-letter word's only keypress, which never passes through
  // 'locked'). Split out from applyTypingResult so wipeScreen can award the
  // same per-letter combo growth and per-word multiplier bump for its
  // synthetic "perfect kill" results without also triggering the
  // real-typing SUCCESS sound (which would spam a burst of overlapping taps
  // for every wiped enemy).
  function applyScoreForResult(result) {
    if (result.firstLetter) {
      state.wordCombo = 1;
      state.currentWordHadMistake = false;
    } else {
      state.wordCombo += 1;
    }
    state.score += state.wordCombo * state.scoreMultiplier;
    if (result.type === 'kill' && !state.currentWordHadMistake) {
      state.scoreMultiplier += PERFECT_WORD_MULTIPLIER_BONUS;
    }
  }

  function applyTypingResult(result) {
    if (result.type === 'wrong') {
      if (!result.benign) {
        state.wordCombo = 0;
        state.currentWordHadMistake = true;
        // Multiplier resets the instant a real mistake registers, not
        // deferred until the word finishes -- a mistake mid-word shouldn't
        // still be "spending" a streak it already broke.
        state.scoreMultiplier = 1;
        state.errorFlash = { timerMs: ERROR_FLASH_DURATION_MS };
        if (typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.ERROR);
      }
      return; // benign duplicate: no-op
    }
    if (result.type !== 'locked' && result.type !== 'progress' && result.type !== 'kill') return; // 'miss'

    applyScoreForResult(result);
    // The *completing* keypress gets its own distinct sound instead (KILL
    // or POWERUP, played from handleKill/collectPowerup/
    // handleBossSentenceCompleted, which know which one this actually was).
    if (result.type !== 'kill' && typeof AudioEngine !== 'undefined') AudioEngine.play(SFX.SUCCESS);
  }

  function handleDigitKey(digit) {
    if (state.mode !== STATE.PLAYING && state.mode !== STATE.BOSS) {
      // Ignore 2-9 outside of active gameplay, so mashing letters while
      // typing doesn't accidentally skip past a menu/game-over/win screen.
      return;
    }
    // Tagging with the current tick (not a wall-clock time) is what makes
    // this replayable: there are no partial ticks (the fixed-step loop only
    // ever calls update() on whole TICK_MS boundaries), so a keypress always
    // lands against "state as of the last completed tick" -- replaying the
    // same key at the same tick count reproduces the exact same outcome.
    if (state.inputLog) state.inputLog.push({ tick: state.tickCount, key: digit });
    if (state.mode === STATE.PLAYING) {
      var typable = state.enemies.concat(state.powerups);
      var lockedIdBefore = InputEngine.getLockedEnemyId();
      var result = InputEngine.handleDigit(digit, typable);

      // Powerups are typed through the same lock-on mechanism as enemies,
      // but don't contribute to score -- only apply the scoring engine when
      // whatever's actually locked (or just got locked/killed) is an enemy.
      var scoringTargetId = (result.type === 'locked' || result.type === 'kill') ? result.enemyId : lockedIdBefore;
      var targetIsPowerup = scoringTargetId !== null && state.powerups.some(function (p) { return p.id === scoringTargetId; });
      if (!targetIsPowerup) {
        applyTypingResult(result);
      } else if ((result.type === 'locked' || result.type === 'progress') && typeof AudioEngine !== 'undefined') {
        // Powerups skip applyTypingResult entirely (no score to add), but a
        // non-final correct letter should still get the same tap feedback as
        // a real word -- the completing letter still plays POWERUP instead,
        // via collectPowerup below.
        AudioEngine.play(SFX.SUCCESS);
      }

      if (result.type === 'kill') {
        if (targetIsPowerup) {
          collectPowerup(result.enemyId);
        } else {
          handleKill(result.enemyId);
        }
      }
      return;
    }
    if (state.mode === STATE.BOSS) {
      var bossResult = InputEngine.handleDigit(digit, [state.boss]);
      applyTypingResult(bossResult);
      if (bossResult.type === 'kill') {
        handleBossSentenceCompleted();
      }
      return;
    }
    // TRANSITION: digits are ignored, purely timer-driven.
  }

  function loop(timestamp) {
    if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
    var frameDt = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;

    if (isActiveSimulationMode()) {
      if (frameDt > AUTO_PAUSE_THRESHOLD_MS) {
        // A gap this large means the tab was backgrounded/suspended — pause
        // instead of applying that huge delta (which would otherwise jump
        // enemies/boss forward or fire a burst of catch-up spawns). This also
        // bounds the catch-up loop below to a small, safe number of ticks,
        // since frameDt can never exceed this threshold once we reach it.
        pauseGame();
      } else {
        // Simulation advances in fixed TICK_MS steps regardless of the real
        // render framerate, so a run is fully reproducible from its seed +
        // input log alone (see replayRun) -- rendering still happens once per
        // real frame below, just decoupled from how many ticks it took.
        state.simAccumulator += frameDt;
        while (state.simAccumulator >= TICK_MS) {
          update(TICK_MS);
          state.simAccumulator -= TICK_MS;
          state.tickCount += 1;
        }
      }
    }
    Render.renderFrame(ctx, state);

    requestAnimationFrame(loop);
  }

  // Re-simulates a run headlessly from just its seed and input log, and
  // returns the resulting final state -- the local proof that a submitted
  // score is verifiable (a future server would do exactly this, and reject
  // a submission whose replay doesn't reproduce the claimed result). Since
  // this module has no DOM dependency outside init()'s canvas/event wiring,
  // this same function could plausibly run server-side later too.
  //
  // Temporarily swaps the module-level state/ctx rather than threading state
  // through every function as a parameter -- much smaller and lower-risk
  // than making the whole module state-injectable, and safe here because JS
  // is single-threaded (nothing else can observe state mid-swap).
  function replayRun(seed, inputLog, tickCount) {
    var savedState = state;
    var savedCtx = ctx;
    var savedInput = InputEngine.snapshot();
    ctx = null;
    Rng.seed(seed);
    state = makeInitialState();
    enterTransition(false); // mirrors resetGame() minus the seed/save/inputLog bookkeeping

    var inputIndex = 0;
    for (var tick = 0; tick < tickCount; tick++) {
      while (inputIndex < inputLog.length && inputLog[inputIndex].tick === tick) {
        handleDigitKey(inputLog[inputIndex].key);
        inputIndex++;
      }
      if (isActiveSimulationMode()) update(TICK_MS);
    }

    var result = state;
    state = savedState;
    ctx = savedCtx;
    InputEngine.restoreSnapshot(savedInput);
    return result;
  }

  // Rebuilds a state object from a save payload. Starts from a fresh
  // makeInitialState() so every field has a sane default (player position
  // in particular is re-derived from the current canvas size rather than
  // persisted, since it's purely a function of viewport dimensions, not
  // gameplay), then overwrites just the fields that matter for resuming.
  // Always resumes into PAUSED — wrapping whatever mode was actually saved
  // — so the player gets a moment to get oriented (and see "PAUSED / Press
  // 1 to resume") rather than being dropped straight into falling enemies
  // the instant the app opens.
  function restoreStateFromSave(saved) {
    var restored = makeInitialState();
    restored.wave = saved.wave;
    restored.lives = saved.lives;
    restored.bossRush = !!saved.bossRush;
    restored.spawnedThisWave = saved.spawnedThisWave;
    restored.resolvedThisWave = saved.resolvedThisWave;
    restored.nextEntityId = saved.nextEntityId;
    restored.enemies = saved.enemies || [];
    restored.powerups = saved.powerups || [];
    restored.boss = saved.boss || null;
    restored.halfSpeedRemainingMs = saved.halfSpeedRemainingMs || 0;
    restored.halfLengthRemainingMs = saved.halfLengthRemainingMs || 0;
    restored.usedSentences = saved.usedSentences || {};
    restored.pausedFromMode = saved.resumeMode;
    restored.mode = STATE.PAUSED;
    restored.seed = saved.seed || null;
    restored.inputLog = saved.inputLog || null;
    restored.runId = saved.runId || null;
    restored.tickCount = saved.tickCount || 0;
    restored.score = saved.score || 0;
    restored.scoreMultiplier = saved.scoreMultiplier || 1;
    restored.wordCombo = saved.wordCombo || 0;
    restored.currentWordHadMistake = !!saved.currentWordHadMistake;
    // Restore the RNG's exact live generator position (not just re-seed) so
    // post-resume randomness continues the same sequence a from-scratch
    // replay of this seed + input log would produce, instead of restarting
    // it -- see Rng.getState()'s comment in js/rng.js for why this matters.
    if (saved.rngState !== undefined) Rng.setState(saved.rngState);
    return restored;
  }

  function init(canvas) {
    ctx = canvas.getContext('2d');
    var saved = SaveGame.load();
    state = saved ? restoreStateFromSave(saved) : makeInitialState();
    // Pause proactively the instant the page is hidden, rather than relying
    // solely on next-frame dt measurement — closes a race where a "resume"
    // keypress right as the tab regains focus could be processed before the
    // huge-dt frame has a chance to self-pause (forcing a double press).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && isActiveSimulationMode()) {
        pauseGame();
      }
    });
    // A final flush for teardown paths visibilitychange might not catch on
    // every browser (e.g. process termination without a visibility change).
    window.addEventListener('pagehide', function () {
      SaveGame.save(state);
    });
    requestAnimationFrame(loop);
  }

  return {
    STATE: STATE,
    ENEMIES_PER_WAVE: ENEMIES_PER_WAVE,
    POWERUP_DISPLAY_NAMES: POWERUP_DISPLAY_NAMES,
    BOSS_SEGMENT_WIDTH: BOSS_SEGMENT_WIDTH,
    BOSS_SEGMENT_GAP: BOSS_SEGMENT_GAP,
    BOSS_SEGMENT_PADDING: BOSS_SEGMENT_PADDING,
    init: init,
    handleDigitKey: handleDigitKey,
    handleMenuKey: handleMenuKey,
    handleBossRushKey: handleBossRushKey,
    handleQuitKey: handleQuitKey,
    handleLeaderboardKey: handleLeaderboardKey,
    getWordLengthRangeForWave: getWordLengthRangeForWave,
    worldOfWave: worldOfWave,
    waveInWorld: waveInWorld,
    replayRun: replayRun
  };
})();
