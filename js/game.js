var Game = (function () {
  var CANVAS_WIDTH = Layout.CANVAS_WIDTH;
  var CANVAS_HEIGHT = Layout.CANVAS_HEIGHT;
  var PLAY_FIELD_HEIGHT = Layout.PLAY_FIELD_HEIGHT;

  var STATE = { MENU: 'menu', PLAYING: 'playing', TRANSITION: 'transition', BOSS: 'boss', PAUSED: 'paused', GAMEOVER: 'gameover', WIN: 'win' };

  var ENEMIES_PER_WAVE = 20;
  var STARTING_LIVES = 3;
  var TRANSITION_DURATION_MS = 2000;
  var AUTO_PAUSE_THRESHOLD_MS = 500; // a frame gap this large means the tab was backgrounded/suspended

  // Tunable, NOT wave-scaled: only word length scales with wave/world per spec.
  var SPAWN_INTERVAL_MS = 1800;
  var ENEMY_SPEED_JITTER = 0.2; // +/-20% cosmetic randomness only

  var MIN_BLOCK_WIDTH = 28;
  var CHAR_WIDTH_ESTIMATE = 10;
  var BLOCK_HEIGHT = 18;

  var BASE_BOSS_HEALTH_SEGMENTS = 3; // tunable — world N has BASE + (N-1)*2 segments
  var BOSS_WIDTH = 180;
  var BOSS_HEIGHT = 32;

  // Powerups — each type's probability is independently rolled per player-typed
  // kill, tunable individually here.
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
    return Math.min(30, 120 / len);
  }

  // TUNABLE — boss sentences fall slower than regular enemies since they're
  // much longer to type; later worlds' bosses fall slightly slower still to
  // offset their longer sentences and larger health pools.
  function bossSentenceSpeedForWorld(world) {
    return 11 / world;
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
      usedSentences: {},
      halfSpeedRemainingMs: 0,
      halfLengthRemainingMs: 0,
      powerupFlash: null,
      waveCompletePending: false,
      spawnAccumulator: 0,
      lastTimestamp: null,
      player: {
        x: CANVAS_WIDTH / 2 - 20,
        y: PLAY_FIELD_HEIGHT - 20,
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
      var x = Math.floor(Math.random() * (CANVAS_WIDTH - width));
      var overlaps = state.enemies.some(function (e) {
        return e.y < 40 && x < e.x + e.width && x + width > e.x;
      });
      if (!overlaps) return x;
    }
    return Math.floor(Math.random() * (CANVAS_WIDTH - width));
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
    var jitteredBaseSpeed = enemyFallSpeedForLength(word.length) * (1 + (Math.random() * 2 - 1) * ENEMY_SPEED_JITTER);
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
        if (enemy.id === InputEngine.getLockedEnemyId()) InputEngine.reset();
      } else {
        stillAlive.push(enemy);
      }
    });
    state.enemies = stillAlive;
    state.resolvedThisWave += escaped;
    if (state.lives <= 0) {
      state.mode = STATE.GAMEOVER;
      return;
    }
    checkWaveComplete();
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
  }

  function handleKill(enemyId) {
    var defeated = null;
    state.enemies = state.enemies.filter(function (e) {
      if (e.id === enemyId) { defeated = e; return false; }
      return true;
    });
    state.resolvedThisWave += 1;
    // Powerup rolls only happen on a player-typed kill — not on escapes
    // (checkCollisions) or on screenWipe's own kills — to avoid any risk of
    // cascading spawns.
    if (defeated) rollPowerupSpawns(defeated.x, defeated.y);
    checkWaveComplete();
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
    Object.keys(POWERUP_PROBABILITIES).forEach(function (type) {
      if (Math.random() < POWERUP_PROBABILITIES[type]) {
        spawnPowerup(type, x, y);
      }
    });
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
  }

  function wipeScreen() {
    var count = state.enemies.length;
    state.enemies = [];
    state.resolvedThisWave += count;
    InputEngine.reset();
    checkWaveComplete();
  }

  function applyPowerupEffect(type) {
    if (type === 'extraLife') {
      state.lives += 1;
    } else if (type === 'halfSpeed') {
      state.halfSpeedRemainingMs = POWERUP_EFFECT_DURATION_MS;
    } else if (type === 'halfLength') {
      state.halfLengthRemainingMs = POWERUP_EFFECT_DURATION_MS;
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
    // Set the flash BEFORE applying the effect: screenWipe's effect can
    // itself trigger checkWaveComplete() synchronously (via wipeScreen), and
    // that check needs to already see an active flash in order to defer the
    // transition instead of entering it immediately.
    state.powerupFlash = { type: collected.type, timerMs: POWERUP_FLASH_DURATION_MS };
    applyPowerupEffect(collected.type);
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

  function startBossFight(world) {
    var health = healthSegmentsForWorld(world);
    state.boss = Boss.createBoss({
      id: 'boss-' + world,
      world: world,
      health: health,
      maxHealth: health,
      x: (CANVAS_WIDTH - BOSS_WIDTH) / 2,
      y: -BOSS_HEIGHT,
      width: BOSS_WIDTH,
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
      if (state.lives <= 0) {
        state.mode = STATE.GAMEOVER;
        state.boss = null;
      } else {
        spawnBossSentence(boss);
      }
    }
  }

  function handleBossDefeated() {
    var world = state.boss.world;
    state.boss = null;
    if (world === TOTAL_WORLDS) {
      state.mode = STATE.WIN;
    } else {
      state.wave = world * WAVES_PER_WORLD + 1;
      enterTransition(false);
    }
  }

  function handleBossSentenceCompleted() {
    state.boss.health -= 1;
    if (state.boss.health <= 0) {
      handleBossDefeated();
    } else {
      spawnBossSentence(state.boss);
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

  function resetGame() {
    state = makeInitialState();
    InputEngine.reset();
    enterTransition(false);
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
  }

  function resumeGame() {
    state.mode = state.pausedFromMode;
    state.pausedFromMode = null;
  }

  function handleMenuKey() {
    if (state.mode === STATE.MENU || state.mode === STATE.GAMEOVER || state.mode === STATE.WIN) {
      resetGame();
    } else if (state.mode === STATE.PAUSED) {
      resumeGame();
    } else if (isActiveSimulationMode()) {
      pauseGame();
    }
  }

  function handleDigitKey(digit) {
    if (state.mode !== STATE.PLAYING && state.mode !== STATE.BOSS) {
      // Ignore 2-9 outside of active gameplay, so mashing letters while
      // typing doesn't accidentally skip past a menu/game-over/win screen.
      return;
    }
    if (state.mode === STATE.PLAYING) {
      var typable = state.enemies.concat(state.powerups);
      var result = InputEngine.handleDigit(digit, typable);
      if (result.type === 'kill') {
        var isPowerup = state.powerups.some(function (p) { return p.id === result.enemyId; });
        if (isPowerup) {
          collectPowerup(result.enemyId);
        } else {
          handleKill(result.enemyId);
        }
      }
      return;
    }
    if (state.mode === STATE.BOSS) {
      var bossResult = InputEngine.handleDigit(digit, [state.boss]);
      if (bossResult.type === 'kill') {
        handleBossSentenceCompleted();
      }
      return;
    }
    // TRANSITION: digits are ignored, purely timer-driven.
  }

  function loop(timestamp) {
    if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
    var dt = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;

    if (isActiveSimulationMode()) {
      if (dt > AUTO_PAUSE_THRESHOLD_MS) {
        // A gap this large means the tab was backgrounded/suspended — pause
        // instead of applying that huge delta (which would otherwise jump
        // enemies/boss forward or fire a burst of catch-up spawns).
        pauseGame();
      } else {
        update(dt);
      }
    }
    Render.renderFrame(ctx, state);

    requestAnimationFrame(loop);
  }

  function init(canvas) {
    ctx = canvas.getContext('2d');
    state = makeInitialState();
    // Pause proactively the instant the page is hidden, rather than relying
    // solely on next-frame dt measurement — closes a race where a "resume"
    // keypress right as the tab regains focus could be processed before the
    // huge-dt frame has a chance to self-pause (forcing a double press).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && isActiveSimulationMode()) {
        pauseGame();
      }
    });
    requestAnimationFrame(loop);
  }

  return {
    STATE: STATE,
    ENEMIES_PER_WAVE: ENEMIES_PER_WAVE,
    POWERUP_DISPLAY_NAMES: POWERUP_DISPLAY_NAMES,
    init: init,
    handleDigitKey: handleDigitKey,
    handleMenuKey: handleMenuKey,
    getWordLengthRangeForWave: getWordLengthRangeForWave,
    worldOfWave: worldOfWave,
    waveInWorld: waveInWorld
  };
})();
