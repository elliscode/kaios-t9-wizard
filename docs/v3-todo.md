# V3 TODO

Fixes to make for season 3. Nothing here is implemented yet. Test these
alongside the other season 3 changes.

## Replay ends one tick short: lives 0 on the client, 1 on the server

**Priority: low / nice to have.** The server workaround (below) already
gets these runs onto the leaderboard with the correct score. Investigate
during season 3 if there's time. If not, keeping the workaround
permanently is fine.

### What we saw

Two players hit the same pattern in `SCORE_MISMATCH` logs:

| Date | Name | Version | Score (client = server) | Wave | Lives (client / server) | Replay mode | tick_count |
|---|---|---|---|---|---|---|---|
| 2026-11-04 | Archelley | 1 | 1453.8 | 4 / 4 | 0 / 1 | `playing` | 5043 |
| 2026-11-12 | SubtoEditscards&more | 2 | 7100.7 | 7 / 7 | 0 / 1 | `playing` | 9153 |

These are the only two real mismatches in 6 months of logs (May–Nov 2026).
The only other entry is a 2026-07-12 dev run from before tick recording
worked, which isn't related. The bug is rare, which fits the theory below:
it needs the app to be killed without the normal pause/save.

The score and wave match exactly. The only difference is that the server's
replay is missing the final hit that ends the run. Before the server
workaround below, these runs were rejected with a 400 ("Run did not reach a
valid end state"). The season 2 player retried 3 times and got rejected
each time.

### Theory (not yet confirmed)

The device ends up one tick ahead of its own `tickCount` after resuming
from a save that was made in the middle of a tick.

- `loop()` in `frontend-v3/js/game.js` calls `update(TICK_MS)` first and
  only then does `state.tickCount += 1`.
- The per-tick save is inside `update()`: `SaveGame.save(state)` at the end
  of `checkCollisions()` (PLAYING) and `checkBossCollision()` (BOSS). It
  runs after the tick's simulation but before `tickCount` goes up. Each of
  these saves holds the state after N updates with `tickCount = N - 1`.
- Saves made outside `update()` (`pauseGame()` on `visibilitychange` and
  manual pause, and the `pagehide` handler) store a matching `tickCount`.
  They overwrite the off-by-one save in the normal close flow.
- If the app is killed with no `visibilitychange` or `pagehide` (task
  killer, crash, low memory or battery on KaiOS), the latest save on disk
  is the off-by-one one. Note that exiting with the END key without
  pausing has been tried and did **not** reproduce the bug. END almost
  certainly fires `visibilitychange`/`pagehide`, which save cleanly. The
  trigger would have to be a harder kill that skips those events. `restoreStateFromSave` loads it, and from then on
  the device's state is one update ahead of its `tickCount`. Key presses
  are recorded one tick earlier than they really happened.
- On the server, `replayRun(seed, inputLog, tickCount)` runs exactly
  `tickCount` updates, which is one fewer than the device actually ran.
  Shifting key presses by one tick almost never changes which words get
  completed, so score and wave still match. But the enemy that took the
  last life is one tick short of reaching the player in the replay. The
  result is lives = 1 and mode = `playing`.
- Each kill-and-resume without a clean save adds another tick of drift, so
  a run could end up 2 or more ticks short.

Things that could also be involved:
- Saves that fail to write (`client_storage_write_failures` /
  `client_storage_last_error` on the `replay_completed` line for these
  runs). Check those values.
- `SaveGame.save` in other per-tick paths (game.js lines ~425/441/673/718/
  821). Check which of these run inside `update()` and have the same
  problem.

### How to confirm

1. Pull the `SCORE_MISMATCH_REPLAY_DATA` line for each run (filter by
   `run_id` in CloudWatch: `VN9ktXeYXpYu7ZjnRb1mkpksu9Ozurts` and
   `LtrQfP4OsQVp6OHAaLZPMZqBHISg4Zie`).
2. Replay it locally with `tools/replayer/replay.js` against the matching
   `vendored/v<N>`, at `tick_count` and then `tick_count + 1` (and +2,
   +3 ...).
3. If `+1` gives `mode: 'gameover'`, `lives: 0` and the same score, the
   theory holds.
4. To reproduce on a device or simulator: play a run, force-kill the app
   mid-wave without pausing, reopen and resume, then die and submit. Check
   whether the replay comes back `playing` with one life left.

### Fix for v3

Make the saved `tickCount` always match the saved state. Options:

- In `loop()` and `replayRun()`, increment `tickCount` **before**
  `update()` (and work out what that means for the tick an input is
  recorded at). This has to change in both places at once or replays break.
- Or leave the order alone and have the saves inside `update()` store
  `tickCount + 1`. This change is smaller and only affects save/resume.
- Either way, add a test: save mid-tick, restore, play to the end, and
  confirm `replayRun` gives the same mode, lives and score.

### Server workaround already in place (seasons 1 and 2)

`submit_route` in `backend/lambda/t9_wizard/t9_wizard.py` now accepts a run
whose replay didn't reach `win` or `gameover` **if** `client_score` matches
the replayed score (within `SCORE_MISMATCH_THRESHOLD`). It logs these as
`ACCEPTED_UNFINISHED_REPLAY`. The leaderboard still only records the
server's replayed score, so this can't inflate a score. Once v3 is fixed,
decide whether to keep accepting these runs for v3 or require a real end
state again. Watch `ACCEPTED_UNFINISHED_REPLAY` for v3 runs; there should
be none.

Also consider renaming the `SCORE_MISMATCH` event to something like
`REPLAY_STATE_MISMATCH`, since it also fires when only lives or wave
differ. Any CloudWatch metric filter or alarm that matches the old name
would need the same rename.
