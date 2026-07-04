(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('game');

    Game.init(canvas);

    document.addEventListener('keydown', function (e) {
      if (e.key === '1') {
        e.preventDefault();
        Game.handleMenuKey();
      } else if (e.key >= '2' && e.key <= '9') {
        e.preventDefault();
        Game.handleDigitKey(e.key);
      }
    });
  });
})();
