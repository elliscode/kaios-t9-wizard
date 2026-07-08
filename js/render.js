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

  // Semi-transparent backing (same color as the playfield background) behind
  // each text line, so text stays legible over whatever's behind it — another
  // block it happens to overlap, or just the bare playfield. Drawn as its own
  // pass, before the lock outline, so the outline is never painted over by it.
  function drawTextBackground(ctx, entity, display, maxCharsPerLine) {
    ctx.font = '11px monospace';
    var lines = wrapTextWithIndices(display, maxCharsPerLine || display.length);
    ctx.fillStyle = 'rgba(17, 17, 17, 0.5)';
    lines.forEach(function (line, i) {
      var fullWidth = ctx.measureText(line.text).width;
      var startX = entity.x + entity.width / 2 - fullWidth / 2;
      var y = entity.y + entity.height + 2 + i * LINE_HEIGHT;
      ctx.fillRect(startX - 2, y - 1, fullWidth + 4, LINE_HEIGHT);
    });
  }

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

  function drawEntityBlock(ctx, entity, word, isLocked, buffer, hideText) {
    var highlightLen = isLocked ? buffer.length : 0;

    ctx.fillStyle = entity.color;
    ctx.fillRect(entity.x, entity.y, entity.width, entity.height);
    if (!hideText) drawTextBackground(ctx, entity, word);
    if (isLocked) drawLockOutline(ctx, entity);
    if (!hideText) drawTextWithHighlight(ctx, entity, word, highlightLen);
  }

  // Draw priority within a category: further down the screen (larger y,
  // closer to the player, more urgent) wins and is drawn last/on top of
  // ones further up. Sorts a copy — state.enemies/state.powerups order is
  // relied on elsewhere and must never be mutated by rendering.
  function sortedByYAscending(list) {
    return list.slice().sort(function (a, b) { return a.y - b.y; });
  }

  // Enemies/powerups are drawn in array order, which has nothing to do with
  // which one is locked — so the locked entity is skipped here and redrawn
  // last by renderFrame, on top of everything else, so it's never obscured.
  function renderEnemies(ctx, enemies, buffer, lockedEnemyId, hideText) {
    sortedByYAscending(enemies).forEach(function (enemy) {
      if (enemy.id === lockedEnemyId) return;
      drawEntityBlock(ctx, enemy, enemy.word, false, buffer, hideText);
    });
  }

  function renderBoss(ctx, boss, buffer, lockedEnemyId, hideText, playerY) {
    var isLocked = boss.id === lockedEnemyId;
    var highlightLen = isLocked ? buffer.length : 0;

    ctx.fillStyle = boss.color;
    ctx.fillRect(boss.x, boss.y, boss.width, boss.height);

    // Health is carved directly into the boss's own body: an intact segment
    // is indistinguishable from the rest of the (already boss.color) box, so
    // only depleted segments need repainting, in the background color — each
    // one reads as a literal chunk bitten out as the boss loses health.
    var segX = boss.x + Game.BOSS_SEGMENT_PADDING;
    for (var i = 0; i < boss.maxHealth; i++) {
      if (i >= boss.health) {
        ctx.fillStyle = '#111';
        ctx.fillRect(segX, boss.y + (boss.height / 4), Game.BOSS_SEGMENT_WIDTH, boss.height / 2);
      }
      segX += Game.BOSS_SEGMENT_WIDTH + Game.BOSS_SEGMENT_GAP;
    }

    // No lock outline here — boss mode only ever has one typable entity on
    // screen, so highlighting "which one is locked" is redundant clutter.

    if (!hideText) {
      // Freeze the sentence's vertical position once it would start closing
      // in on the player, while the box itself keeps falling (and can still
      // collide normally) — otherwise a fast-falling, multi-line sentence
      // can scroll off-screen before the player has a fair chance to finish
      // typing it, well before the box itself reaches the player.
      var lineCount = wrapTextWithIndices(boss.sentence, BOSS_SENTENCE_WRAP_CHARS).length;
      var maxTextY = playerY - boss.height - 2 - lineCount * LINE_HEIGHT;
      var textAnchor = { x: boss.x, y: Math.min(boss.y, maxTextY), width: boss.width, height: boss.height };
      drawTextBackground(ctx, textAnchor, boss.sentence, BOSS_SENTENCE_WRAP_CHARS);
      drawTextWithHighlight(ctx, textAnchor, boss.sentence, highlightLen, BOSS_SENTENCE_WRAP_CHARS);
    }
  }

  function renderPowerups(ctx, powerups, buffer, lockedEnemyId, hideText) {
    sortedByYAscending(powerups).forEach(function (powerup) {
      if (powerup.id === lockedEnemyId) return;
      drawEntityBlock(ctx, powerup, powerup.word, false, buffer, hideText);
    });
  }

  // Redraws whichever entity (enemy or powerup) is currently locked, on top
  // of everything else in the non-boss render pass — see renderEnemies.
  function renderLockedEntityOnTop(ctx, enemies, powerups, buffer, lockedEnemyId, hideText) {
    if (lockedEnemyId == null) return;
    var locked = enemies.concat(powerups).filter(function (e) { return e.id === lockedEnemyId; })[0];
    if (locked) drawEntityBlock(ctx, locked, locked.word, true, buffer, hideText);
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
    ctx.fillText('Press * for boss rush', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
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
    ctx.fillText('Press 1 to return to main menu', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
    ctx.textAlign = 'left';
  }

  function renderWinOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    // Boss rush is a testing/practice mode, not a real run -- keep its
    // ending visually distinct so it's obvious it won't count toward a
    // future leaderboard, unlike a genuine "all 5 worlds cleared" win.
    ctx.fillText(state.bossRush ? 'BOSS RUSH COMPLETE' : 'YOU WIN', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 24);
    ctx.font = '10px monospace';
    ctx.fillText(state.bossRush ? 'All 5 bosses defeated' : 'All 5 worlds cleared', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.fillText('Press 1 to return to main menu', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 18);
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
      renderBoss(ctx, state.boss, buffer, lockedId, isPaused, state.player.y);
    } else {
      renderEnemies(ctx, state.enemies, buffer, lockedId, isPaused);
      renderPowerups(ctx, state.powerups, buffer, lockedId, isPaused);
      renderLockedEntityOnTop(ctx, state.enemies, state.powerups, buffer, lockedId, isPaused);
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
