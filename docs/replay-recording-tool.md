# Replay recording tool (design notes, not yet built)

**Status:** not implemented. This is a design sketch for a *local* tool — generating a
season-recap video isn't a live product feature, so nothing here needs to ship to the
KaiOS app, the API Lambda, or `s3/`. Revisit when video editing is a more comfortable
skill; the backend half of this (the champion-run record) is already live — see
`save_champion_run`/`get_champion_run` in `backend/lambda/t9_wizard/utils.py`.

## Goal

Turn a season's champion run (currently just seed + timestamped keystrokes) into an
actual video of the run being played, to post on YouTube as a "watch last season's
winner" hook for the next season.

## Data source

`get_champion_run(version)` returns everything needed to deterministically reproduce
the run frame-by-frame:

```python
{
  "run_id": ..., "display_name": ..., "score": ...,
  "seed": ..., "tick_count": ..., "canvas_width": ..., "canvas_height": ...,
  "input_log": [{"tick": 0, "key": "2"}, ...],  # unpacked from the compact binary form
}
```

This is exactly `Game.replayRun`'s signature (`seed, inputLog, tickCount`) plus the
canvas dimensions `layout.js` needs to size the play field identically to how it looked
during the real run. Nothing else is required — no extra recording, no video-specific
data capture at submit time.

Getting this JSON out of DynamoDB locally is a small one-off script using `boto3`
directly against the table (same credentials/access the rest of local dev already
uses) — this is a personal, occasional, local-only tool, so a new authenticated admin
API endpoint isn't worth building just for this; a script that shells out to
`get_champion_run` (or an equivalent raw `get_item` + `unpack_input_log`) and dumps the
result to a JSON file is enough.

## Driving playback

**Key decision: reuse the live app unmodified, rather than building a "replay mode"
into the frontend.** `Game.replayRun` itself is headless (no `ctx`, no rendering) — it
exists purely to compute a final score for verification, not to visually play anything
back. Rather than writing a second, rendering-aware version of that function (a new
frontend feature, more surface area to keep in sync with real gameplay), the simplest
approach is:

1. A Playwright script loads `index.html` completely normally, exactly like this
   session's existing `driveregress-*.js`/`capture-real-run.js` test scripts.
2. Mock `Api.start()` to return the champion run's actual `seed`/`run_id` (same pattern
   already used throughout this session's tests), so the game boots into a real,
   normal, live-rendering session under that exact seed.
3. Instead of a human typing, the script calls `Game.handleDigitKey(key)` for each
   `input_log` entry at the moment matching its `tick` (`tick * TICK_MS` milliseconds
   after the run started, using `page.waitForTimeout`/a polling loop keyed off real
   elapsed time or `Game.__getStateForDebug().tickCount`).
4. The game's own existing `requestAnimationFrame` loop and `Render.renderFrame` do
   all the actual drawing — completely unmodified, so the recording is guaranteed to
   look pixel-identical to what the original player saw (mode transitions, HUD, powerup
   flashes, boss fights, all of it) with zero new frontend code and zero risk of the
   "replay renderer" drifting out of sync with the real one over time.

This means **no changes to `frontend-v3/` are needed at all** — the entire tool lives
outside the shipped app, as a driver script.

## Capturing video

Playwright's built-in video recording is a natural fit, since the driver is already a
Playwright script:

```js
const context = await browser.newContext({
  viewport: { width: 240, height: 320 }, // or whatever canvas_width/canvas_height were
  recordVideo: { dir: 'out/', size: { width: 240, height: 320 } },
});
```

The video file is finalized when the context closes. Combined with the synthetic-input
driver above, this produces a raw `.webm` of the actual run playing out in real time.

## Known limitation: no audio

Playwright's video recording is **video only** — it does not capture the page's Web
Audio output (`AudioEngine`'s SFX). A silent recording of a typing game loses a lot of
its appeal. Options to solve this later, not decided yet:
- Screen-record with system audio via a real OS-level tool (ffmpeg capturing a virtual
  audio device, OBS, etc.) instead of relying on Playwright's recorder — more moving
  parts, but captures real audio.
- Layer sound on in post-production, driven by the same `input_log` (e.g., a separate
  pass logging every `AudioEngine.play(sfx)` call with its tick, then reconstructing an
  audio track offline) — avoids needing real-time OS audio capture, but adds a
  synchronization step.
- Add a simple, non-diegetic soundtrack in the video editor and skip trying to capture
  real SFX at all — simplest, least faithful to the actual run.

## Pacing

A real 60+ minute run produces a 60+ minute video if played back at real time. Worth
deciding later whether to:
- Play back at real speed (most faithful, but very long for a YouTube hook).
- Speed up the tick clock uniformly (e.g. drive input at `tick * (TICK_MS / N)` for
  some speedup factor `N`) — the simulation itself doesn't care about wall-clock time,
  only tick order, so this should work without touching game logic at all.
- Only record a highlight window (e.g. the final boss fight) rather than the whole run.

## Post-processing

The tool's output is raw footage only — trimming, title cards, music, speeding up slow
sections, etc. all happen afterward in whatever video editor is used. Nothing here
tries to solve that part.

## Open questions (unresolved, revisit when building this)

- Where does the generated JSON/video live locally — a scratch script + manual DynamoDB
  pull each season, or something slightly more repeatable?
- Real-time vs. sped-up playback (see Pacing above).
- Audio strategy (see Known limitation above).
- Does `canvas_width`/`canvas_height` ever need overriding for a nicer-looking video
  (the champion's original device dimensions might be an odd/small size like 240x276 —
  worth deciding whether the recording should use those exact dimensions for fidelity,
  or a larger canvas for better YouTube legibility, which would change enemy spawn
  layout since `Rng.next()`-driven positions depend on `canvas_width`).
