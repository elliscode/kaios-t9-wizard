// Playback driver for the replay viewer. Runs inside game-frame.html's
// iframe, after all the real game scripts have loaded. Deliberately does
// not modify Game/Render/etc. -- only overrides window.requestAnimationFrame
// (so *we* control tick pacing) and wraps Render.renderFrame (a plain
// mutable global) to observe live state. The control-bar/keypad DOM lives
// in the parent page (index.html); this file calls into
// window.parent.ReplayerPlayerUI for anything that needs to touch it, and
// exposes play/pause/setSpeed/seek/isPlaying for the parent to call back
// into. See tools/replayer/README.md for the full design rationale.
(function () {
  'use strict';

  var TICK_MS = 33; // must match game.js's own TICK_MS

  // ---- Controllable frame pump ----------------------------------------
  // Game.init() ends with requestAnimationFrame(loop), and loop() itself
  // re-schedules via requestAnimationFrame(loop) every call. Overriding it
  // to just capture the pending callback (instead of letting the browser
  // schedule it) means nothing advances until *we* call pump() -- that's
  // what makes pause/fast-forward/seek possible without touching game.js.
  var pendingRAFCallback = null;
  var fakeTimestamp = 0;
  window.requestAnimationFrame = function (cb) {
    pendingRAFCallback = cb;
    return 0; // fake handle; game.js never calls cancelAnimationFrame
  };

  // ---- State introspection ---------------------------------------------
  // Render.renderFrame(ctx, state) is called once per loop() invocation
  // with the live, module-private `state` -- wrapping it (not replacing
  // it) is how the UI reads tickCount/mode/score without any new
  // accessor needing to be added to game.js.
  var lastState = null;
  var lastCtx = null;
  var originalRenderFrame = null;
  var suppressRender = false; // true during a burst-seek: skip drawing/flashing every intermediate frame

  function wrapRenderFrame() {
    originalRenderFrame = Render.renderFrame;
    Render.renderFrame = function (ctx, state) {
      lastState = state;
      lastCtx = ctx;
      if (!suppressRender) originalRenderFrame(ctx, state);
    };
  }

  function currentTick() {
    return lastState ? lastState.tickCount : 0;
  }

  // ---- Input dispatch ----------------------------------------------------
  var inputLog = [];
  var inputIndex = 0;

  // Dispatches every input_log entry due at or before `uptoTick` --
  // mirrors Game.replayRun's own per-tick dispatch-before-advance order.
  // `quiet` skips the keypad flash (used during a burst-seek, where
  // flashing through hundreds of presses in a fraction of a second would
  // be meaningless noise rather than something watchable).
  function dispatchDueInputs(uptoTick, quiet) {
    while (inputIndex < inputLog.length && inputLog[inputIndex].tick <= uptoTick) {
      var key = inputLog[inputIndex].key;
      Game.handleDigitKey(key);
      if (!quiet) parentUI().flashKey(key);
      inputIndex++;
    }
  }

  // One tick step. Always dispatches whatever's due for the tick this pump
  // is about to produce, then invokes the captured RAF callback with a
  // timestamp exactly TICK_MS past the last one -- loop()'s own
  // simAccumulator math guarantees that produces exactly one simulated
  // tick per pump (after an initial no-op warm-up call), which is what
  // keeps key dispatch tick-accurate regardless of playback speed.
  function pump(quiet) {
    if (!pendingRAFCallback) return false;
    dispatchDueInputs(currentTick(), quiet);
    var cb = pendingRAFCallback;
    pendingRAFCallback = null;
    fakeTimestamp += TICK_MS;
    cb(fakeTimestamp);
    return true;
  }

  // Pumps (rendering suppressed) until either targetTick is reached or the
  // game runs out of scheduled frames. Used by both seek-forward and the
  // post-reload backward-seek catch-up.
  function burstTo(targetTick, done) {
    suppressRender = true;
    var guard = 0;
    var GUARD_MAX = 5000000; // sane upper bound so a bug here can't hang the tab forever
    while (currentTick() < targetTick && guard < GUARD_MAX) {
      if (!pump(true)) break;
      guard++;
    }
    suppressRender = false;
    if (lastCtx && lastState) originalRenderFrame(lastCtx, lastState);
    done();
  }

  // ---- Play / pause / speed ---------------------------------------------
  var playIntervalId = null;
  var speedMultiplier = 1;

  function isPlaying() { return playIntervalId !== null; }

  function play() {
    if (isPlaying()) return;
    playIntervalId = setInterval(function () {
      pump(false);
      reportState();
      if (lastState && (lastState.mode === 'gameover' || lastState.mode === 'win')) pause();
    }, TICK_MS / speedMultiplier);
    parentUI().setPlaying(true);
  }

  function pause() {
    if (!isPlaying()) return;
    clearInterval(playIntervalId);
    playIntervalId = null;
    parentUI().setPlaying(false);
  }

  function setSpeed(n) {
    speedMultiplier = n;
    if (isPlaying()) { pause(); play(); }
  }

  // ---- Seek ---------------------------------------------------------------
  // Forward: cheap, just keep pumping (with rendering suppressed) from the
  // current position -- fully incremental, no restart needed. Backward:
  // there is no resumable/incremental replay API (confirmed against
  // Game.replayRun), so the only way to reach an earlier tick is to start
  // the whole run over. Reloading the frame (re-running the exact same
  // bootstrap, same injected seed) is simpler and more robust than trying
  // to force Game's private state machine back to MENU from an arbitrary
  // mode -- the target tick (and whether to resume playing) rides through
  // the reload via sessionStorage.
  function seek(targetTick) {
    var wasPlaying = isPlaying();
    pause();
    if (targetTick >= currentTick()) {
      parentUI().setSeeking(true);
      setTimeout(function () {
        burstTo(targetTick, function () {
          parentUI().setSeeking(false);
          reportState();
          if (wasPlaying) play();
        });
      }, 0);
    } else {
      sessionStorage.setItem('replayerPendingSeek', JSON.stringify({ targetTick: targetTick, resume: wasPlaying }));
      location.reload();
    }
  }

  // ---- Parent UI bridge -----------------------------------------------------
  function parentUI() {
    return window.parent.ReplayerPlayerUI;
  }

  function reportState() {
    if (!lastState) return;
    parentUI().updateState(lastState, replayData.tick_count);
  }

  // ---- Bootstrap ------------------------------------------------------------
  var replayData = null;

  function start(data) {
    replayData = data;
    inputLog = data.input_log;
    inputIndex = 0;

    wrapRenderFrame();

    // The real save.js is loaded for full fidelity, and it's genuinely
    // active -- checkCollisions()/handleKill()/etc. call SaveGame.save()
    // every tick during real play, same as the shipped app. Without this,
    // Game.init() would find that real in-progress save (written by *this
    // harness's own* playback) and silently resume it instead of going to
    // MENU, bypassing our seeded Api.start() stub entirely -- this bit
    // exactly on the very first backward-seek reload during development.
    if (typeof SaveGame !== 'undefined') SaveGame.clear();

    Game.init(document.getElementById('game'));
    Game.handleMenuKey(); // MENU -> resetGame() -> beginRun() -> our stubbed Api.start()

    var pending = null;
    try {
      var raw = sessionStorage.getItem('replayerPendingSeek');
      if (raw) {
        pending = JSON.parse(raw);
        sessionStorage.removeItem('replayerPendingSeek');
      }
    } catch (e) { /* sessionStorage unavailable -- fine, just skip pending-seek resume */ }

    // Deferred one tick so the stubbed Api.start() promise (a microtask)
    // resolves first and the run actually starts (mode leaves CONNECTING)
    // before we begin pumping.
    setTimeout(function () {
      if (pending) {
        parentUI().setSeeking(true);
        burstTo(pending.targetTick, function () {
          parentUI().setSeeking(false);
          reportState();
          if (pending.resume) play();
        });
      } else {
        // A few warm-up pumps so the initial world/wave transition is
        // visible immediately, then sit paused until the user presses Play.
        for (var i = 0; i < 3; i++) pump(false);
        reportState();
      }
    }, 0);
  }

  window.ReplayerPlayer = {
    start: start,
    play: play,
    pause: pause,
    setSpeed: setSpeed,
    seek: seek,
    isPlaying: isPlaying
  };
})();
