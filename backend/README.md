# setup

There are two Lambda functions: the public-facing API (`lambda/`, Python) and a
private score-verification Lambda (`lambda-replay/`, Node.js) that the API
Lambda invokes directly — it's never exposed via API Gateway.

Every endpoint lives under a `/api/v<N>/...` path — see "versioning" below.

## API Lambda (`lambda/`)

1. create a lambda (Python 3.14 runtime)
2. set the following environment variables on the lambda:
   - `APP_NAME` — app identifier, used in logging
   - `DOMAIN_NAMES` — comma-separated list of allowed CORS origins
   - `DYNAMODB_TABLE_NAME` — name of the DynamoDB table this backend reads/writes
   - `REPLAY_LAMBDA_NAME` — function name of the replay Lambda (see below)
   - `KNOWN_VERSIONS` — comma-separated list of API version numbers currently
     accepted, e.g. `1,2` (see "versioning" below)
3. grant this lambda's execution role `lambda:InvokeFunction` on the replay lambda's ARN
4. run the `sh dev-release.sh` (or `sh prod-release.sh`) script
5. set up an API gateway with an ANY method with proxy integration and set your lambda as the target of the lambda integration

## Replay Lambda (`lambda-replay/`)

Verifies a submitted run by re-simulating it with the actual frontend game
logic, so there's never a second, hand-maintained implementation of the game
rules to keep in sync. Not reachable from the internet; only the API lambda
calls it.

1. create a lambda (Node.js runtime)
2. no environment variables needed
3. before releasing for the first time, cut at least one version (see
   "versioning" below): `cd lambda-replay && sh cut-version.sh 1`
4. run `sh dev-release.sh` (or `sh prod-release.sh`)

# releasing

`lambda/`: run `sh dev-release.sh` for the dev lambda, or `sh prod-release.sh` for prod.

`lambda-replay/`: same, from within `lambda-replay/` — ships whatever's
already under `vendored/` (every version cut so far). Does **not**
auto-vendor the current `frontend-v3/js/` state; that's `cut-version.sh`'s
job, and it's a deliberate, separate step (see "versioning").

# versioning

Every ~3 months a new "season" ships gameplay changes to `frontend-v3/js/`
(new powerups, scoring tweaks, etc.). Each frontend build talks to a matching,
frozen backend ruleset via its own `/api/v<N>/...` path, forever — a v1
client's runs must always verify against v1's exact game logic, even after
v2/v3 have shipped and `frontend-v3/js/` has moved on.

**Cutting a new season:**
1. Make the gameplay changes in `frontend-v3/js/`.
2. `cd lambda-replay && sh cut-version.sh <N>` — freezes the current state
   into `lambda-replay/vendored/v<N>/`. **Refuses to overwrite** an
   already-cut version (pass `--force` if you're certain — e.g. fixing a
   mistake before anyone's played that version yet).
3. `sh dev-release.sh` / `sh prod-release.sh` (in `lambda-replay/`) — ships
   the updated `vendored/` tree (every version, not just the new one) to the
   replay Lambda.
4. Add `<N>` to the API Lambda's `KNOWN_VERSIONS` env var, redeploy the API
   Lambda too if any Python code changed.
5. Ship the new frontend build, pointing at `/api/v<N>/...`.

**Important**: `lambda-replay/vendored/v*/` directories are committed to git,
*not* gitignored — unlike a regular build artifact, these are permanent,
irreplaceable historical snapshots that verification depends on forever.
Never hand-edit an already-cut version's files directly.

A version is either fully known (works for `start`/`submit`/`leaderboard`) or
fully unknown (404s everywhere) — there's no "only the latest version can
start new games" restriction; every version in `KNOWN_VERSIONS` keeps
accepting new runs indefinitely. Each version's leaderboard is independent
(separate top-100 per season — see `create_leaderboard_entry`'s
version-scoped `key1`).

# endpoints

All under `/api/v<N>/...`, where `<N>` must be in the API Lambda's
`KNOWN_VERSIONS` (otherwise every path 404s, checked once in `route()` before
any endpoint-specific logic runs):

- `POST /api/v<N>/ping` — health check, returns "pong"
- `POST /api/v<N>/start` — issues a random seed + `run_id` for a new run,
  stored in DynamoDB (tagged with version `<N>`) with a 7-day expiration
- `POST /api/v<N>/submit` — accepts a finished run (`run_id`, `display_name`,
  `tick_count`, `canvas_width`, `canvas_height`, `input_log`), re-simulates it
  via the replay lambda using the *stored* seed and version (never anything
  client-supplied), and only records a leaderboard entry if the replay itself
  reaches a win *or* a game over — either is a legitimate, verified terminal
  state. 400s if the run's stored version doesn't match `<N>`.
  `run_id` is single-use — deleted from DynamoDB immediately after a
  successful submission.
- `GET /api/v<N>/leaderboard` — returns the top 100 leaderboard entries for
  version `<N>`'s season, sorted by score descending (a single `Query`, no
  scan/GSI — see `key2`'s inverted-score encoding in
  `create_leaderboard_entry`). Each entry is the full raw DynamoDB record,
  not a curated projection, so new fields can be added later without
  changing this endpoint.
