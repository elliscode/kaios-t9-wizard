var Render = (function () {
  var CANVAS_WIDTH = 240;
  var CANVAS_HEIGHT = 320;
  var PLAY_FIELD_HEIGHT = 294;

  function renderPlayField(ctx) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, CANVAS_WIDTH, PLAY_FIELD_HEIGHT);
  }

  function drawWordWithHighlight(ctx, enemy, highlightLen) {
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    var typed = enemy.word.slice(0, highlightLen);
    var rest = enemy.word.slice(highlightLen);
    var fullWidth = ctx.measureText(enemy.word).width;
    var startX = enemy.x + enemy.width / 2 - fullWidth / 2;
    var y = enemy.y + enemy.height + 2;

    ctx.fillStyle = '#2ecc71';
    ctx.fillText(typed, startX, y);
    var typedWidth = ctx.measureText(typed).width;

    ctx.fillStyle = '#fff';
    ctx.fillText(rest, startX + typedWidth, y);
  }

  function drawLockOutline(ctx, enemy) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(enemy.x - 2, enemy.y - 2, enemy.width + 4, enemy.height + 4);
  }

  function renderEnemies(ctx, enemies, buffer, lockedEnemyId) {
    enemies.forEach(function (enemy) {
      var isLocked = enemy.id === lockedEnemyId;
      var highlightLen = isLocked ? buffer.length : 0;

      ctx.fillStyle = enemy.color;
      ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
      if (isLocked) drawLockOutline(ctx, enemy);
      drawWordWithHighlight(ctx, enemy, highlightLen);
    });
  }

  function renderPlayer(ctx, player) {
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.width, player.height);
  }

  function renderHUD(ctx, state) {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, PLAY_FIELD_HEIGHT, CANVAS_WIDTH, CANVAS_HEIGHT - PLAY_FIELD_HEIGHT);

    var i;
    for (i = 0; i < 3; i++) {
      ctx.fillStyle = i < state.lives ? '#e74c3c' : '#442222';
      ctx.fillRect(6 + i * 16, PLAY_FIELD_HEIGHT + 6, 12, 12);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText('Lv ' + state.level + '  ' + state.kills + '/20', CANVAS_WIDTH - 6, PLAY_FIELD_HEIGHT + 8);
    ctx.textAlign = 'left';
  }

  function renderMenuOverlay(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, PLAY_FIELD_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('T9 WIZARD', CANVAS_WIDTH / 2, PLAY_FIELD_HEIGHT / 2 - 20);
    ctx.font = '10px monospace';
    ctx.fillText('Press 2-9 to start', CANVAS_WIDTH / 2, PLAY_FIELD_HEIGHT / 2 + 4);
    ctx.textAlign = 'left';
  }

  function renderGameOverOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, PLAY_FIELD_HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, PLAY_FIELD_HEIGHT / 2 - 24);
    ctx.font = '10px monospace';
    ctx.fillText('Reached level ' + state.level, CANVAS_WIDTH / 2, PLAY_FIELD_HEIGHT / 2);
    ctx.fillText('Press 2-9 to restart', CANVAS_WIDTH / 2, PLAY_FIELD_HEIGHT / 2 + 18);
    ctx.textAlign = 'left';
  }

  function renderFrame(ctx, state) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    renderPlayField(ctx);
    renderEnemies(ctx, state.enemies, InputEngine.getBuffer(), InputEngine.getLockedEnemyId());
    renderPlayer(ctx, state.player);
    renderHUD(ctx, state);

    if (state.mode === 'gameover') renderGameOverOverlay(ctx, state);
    if (state.mode === 'menu') renderMenuOverlay(ctx);
  }

  return {
    renderFrame: renderFrame
  };
})();
