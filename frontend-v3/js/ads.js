// Gated interstitial ad -- shown only at three points (see game.js's
// showGatedAd, called from handleMenuKey's GAMEOVER, SUBMITTED, and
// CONFIRM_QUIT branches): a non-submittable game over (immediately, no
// leaderboard step to protect), a submittable one (deferred until after
// SUBMITTED, so an ad that hijacks/closes the app can never cost the
// player their leaderboard entry -- see pendingGameOverAd), or confirming
// a quit. Deliberately never shown on a win -- losing is "punished" with
// an ad, winning isn't. Ads are a monetization nice-to-have, exactly like
// SaveGame's localStorage calls or AudioEngine's sound -- never allowed to
// block or break the game.
var AdsEngine = (function () {
  // `publisher` reused from the same developer's other KaiOS app
  // (kaios-shared-list) on the assumption it's one shared publisher account
  // -- confirmed live/working (verified against real KaiAds infrastructure
  // during testing). `app`/`slot` are this-app-specific placeholders; verify
  // they match whatever's actually registered in the KaiAds dashboard.
  var KAIADS_PUBLISHER = '91b81d86-37cf-4a2f-a895-111efa5b36bb';
  var KAIADS_APP = 't9wizard';
  var KAIADS_SLOT = 'gameover';

  // This is the app's actual real-device origin too -- packaged KaiOS apps
  // installed from the store run under this same hostname, not just local
  // dev/testing -- so this restricts ad requests to legitimate app
  // installs (this origin) rather than, say, this same code being loaded
  // from some other arbitrary host.
  var ALLOWED_HOSTNAME = 't9wizard.localhost';

  // How long showAd() will wait for the SDK's own 'close' event before
  // giving up and letting the player continue anyway -- a real ad should
  // never be able to permanently strand someone on this screen.
  var CLOSE_TIMEOUT_MS = 30000;

  // How long showAd() will wait for an ad to become ready at all (SDK
  // script load + the getKaiAd request itself) before giving up -- separate
  // from CLOSE_TIMEOUT_MS above, which only starts once an ad is actually
  // displaying. On a slow connection this is what stops the "Loading..."
  // screen (renderAdOverlay) from hanging indefinitely.
  var AD_READY_TIMEOUT_MS = 10000;

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
    // -- guards against AD_READY_TIMEOUT_MS firing and then a slow-but-
    // successful load calling back a second time, which would otherwise
    // replay the caller's onDone (e.g. returnToMenu()) twice.
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
      displayAndWait(ad, finish); // already ready -- no AD_READY_TIMEOUT_MS needed
      preloadAd(); // top back up for the next game-over/quit this session
      return;
    }
    // Covers both failure modes in one deadline: the SDK script never
    // loading at all (ensureSdkLoaded's callback below never runs), and the
    // script loading fine but getKaiAd's own onready/onerror hanging.
    var readyTimer = setTimeout(finish, AD_READY_TIMEOUT_MS);
    ensureSdkLoaded(function () {
      try {
        if (typeof getKaiAd !== 'function') {
          clearTimeout(readyTimer);
          finish();
          return;
        }
        getKaiAd({
          publisher: KAIADS_PUBLISHER,
          app: KAIADS_APP,
          slot: KAIADS_SLOT,
          onerror: function () {
            clearTimeout(readyTimer);
            finish();
          },
          onready: function (ad) {
            clearTimeout(readyTimer);
            displayAndWait(ad, finish);
          }
        });
      } catch (e) {
        clearTimeout(readyTimer);
        finish();
      }
    });
  }

  return { preloadAd: preloadAd, showAd: showAd };
})();
