var Layout = (function () {
  var CANVAS_WIDTH = 240;
  var CANVAS_HEIGHT = 320;

  // KaiOS's browser (as opposed to the packaged app, whose origin is a
  // .localhost-style internal hostname) adds an extra chrome bar on real web
  // domains, eating into the usable canvas height. A ".com" hostname is used
  // as a reasonable proxy for "running in the browser on the public web."
  var hostname = ((typeof window !== 'undefined' && window.location && window.location.hostname) || '').toLowerCase();
  var suffix = '.com';
  var isDotComDomain = hostname.length >= suffix.length &&
    hostname.slice(hostname.length - suffix.length) === suffix;
  var PLAY_FIELD_HEIGHT = isDotComDomain ? 276 : 294;

  return {
    CANVAS_WIDTH: CANVAS_WIDTH,
    CANVAS_HEIGHT: CANVAS_HEIGHT,
    PLAY_FIELD_HEIGHT: PLAY_FIELD_HEIGHT
  };
})();
