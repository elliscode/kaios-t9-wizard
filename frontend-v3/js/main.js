(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('game');

    Game.init(canvas);

    document.addEventListener('keydown', function (e) {
      // While the real name-entry <input> is focused, every keystroke must
      // reach it natively (typing, backspace, arrow keys, Enter) instead of
      // being hijacked as T9 gameplay input.
      if (typeof NameEntry !== 'undefined' && NameEntry.isActive()) return;

      if (e.key === '1') {
        e.preventDefault();
        Game.handleMenuKey();
      } else if (e.key >= '2' && e.key <= '9') {
        e.preventDefault();
        Game.handleDigitKey(e.key);
      } else if (e.key === '*') {
        e.preventDefault();
        // Boss rush's old key -- commented out, not deleted, alongside its
        // menu text in render.js (see renderMenuOverlay).
        // Game.handleBossRushKey();
        // '*' now covers both leaderboard (from the menu) and quit (from
        // paused) -- safe to call both unconditionally since each already
        // guards on its own required mode, and those modes are mutually
        // exclusive, the same way '1' already means different things
        // depending on state.
        Game.handleLeaderboardKey();
        Game.handleQuitKey();
      }
    });
  });
})();
