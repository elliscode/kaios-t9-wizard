var Layout = (function () {
  var canvas = document.getElementById('game');

  // The canvas's actual drawing resolution is set to match whatever the
  // real available viewport is, exactly — not a fixed 240x320 assumption.
  // A browser that reserves extra vertical chrome (eating into
  // window.innerHeight) simply results in a shorter CANVAS_HEIGHT here; the
  // game fills that fully, with no letterboxing and no separate reserved
  // HUD strip that could get clipped. There is no PLAY_FIELD_HEIGHT concept
  // anymore — the whole canvas is the play field, and the HUD is drawn as
  // a small overlay directly on top of it (see render.js).
  var CANVAS_WIDTH = (typeof window !== 'undefined' && window.innerWidth) || 240;
  var CANVAS_HEIGHT = (typeof window !== 'undefined' && window.innerHeight) || 320;

  if (canvas) {
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
  }

  return {
    CANVAS_WIDTH: CANVAS_WIDTH,
    CANVAS_HEIGHT: CANVAS_HEIGHT
  };
})();
