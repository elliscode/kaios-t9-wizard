(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('game');

    Game.init(canvas);
    // Warms up an ad ahead of time so it's ready the moment a game-over or
    // quit-confirm actually needs one -- the real display happens later, via
    // Game's showGatedAd (see js/ads.js and js/game.js). Safely no-ops
    // outside the allowed test host (e.g. testing in a desktop browser).
    if (typeof AdsEngine !== 'undefined') AdsEngine.preloadAd();

    document.addEventListener('keydown', function (e) {
      // While the real name-entry <input> is focused, every keystroke must
      // reach it natively (typing, backspace, arrow keys, Enter) instead of
      // being hijacked as T9 gameplay input.
      if (typeof NameEntry !== 'undefined' && NameEntry.isActive()) return;

      if (e.key === '1') {
        // Pauses during play; picks the selected option on a menu screen.
        e.preventDefault();
        Game.handleMenuKey();
      } else if (e.key >= '2' && e.key <= '9') {
        e.preventDefault();
        Game.handleDigitKey(e.key);
      } else if (e.key === '*' || e.key === '#') {
        e.preventDefault();
        // Boss rush's old key -- commented out, not deleted, alongside its
        // menu text in render.js (see renderMenuOverlay).
        // Game.handleBossRushKey();
        Game.handlePauseKey();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        Game.handleNavKey(e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        Game.handleSelectKey();
      }
    });
  });
})();
