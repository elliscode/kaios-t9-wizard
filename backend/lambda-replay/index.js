const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SOURCE_FILE_NAMES = [
  'layout.js', 'rng.js', 't9.js',
  'words-data.js', 'sentences-data.js',
  'words.js', 'sentences.js',
  'enemy.js', 'powerup.js', 'boss.js', 'colors.js',
  'input.js', 'save.js', 'game.js',
];
// Exported so cut-version.sh can read this as the single source of truth
// for which files a version snapshot contains, instead of maintaining a
// second, independently-typed-out copy of the same list that could
// silently drift out of sync with what this Lambda actually loads.
exports.SOURCE_FILE_NAMES = SOURCE_FILE_NAMES;

// Each API version's snapshot is loaded (and its source text cached) lazily,
// the first time that version is actually requested -- a warm container
// serving multiple versions across different invocations builds up one
// cache entry per version, never mixing them. Cutting a new season just adds
// a new vendored/v<N>/ directory; nothing here needs to change.
const loadedVersions = {};

function loadVersion(version) {
  if (loadedVersions[version]) return loadedVersions[version];
  const dir = path.join(__dirname, 'vendored', 'v' + version);
  const sources = SOURCE_FILE_NAMES.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  loadedVersions[version] = sources;
  return sources;
}

exports.handler = async (event) => {
  const { version, seed, inputLog, tickCount, canvasWidth, canvasHeight } = event;
  const startedAt = Date.now();

  // Throws (surfaces to the caller as a Lambda FunctionError) if this
  // version was never cut via cut-version.sh -- in practice this should
  // never happen through the normal flow, since submit_route always passes
  // whatever version was stored on the game record at start time, and that
  // version's snapshot must already have existed for start to have used it.
  const sourceFiles = loadVersion(version);

  // layout.js reads window.innerWidth/innerHeight (with a typeof-guarded
  // fallback) at load time -- this shim is how the replay gets the exact
  // canvas dimensions the original run used, which findNonOverlappingX's
  // Rng.next() calls depend on (see the plan for why this matters).
  const sandbox = {
    window: { innerWidth: canvasWidth, innerHeight: canvasHeight },
    document: { getElementById: () => null },
    console,
  };
  // A fresh context/module state every invocation -- Game/Rng's internal
  // state must never leak between invocations with different seeds/canvas
  // sizes/versions, even on a warm, reused container.
  vm.createContext(sandbox);
  sourceFiles.forEach((src) => vm.runInContext(src, sandbox));

  const result = sandbox.Game.replayRun(seed, inputLog, tickCount);
  // Logged here (inside the replay Lambda itself) as well as by the caller
  // (submit_route in t9_wizard.py, which logs the same score/seed plus the
  // full round-trip invoke() latency) -- this one is scoped to pure
  // replay-compute time, useful for isolating a slow replay from Lambda
  // invocation/cold-start overhead on the caller's side.
  console.log(JSON.stringify({
    event: 'replay_lambda_completed',
    version,
    seed,
    tickCount,
    moveCount: inputLog.length,
    canvasWidth,
    canvasHeight,
    score: result.score,
    mode: result.mode,
    duration_ms: Date.now() - startedAt,
  }));
  return { score: result.score, mode: result.mode, wave: result.wave, lives: result.lives };
};
