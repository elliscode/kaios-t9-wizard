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
      } else if (e.key === '0') {
        e.preventDefault();
        Game.handleLeaderboardKey();
      } else if (e.key === '*') {
        e.preventDefault();
        Game.handleBossRushKey();
      } else if (e.key === '#') {
        e.preventDefault();
        Game.handleQuitKey();
      }
    });
  });
})();
