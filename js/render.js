var Render = (function () {
  var CANVAS_WIDTH = Layout.CANVAS_WIDTH;
  var CANVAS_HEIGHT = Layout.CANVAS_HEIGHT;
  var BOSS_SENTENCE_WRAP_CHARS = 36;

  function renderPlayField(ctx) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // While paused, state.mode is 'paused' — this recovers "what was actually
  // happening" (playing/transition/boss) so the frozen frame still renders
  // as whatever it was the instant before pausing, rather than blanking out.
  function effectiveMode(state) {
    return state.mode === 'paused' ? state.pausedFromMode : state.mode;
  }

  // Converts a count of typed digits into a character index into `display`,
  // since a sentence's displayed string can contain spaces that don't count
  // as typed digits (spaces require no keypress). Also absorbs any spaces
  // right after the last typed letter, since nothing has to be pressed for
  // them either. For plain words (no spaces) this degenerates to exactly
  // `typedCount`, matching the old behavior.
  function displayHighlightBoundary(display, typedCount) {
    if (typedCount <= 0) return 0;
    var seen = 0;
    var i = 0;
    for (; i < display.length; i++) {
      if (display[i] !== ' ') {
        seen++;
        if (seen === typedCount) break;
      }
    }
    i++;
    while (i < display.length && display[i] === ' ') i++;
    return i;
  }

  // Greedy word-wrap that keeps track of each line's start index into the
  // original (unwrapped) string, so a highlight boundary computed against
  // the full string can be mapped back onto whichever line it falls in.
  // Words are never split; a wrap only ever replaces a space with a line
  // break, so total character count (spaces aside) is preserved.
  function wrapTextWithIndices(text, maxCharsPerLine) {
    var words = text.split(' ');
    var lines = [];
    var cursor = 0;
    var lineStart = 0;
    var lineText = '';
    words.forEach(function (word) {
      var wordStart = cursor;
      var candidate = lineText.length === 0 ? word : lineText + ' ' + word;
      if (candidate.length > maxCharsPerLine && lineText.length > 0) {
        lines.push({ text: lineText, startIndex: lineStart });
        lineText = word;
        lineStart = wordStart;
      } else {
        lineText = candidate;
      }
      cursor += word.length + 1;
    });
    if (lineText.length > 0) lines.push({ text: lineText, startIndex: lineStart });
    return lines;
  }

  var LINE_HEIGHT = 13;

  function drawTextWithHighlight(ctx, entity, display, typedCount, maxCharsPerLine) {
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    var boundary = displayHighlightBoundary(display, typedCount);
    var lines = wrapTextWithIndices(display, maxCharsPerLine || display.length);

    lines.forEach(function (line, i) {
      var localBoundary = Math.max(0, Math.min(line.text.length, boundary - line.startIndex));
      var typed = line.text.slice(0, localBoundary);
      var rest = line.text.slice(localBoundary);
      var fullWidth = ctx.measureText(line.text).width;
      var startX = entity.x + entity.width / 2 - fullWidth / 2;
      var y = entity.y + entity.height + 2 + i * LINE_HEIGHT;

      ctx.fillStyle = '#2ecc71';
      ctx.fillText(typed, startX, y);
      var typedWidth = ctx.measureText(typed).width;

      ctx.fillStyle = '#fff';
      ctx.fillText(rest, startX + typedWidth, y);
    });
  }

  function drawLockOutline(ctx, entity) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(entity.x - 2, entity.y - 2, entity.width + 4, entity.height + 4);
  }

  function renderEnemies(ctx, enemies, buffer, lockedEnemyId, hideText) {
    enemies.forEach(function (enemy) {
      var isLocked = enemy.id === lockedEnemyId;
      var highlightLen = isLocked ? buffer.length : 0;

      ctx.fillStyle = enemy.color;
      ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
      if (isLocked) drawLockOutline(ctx, enemy);
      if (!hideText) drawTextWithHighlight(ctx, enemy, enemy.word, highlightLen);
    });
  }

  function renderBoss(ctx, boss, buffer, lockedEnemyId, hideText) {
    var isLocked = boss.id === lockedEnemyId;
    var highlightLen = isLocked ? buffer.length : 0;

    // Health segments, drawn just above the boss box.
    var segWidth = 14;
    var segGap = 4;
    var totalWidth = boss.maxHealth * segWidth + (boss.maxHealth - 1) * segGap;
    var segStartX = boss.x + boss.width / 2 - totalWidth / 2;
    var segY = boss.y - 14;
    for (var i = 0; i < boss.maxHealth; i++) {
      ctx.fillStyle = i < boss.health ? boss.color : '#333';
      ctx.fillRect(segStartX + i * (segWidth + segGap), segY, segWidth, 10);
    }

    ctx.fillStyle = boss.color;
    ctx.fillRect(boss.x, boss.y, boss.width, boss.height);
    if (isLocked) drawLockOutline(ctx, boss);
    if (!hideText) drawTextWithHighlight(ctx, boss, boss.sentence, highlightLen, BOSS_SENTENCE_WRAP_CHARS);
  }

  function renderPowerups(ctx, powerups, buffer, lockedEnemyId, hideText) {
    powerups.forEach(function (powerup) {
      var isLocked = powerup.id === lockedEnemyId;
      var highlightLen = isLocked ? buffer.length : 0;

      ctx.fillStyle = powerup.color;
      ctx.fillRect(powerup.x, powerup.y, powerup.width, powerup.height);
      if (isLocked) drawLockOutline(ctx, powerup);
      if (!hideText) drawTextWithHighlight(ctx, powerup, powerup.word, highlightLen);
    });
  }

  function renderPlayer(ctx, player) {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);
  }

  var MAX_LIFE_SQUARES = 5;
  var HUD_MARGIN = 6;
  var HUD_SQUARE_SIZE = 12;

  // The HUD is a small overlay drawn directly on top of the play field in
  // the bottom corners — there's no separate reserved "HUD bar" anymore
  // (and so nothing that could get clipped if a browser's chrome eats into
  // the available viewport height). Rendered last in renderFrame, on top
  // of everything else, so it's never obscured by gameplay passing behind
  // it and stays visible through every other overlay (menu/pause/etc).
  function renderHUD(ctx, state) {
    var squaresToShow = Math.min(state.lives, MAX_LIFE_SQUARES);
    var squareY = CANVAS_HEIGHT - HUD_MARGIN - HUD_SQUARE_SIZE;
    var i;
    for (i = 0; i < squaresToShow; i++) {
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(HUD_MARGIN + i * 16, squareY, HUD_SQUARE_SIZE, HUD_SQUARE_SIZE);
    }
    if (state.lives > MAX_LIFE_SQUARES) {
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText('+' + (state.lives - MAX_LIFE_SQUARES), HUD_MARGIN + squaresToShow * 16, squareY + 1);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    var label;
    if (effectiveMode(state) === 'boss') {
      label = 'W' + state.boss.world + ' BOSS';
    } else {
      var world = Game.worldOfWave(state.wave);
      var wiw = Game.waveInWorld(state.wave);
      label = 'W' + world + '-' + wiw + '  ' + state.resolvedThisWave + '/' + Game.ENEMIES_PER_WAVE;
    }
    ctx.fillText(label, CANVAS_WIDTH - HUD_MARGIN, CANVAS_HEIGHT - HUD_MARGIN);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  function renderMenuOverlay(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('T9 WIZARD', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
    ctx.font = '10px monospace';
    ctx.fillText('Press 1 to start', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 4);
    ctx.textAlign = 'left';
  }

  function renderGameOverOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 24);
    ctx.font = '10px monospace';
    var world = Game.worldOfWave(state.wave);
    var wiw = Game.waveInWorld(state.wave);
    ctx.fillText('Reached World ' + world + ' Wave ' + wiw, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.fillText('Press 1 to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
    ctx.textAlign = 'left';
  }

  function renderWinOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('YOU WIN', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 24);
    ctx.font = '10px monospace';
    ctx.fillText('All 5 worlds cleared', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.fillText('Press 1 to restart', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
    ctx.textAlign = 'left';
  }

  function renderPauseOverlay(ctx, state) {
    // Text sits near the top/bottom of the play field, well clear of the
    // transition overlay's centered text — the two can legitimately be
    // drawn on top of each other (pausing mid wave-transition announcement).
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', CANVAS_WIDTH / 2, 30);
    ctx.font = '10px monospace';
    ctx.fillText('Press 1 to resume', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 30);
    ctx.textAlign = 'left';
  }

  var POWERUP_FLASH_BLINK_INTERVAL_MS = 150;

  function renderPowerupFlash(ctx, state) {
    // Deliberately no darkening backdrop, unlike every other overlay — this
    // has to flash over live, continuing gameplay rather than pausing/dimming
    // it. Blinks on/off to read as a "flash" rather than static text.
    var visible = Math.floor(state.powerupFlash.timerMs / POWERUP_FLASH_BLINK_INTERVAL_MS) % 2 === 0;
    if (!visible) return;
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Game.POWERUP_DISPLAY_NAMES[state.powerupFlash.type], CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.textAlign = 'left';
  }

  function renderTransitionOverlay(ctx, state) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    var world = Game.worldOfWave(state.wave);
    var secondLine = state.transition.isBoss ? 'BOSS' : 'WAVE ' + Game.waveInWorld(state.wave);
    ctx.fillText('WORLD ' + world, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 16);
    ctx.fillText(secondLine, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 12);
    ctx.textAlign = 'left';
  }

  function renderFrame(ctx, state) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    renderPlayField(ctx);

    var isPaused = state.mode === 'paused';
    var buffer = InputEngine.getBuffer();
    var lockedId = InputEngine.getLockedEnemyId();
    if (effectiveMode(state) === 'boss') {
      renderBoss(ctx, state.boss, buffer, lockedId, isPaused);
    } else {
      renderEnemies(ctx, state.enemies, buffer, lockedId, isPaused);
      renderPowerups(ctx, state.powerups, buffer, lockedId, isPaused);
    }
    renderPlayer(ctx, state.player);

    if (state.mode === 'gameover') renderGameOverOverlay(ctx, state);
    if (state.mode === 'menu') renderMenuOverlay(ctx);
    if (effectiveMode(state) === 'transition') renderTransitionOverlay(ctx, state);
    if (state.mode === 'win') renderWinOverlay(ctx, state);
    if (state.mode === 'paused') renderPauseOverlay(ctx, state);
    if (state.powerupFlash) renderPowerupFlash(ctx, state);

    // Drawn last so it's always on top — never obscured by gameplay behind
    // it, and still visible through every other overlay.
    renderHUD(ctx, state);
  }

  return {
    renderFrame: renderFrame
  };
})();
