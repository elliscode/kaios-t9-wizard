import json
import secrets
import time

from t9_wizard.logger import log
from t9_wizard.utils import (
    format_response,
    parse_body,
    create_id,
    create_game,
    get_game,
    delete_game,
    create_leaderboard_entry,
    create_leaderboard_log,
    get_leaderboard,
    LEADERBOARD_LIMIT_DEFAULT,
    lambda_client,
    REPLAY_LAMBDA_NAME,
    authenticate,
    get_pending_names,
    approve_pending_name,
    deny_pending_name,
    EXPECTED_CANVAS_WIDTHS,
    EXPECTED_CANVAS_HEIGHTS,
)
from t9_wizard.input_validation import validate_schema, SUBMIT_SCHEMA, MODERATE_NAME_SCHEMA

# Anything bigger than ordinary floating-point noise between two independent
# computations of the same scoring formula -- see the SCORE_MISMATCH log in
# submit_route.
SCORE_MISMATCH_THRESHOLD = 1


def start_route(event, version):
    # 32 bits, matching the frontend's Rng.seed(s) contract exactly (mulberry32
    # uses a 32-bit generator state -- js/rng.js does `state = s >>> 0`).
    run_id = create_id(32)
    seed = secrets.randbits(32)
    create_game(run_id, seed, version)
    return format_response(event=event, http_code=200, body={"run_id": run_id, "seed": seed})


def submit_route(event, version):
    body = parse_body(event.get("body"))
    validated = validate_schema(body, SUBMIT_SCHEMA)
    if validated is None:
        return format_response(event=event, http_code=400, body="Invalid request body")

    run_id = validated["run_id"]
    game = get_game(run_id)
    if game is None:
        return format_response(event=event, http_code=404, body="Run not found or expired")

    # The URL's version is only ever a hint -- the game record's own stored
    # version (set once, at /start, and never trusted from the client again)
    # is what actually gets used for replay below. This check just gives a
    # clear error if a client submits to the wrong versioned URL, rather
    # than silently replaying under different rules than the client expects.
    game_version = int(game["version"])
    if game_version != version:
        return format_response(event=event, http_code=400, body="Run does not belong to this API version")

    # An empty allowlist (the env var unset) means this check is off --
    # see EXPECTED_CANVAS_WIDTHS/EXPECTED_CANVAS_HEIGHTS in utils.py.
    if EXPECTED_CANVAS_WIDTHS and validated["canvas_width"] not in EXPECTED_CANVAS_WIDTHS:
        return format_response(event=event, http_code=400, body="Invalid canvas_width")
    if EXPECTED_CANVAS_HEIGHTS and validated["canvas_height"] not in EXPECTED_CANVAS_HEIGHTS:
        return format_response(event=event, http_code=400, body="Invalid canvas_height")

    # The stored seed is used, never anything the client might have sent --
    # there's nothing for a client to spoof if it never gets a say in the
    # seed at all. This Lambda re-simulates the exact frontend game logic
    # for this run's specific version (see backend/lambda-replay) and is the
    # only thing this route trusts.
    replay_started_at = time.time()
    invoke_result = lambda_client.invoke(
        FunctionName=REPLAY_LAMBDA_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(
            {
                # dynamo_obj_to_python_obj deserializes DynamoDB Number
                # attributes as Decimal, not int -- json.dumps can't encode
                # that directly.
                "seed": int(game["seed"]),
                "version": game_version,
                "inputLog": validated["input_log"],
                "tickCount": validated["tick_count"],
                "canvasWidth": validated["canvas_width"],
                "canvasHeight": validated["canvas_height"],
            }
        ).encode(),
    )
    if invoke_result.get("FunctionError"):
        return format_response(event=event, http_code=400, body="Invalid input_log")

    replay = json.loads(invoke_result["Payload"].read())
    # Logged for every replay outcome (not just accepted ones) -- useful for
    # spotting slow or suspicious replays even when they get rejected below.
    # client_storage_write_failures/last_error ride along unconditionally
    # (not gated behind a mismatch) -- a nonzero count here with an otherwise
    # clean score/wave/lives match is exactly how we'd confirm the
    # retry-until-durable fix in game.js's chunk-flush block actually
    # recovered from a real failure, without needing to reproduce one live.
    log(
        {
            "event": "replay_completed",
            "run_id": run_id,
            "seed": int(game["seed"]),
            "version": game_version,
            "display_name": validated["display_name"],
            "tick_count": validated["tick_count"],
            "move_count": len(validated["input_log"]),
            "score": replay.get("score"),
            "mode": replay.get("mode"),
            "replay_duration_ms": int((time.time() - replay_started_at) * 1000),
            "client_storage_write_failures": validated.get("client_storage_write_failures"),
            "client_storage_last_error": validated.get("client_storage_last_error"),
        }
    )

    # client_score/wave/lives are never trusted for scoring (the leaderboard
    # always uses replay["score"] below, regardless of any of this) -- they
    # exist purely to catch a divergence between what the player's device
    # actually computed and what the server's independent replay computed,
    # whether from a tampered client or a legitimate bug (this is how the
    # two save/resume bugs fixed earlier this session were confirmed).
    # Absent on an old, not-yet-updated client -- see
    # validate_non_negative_number's "optional" field in input_validation.py.
    client_score = validated.get("client_score")
    client_wave = validated.get("client_wave")
    client_lives = validated.get("client_lives")
    server_score = replay.get("score")
    server_wave = replay.get("wave")
    server_lives = replay.get("lives")

    score_diff = None
    if client_score is not None and server_score is not None:
        score_diff = abs(server_score - client_score)
    score_mismatch = score_diff is not None and score_diff > SCORE_MISMATCH_THRESHOLD
    # wave/lives are exact simulated-state values (not an accumulated float),
    # so any difference at all -- unlike score's noise threshold -- means the
    # replay's game state genuinely diverged from what the client played,
    # independent of whatever the scoring formula did with it.
    wave_mismatch = client_wave is not None and server_wave is not None and client_wave != server_wave
    lives_mismatch = client_lives is not None and server_lives is not None and client_lives != server_lives

    if score_mismatch or wave_mismatch or lives_mismatch:
        # A deliberately separate, distinctively-named log call (not
        # folded into replay_completed above) so a CloudWatch metric
        # filter can target just this line without matching every
        # ordinary submission. logger.py's log() prints a Python tuple's
        # repr(), not valid JSON -- the filter pattern must be a plain
        # term match on "SCORE_MISMATCH", not a JSON-structured pattern.
        log(
            {
                "event": "SCORE_MISMATCH",
                "run_id": run_id,
                "seed": int(game["seed"]),
                "version": game_version,
                "display_name": validated["display_name"],
                "client_score": client_score,
                "server_score": server_score,
                "score_diff": score_diff,
                "client_wave": client_wave,
                "server_wave": server_wave,
                "client_lives": client_lives,
                "server_lives": server_lives,
                "tick_count": validated["tick_count"],
                "move_count": len(validated["input_log"]),
                "mode": replay.get("mode"),
            }
        )
        # A second, distinctively-named log line carrying everything needed
        # to replay this exact run offline (locally, against vendored/v<N>)
        # and bisect the input_log to find the first tick where a live
        # session and a from-scratch replay actually part ways -- without
        # this, a mismatch is only ever visible in aggregate (the fields
        # above), never directly reproducible. Kept separate from
        # SCORE_MISMATCH itself so a metric filter/alarm on that line never
        # has to parse a payload this size (input_log alone was ~35KB on the
        # run that prompted this).
        log(
            {
                "event": "SCORE_MISMATCH_REPLAY_DATA",
                "run_id": run_id,
                "seed": int(game["seed"]),
                "version": game_version,
                "tick_count": validated["tick_count"],
                "canvas_width": validated["canvas_width"],
                "canvas_height": validated["canvas_height"],
                "input_log": validated["input_log"],
            }
        )

    # The server only trusts what its own replay produced -- never what the
    # client claims happened. A run still in progress (the replay somehow
    # didn't reach a terminal state) doesn't count, but both a real win and
    # a game over are legitimate, submittable outcomes -- a high score
    # reached without clearing all 5 worlds is still a real result worth
    # showing on the leaderboard.
    if replay.get("mode") not in ("win", "gameover"):
        return format_response(event=event, http_code=400, body="Run did not reach a valid end state")

    score = replay["score"]
    leaderboard_entry = create_leaderboard_entry(run_id, validated["display_name"], score, game_version)
    # Writes the companion replay-log row (see create_leaderboard_log) under
    # the same key2 as the public entry above, on a separate partition
    # (leaderboard#v<N>#log) get_leaderboard never queries. Never allowed to
    # break submission -- a DynamoDB hiccup here shouldn't cost a legitimate
    # player their score, same "nice to have" treatment as SaveGame/
    # AudioEngine elsewhere in this codebase.
    try:
        create_leaderboard_log(
            run_id=run_id,
            version=game_version,
            key2=leaderboard_entry["key2"],
            seed=int(game["seed"]),
            input_log=validated["input_log"],
            tick_count=validated["tick_count"],
            canvas_width=validated["canvas_width"],
            canvas_height=validated["canvas_height"],
        )
    except Exception as e:
        log({"event": "create_leaderboard_log_failed", "run_id": run_id, "version": game_version, "error": str(e)})
    # Deleting the game record makes run_id single-use -- the same run can
    # never be submitted a second time, closing off resubmission-for-a-
    # better-score abuse. Done last so a failed leaderboard write (above)
    # doesn't strand an already-consumed, now-unusable run_id.
    delete_game(run_id)

    return format_response(event=event, http_code=200, body={"score": score})


def leaderboard_route(event, version):
    # get_leaderboard's Query only ever targets key1=f"leaderboard#v<N>" --
    # the public, display_name/score-only partition. Each entry's full replay
    # data (seed/input_log_packed/etc., for a future replay-serving feature)
    # lives on a sibling item under key1=f"leaderboard#v<N>#log" instead,
    # which this route never queries -- so there's nothing to leak to the
    # client, and DynamoDB never even reads those heavier items for this
    # request (a ProjectionExpression on a single combined item wouldn't
    # achieve that -- DynamoDB bills by item size read, not by what's
    # actually returned). Scoped to this version's own season -- each season
    # has an independent top-N.
    # ?limit= lets a caller ask for more than the in-game screen's default
    # (see s3/leaderboard.html, which requests the full top 500) -- clamped
    # server-side in get_leaderboard, so this never needs to validate it.
    params = event.get("queryStringParameters") or {}
    try:
        limit = int(params["limit"]) if params.get("limit") else LEADERBOARD_LIMIT_DEFAULT
    except ValueError:
        limit = LEADERBOARD_LIMIT_DEFAULT
    return format_response(
        event=event, http_code=200, body={"leaderboard": get_leaderboard(version, limit)}, log_this=False
    )


# --- Admin: leaderboard name moderation -------------------------------------
# Not version-scoped like the routes above -- a pending display name isn't
# tied to one season, and an admin moderating names shouldn't have to check
# every version separately. See create_pending_name/approve_pending_name/
# deny_pending_name in utils.py for the actual queue mechanics.


@authenticate
def get_pending_names_route(event, admin_phone, body):
    return format_response(event=event, http_code=200, body={"pending": get_pending_names()}, log_this=False)


@authenticate
def approve_name_route(event, admin_phone, body):
    validated = validate_schema(body, MODERATE_NAME_SCHEMA)
    if validated is None:
        return format_response(event=event, http_code=400, body="Invalid request body")
    if not approve_pending_name(validated["run_id"]):
        return format_response(event=event, http_code=404, body="Pending name not found")
    return format_response(event=event, http_code=200, body="Name approved")


@authenticate
def deny_name_route(event, admin_phone, body):
    validated = validate_schema(body, MODERATE_NAME_SCHEMA)
    if validated is None:
        return format_response(event=event, http_code=400, body="Invalid request body")
    if not deny_pending_name(validated["run_id"]):
        return format_response(event=event, http_code=404, body="Pending name not found")
    return format_response(event=event, http_code=200, body="Name denied and removed from the leaderboard")
