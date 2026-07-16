# T9 Wizard replay viewer (local-only)

An interactive, on-screen viewer for a recorded run's `input_log` — play it
back at normal speed, pause, fast-forward, and scrub to any point, like a
video. Runs entirely locally; never touches the real API or the shipped app.

Not to be confused with `docs/replay-recording-tool.md` (a separate, still
unbuilt design sketch for exporting a season-recap *video*) — this tool is
for watching a run interactively on your own screen, though it's built on
the same core idea: drive the real, unmodified game with the real seed and
the real keystrokes, instead of building a second rendering path.

## Usage

```sh
cd tools/replayer
npm install
npx playwright install chromium   # first time only
node replay.js runs/example.json  # or omit the path to use runs/example.json
```

A browser window opens with the game on the right (240x294, exactly as
played) and playback controls on the left. Press **Play**, drag the
scrubber, change speed, watch the T9 keypad light up in sync with the run.

## Run JSON format

```json
{
  "version": 1,
  "seed": 2271276322,
  "canvas_width": 240,
  "canvas_height": 294,
  "tick_count": 20119,
  "input_log_packed": "sQAAADS0AAAA..."
}
```

- `version` selects which frozen game-logic snapshot to load, from
  `backend/lambda-replay/vendored/v<version>/`.
- `input_log_packed` is the base64 form of the same binary format
  `backend/lambda/t9_wizard/utils.py`'s `pack_input_log`/`unpack_input_log`
  use for the `input_log_packed` DynamoDB attribute (`get_champion_run`
  returns this shape, just already unpacked) — copy it as-is from wherever
  you pulled it (e.g. the DynamoDB console's JSON view of a `champion` item,
  which base64-encodes Binary attributes automatically).
- Alternatively, set `input_log` directly to a plain `[{"tick": 0, "key":
  "2"}, ...]` array instead of `input_log_packed` — useful if you already
  have it unpacked (e.g. from a future DynamoDB-puller script mirroring
  `get_champion_run`'s return shape; not built by this tool).

`runs/example.json` is a synthetic fixture (not a real recorded run) for a
quick smoke test of the pipeline itself — replace it with a real run's data
to actually watch something.

## How it works, briefly

- `Api.start()` is stubbed to resolve with the run's own seed instead of
  hitting the real backend, so `Game.beginRun()` boots a normal, live,
  actually-rendering session under that exact seed — no changes to
  `frontend-v3/` or the vendored replay engine.
- The game loads inside an iframe fixed at exactly 240x294
  (`game-frame.html`) so `layout.js`'s `window.innerWidth`/`innerHeight`
  read stays pinned to the original resolution regardless of how large the
  outer window (controls + keypad) is — this matters because enemy spawn
  positions are `Rng.next()`-driven off canvas width, so a differently-sized
  canvas would desync the whole run's layout from the original.
- `player.js` overrides `window.requestAnimationFrame` inside that iframe so
  it controls exactly when each simulated tick advances (instead of the
  browser's native ~60fps clock), and wraps `Render.renderFrame` to observe
  live state — this is what makes pause/fast-forward/seek possible without
  any changes to the game's own code.
- A tiny local static file server (`replay.js`) serves the whole repo root
  over `http://127.0.0.1` so the outer page and the game iframe are
  same-origin (reliable direct JS access between them) — `file://` was
  avoided on purpose, since cross-frame scripting under `file://` is
  unreliable across browsers/versions.

## Known limitations

- **Backward seeks are not free.** There's no incremental/resumable replay
  API (confirmed against `Game.replayRun`), so scrubbing to an earlier tick
  reloads the game frame from scratch (same seed) and re-simulates forward
  to the target tick with rendering suppressed. This is fast relative to
  real-time playback but not instant — expect a visible "Seeking…" pause,
  worse the further back you scrub on a long run.
- **`input_log` must be sorted by `tick` ascending** (true of every real
  recorded run) — the dispatch logic assumes this.
- This only replays `version`s that have actually been cut via
  `cut-version.sh` into `backend/lambda-replay/vendored/`.
