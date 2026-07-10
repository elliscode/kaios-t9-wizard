// Gated interstitial ad -- shown only at two points (see game.js's
// showGatedAd, called from handleMenuKey's GAMEOVER and CONFIRM_QUIT
// branches): losing a run, or confirming a quit. Deliberately never shown
// on a win -- losing is "punished" with an ad, winning isn't. Ads are a
// monetization nice-to-have, exactly like SaveGame's localStorage calls or
// AudioEngine's sound -- never allowed to block or break the game.
var AdsEngine = (function () {
  // `publisher` reused from the same developer's other KaiOS app
  // (kaios-shared-list) on the assumption it's one shared publisher account
  // -- confirmed live/working (verified against real KaiAds infrastructure
  // during testing). `app`/`slot` are this-app-specific placeholders; verify
  // they match whatever's actually registered in the KaiAds dashboard.
  var KAIADS_PUBLISHER = '91b81d86-37cf-4a2f-a895-111efa5b36bb';
  var KAIADS_APP = 't9wizard';
  var KAIADS_SLOT = 'gameover';

  // Deliberately restricted to this one hostname -- a controlled local
  // testing target, not the real store-released app's origin. TODO:
  // revisit before/when doing real IMEI-registered device testing on the
  // KaiOS store, since as written this means the ad never fires outside
  // this specific test setup.
  var ALLOWED_HOSTNAME = 't9wizard.localhost';

  // How long showAd() will wait for the SDK's own 'close' event before
  // giving up and letting the player continue anyway -- a real ad should
  // never be able to permanently strand someone on this screen.
  var CLOSE_TIMEOUT_MS = 30000;

  var sdkLoadStarted = false;
  var sdkReady = false;
  var pendingSdkCallbacks = [];
  var preloadedAd = null;
  var preloadPending = false;

  function allowed() {
    return window.location.hostname === ALLOWED_HOSTNAME;
  }

  // kaiads.v5.min.js isn't a static <script> tag in index.html -- its own
  // shim runs (and reaches out to the network) the instant it loads,
  // regardless of whether getKaiAd is ever actually called, so the origin
  // check has to gate *loading the file at all*, not just calling it.
  function ensureSdkLoaded(callback) {
    if (!allowed()) return;
    if (sdkReady) {
      callback();
      return;
    }
    pendingSdkCallbacks.push(callback);
    if (sdkLoadStarted) return;
    sdkLoadStarted = true;
    try {
      var script = document.createElement('script');
      script.src = 'kaiads.v5.min.js';
      script.onload = function () {
        sdkReady = true;
        var callbacks = pendingSdkCallbacks;
        pendingSdkCallbacks = [];
        callbacks.forEach(function (cb) {
          try {
            cb();
          } catch (e) {}
        });
      };
      script.onerror = function () {
        // SDK file itself failed to load -- just never becomes ready;
        // queued callbacks are simply never called, matching "no ad".
      };
      document.head.appendChild(script);
    } catch (e) {
      // Never let ad-loading break the game.
    }
  }

  // Requests an ad ahead of time (see the SDK's own "preloading" guidance)
  // so it's already sitting ready by the time a game-over/quit actually
  // happens, instead of the player waiting on a fresh network request right
  // when they're already annoyed about losing.
  function preloadAd() {
    if (!allowed() || preloadPending || preloadedAd) return;
    preloadPending = true;
    ensureSdkLoaded(function () {
      try {
        if (typeof getKaiAd !== 'function') {
          preloadPending = false;
          return;
        }
        getKaiAd({
          publisher: KAIADS_PUBLISHER,
          app: KAIADS_APP,
          slot: KAIADS_SLOT,
          onerror: function () {
            preloadPending = false;
          },
          onready: function (ad) {
            preloadPending = false;
            preloadedAd = ad;
          }
        });
      } catch (e) {
        preloadPending = false;
      }
    });
  }

  function displayAndWait(ad, onDone) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      onDone();
    }
    try {
      if (typeof ad.on === 'function') ad.on('close', finish);
      ad.call('display');
    } catch (e) {
      finish();
      return;
    }
    setTimeout(finish, CLOSE_TIMEOUT_MS);
  }

  // The actual "watch an ad, then continue" gate -- always calls onDone
  // exactly once, whether or not an ad was actually shown (no SDK, wrong
  // host, no fill, etc. all just skip straight to onDone).
  function showAd(onDone) {
    // finish() is idempotent and is the only thing that reaches onDone below
    // -- guards against the SDK-load fallback timeout firing and then a
    // slow-but-successful load calling back a second time, which would
    // otherwise replay the caller's onDone (e.g. returnToMenu()) twice.
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      onDone();
    }

    if (!allowed()) {
      finish();
      return;
    }
    if (preloadedAd) {
      var ad = preloadedAd;
      preloadedAd = null;
      displayAndWait(ad, finish);
      preloadAd(); // top back up for the next game-over/quit this session
      return;
    }
    ensureSdkLoaded(function () {
      try {
        if (typeof getKaiAd !== 'function') {
          finish();
          return;
        }
        getKaiAd({
          publisher: KAIADS_PUBLISHER,
          app: KAIADS_APP,
          slot: KAIADS_SLOT,
          onerror: finish,
          onready: function (ad) {
            displayAndWait(ad, finish);
          }
        });
      } catch (e) {
        finish();
      }
    });
    // If the SDK never becomes ready at all (script failed to load), the
    // queued ensureSdkLoaded callback above simply never runs -- fall back
    // to continuing after a short wait rather than never calling onDone.
    setTimeout(function () {
      if (!sdkReady) finish();
    }, 5000);
  }

  return { preloadAd: preloadAd, showAd: showAd };
})();
