var Game = (function () {
  var CANVAS_WIDTH = 240;
  var CANVAS_HEIGHT = 320;
  var PLAY_FIELD_HEIGHT = 294;

  var STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover' };

  var KILLS_PER_LEVEL = 20;
  var STARTING_LIVES = 3;

  // Tunable, NOT level-scaled: only word length scales with level per spec.
  var SPAWN_INTERVAL_MS = 1800;
  var ENEMY_FALL_SPEED = 30; // px/sec
  var ENEMY_SPEED_JITTER = 0.2; // +/-20% cosmetic randomness only

  var COLOR_PALETTE = ['#e74c3c', '#e67e22', '#9b59b6', '#3498db', '#1abc9c', '#f1c40f'];
  var MIN_BLOCK_WIDTH = 28;
  var CHAR_WIDTH_ESTIMATE = 10;
  var BLOCK_HEIGHT = 18;

  var ctx = null;
  var state = null;

  function makeInitialState() {
    return {
      mode: STATE.MENU,
      enemies: [],
      nextEnemyId: 1,
      lives: STARTING_LIVES,
      level: 1,
      kills: 0,
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

  function getWordLengthRangeForLevel(level) {
    // TUNABLE — a reasonable default, not gospel. Shifts a 3-length window
    // upward per level, capped so words never outgrow the 240px-wide canvas.
    return {
      minLen: Math.min(level + 1, 10),
      maxLen: Math.min(level + 3, 12)
    };
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
    var range = getWordLengthRangeForLevel(state.level);
    var activeWords = {};
    state.enemies.forEach(function (e) { activeWords[e.word] = true; });
    var activeWordsSet = {
      has: function (w) { return !!activeWords[w]; }
    };

    var word = WordBank.pickWord(range.minLen, range.maxLen, activeWordsSet);
    var code = T9.wordToT9Code(word);
    var width = Math.max(MIN_BLOCK_WIDTH, word.length * CHAR_WIDTH_ESTIMATE * 0.6 + 12);

    var x = findNonOverlappingX(width);
    var speed = ENEMY_FALL_SPEED * (1 + (Math.random() * 2 - 1) * ENEMY_SPEED_JITTER);
    var color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];

    state.enemies.push(Enemy.createEnemy({
      id: state.nextEnemyId++,
      word: word,
      code: code,
      x: x,
      y: -BLOCK_HEIGHT,
      width: width,
      height: BLOCK_HEIGHT,
      color: color,
      speed: speed
    }));
  }

  function updateSpawning(dt) {
    state.spawnAccumulator += dt;
    while (state.spawnAccumulator >= SPAWN_INTERVAL_MS) {
      spawnEnemy();
      state.spawnAccumulator -= SPAWN_INTERVAL_MS;
    }
  }

  function updateEnemies(dt) {
    var dtSeconds = dt / 1000;
    state.enemies.forEach(function (e) {
      e.y += e.speed * dtSeconds;
    });
  }

  function checkCollisions() {
    var stillAlive = [];
    state.enemies.forEach(function (enemy) {
      if (enemy.y + enemy.height >= state.player.y) {
        state.lives -= 1;
        if (enemy.id === InputEngine.getLockedEnemyId()) InputEngine.reset();
      } else {
        stillAlive.push(enemy);
      }
    });
    state.enemies = stillAlive;
    if (state.lives <= 0) {
      state.mode = STATE.GAMEOVER;
    }
  }

  function handleKill(enemyId) {
    state.enemies = state.enemies.filter(function (e) { return e.id !== enemyId; });
    state.kills += 1;
    if (state.kills >= KILLS_PER_LEVEL) {
      state.level += 1;
      state.kills = 0;
    }
  }

  function update(dt) {
    updateSpawning(dt);
    updateEnemies(dt);
    checkCollisions();
  }

  function resetGame() {
    state = makeInitialState();
    InputEngine.reset();
    state.mode = STATE.PLAYING;
  }

  function handleDigitKey(digit) {
    if (state.mode === STATE.MENU || state.mode === STATE.GAMEOVER) {
      resetGame();
      return;
    }
    if (state.mode !== STATE.PLAYING) return;

    var result = InputEngine.handleDigit(digit, state.enemies);
    if (result.type === 'kill') {
      handleKill(result.enemyId);
    }
  }

  function loop(timestamp) {
    if (state.lastTimestamp === null) state.lastTimestamp = timestamp;
    var dt = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;

    if (state.mode === STATE.PLAYING) update(dt);
    Render.renderFrame(ctx, state);

    requestAnimationFrame(loop);
  }

  function init(canvas) {
    ctx = canvas.getContext('2d');
    state = makeInitialState();
    requestAnimationFrame(loop);
  }

  return {
    STATE: STATE,
    init: init,
    handleDigitKey: handleDigitKey,
    getWordLengthRangeForLevel: getWordLengthRangeForLevel
  };
})();
