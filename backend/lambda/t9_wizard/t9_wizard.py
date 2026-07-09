import json
import secrets

from t9_wizard.utils import (
    format_response,
    parse_body,
    create_id,
    create_game,
    get_game,
    delete_game,
    create_leaderboard_entry,
    get_leaderboard,
    lambda_client,
    REPLAY_LAMBDA_NAME,
)
from t9_wizard.input_validation import validate_schema, SUBMIT_SCHEMA


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

    # The stored seed is used, never anything the client might have sent --
    # there's nothing for a client to spoof if it never gets a say in the
    # seed at all. This Lambda re-simulates the exact frontend game logic
    # for this run's specific version (see backend/lambda-replay) and is the
    # only thing this route trusts.
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

    # The server only trusts what its own replay produced -- never what the
    # client claims happened. A run still in progress (the replay somehow
    # didn't reach a terminal state) doesn't count, but both a real win and
    # a game over are legitimate, submittable outcomes -- a high score
    # reached without clearing all 5 worlds is still a real result worth
    # showing on the leaderboard.
    if replay.get("mode") not in ("win", "gameover"):
        return format_response(event=event, http_code=400, body="Run did not reach a valid end state")

    score = replay["score"]
    create_leaderboard_entry(run_id, validated["display_name"], score, game_version)
    # Deleting the game record makes run_id single-use -- the same run can
    # never be submitted a second time, closing off resubmission-for-a-
    # better-score abuse. Done last so a failed leaderboard write (above)
    # doesn't strand an already-consumed, now-unusable run_id.
    delete_game(run_id)

    return format_response(event=event, http_code=200, body={"score": score})


def leaderboard_route(event, version):
    # Returns each leaderboard item's full raw DynamoDB record as-is (not a
    # curated projection) so new fields/stats can be added later without
    # this endpoint needing to change to expose them. Scoped to this
    # version's own season -- each season has an independent top-100.
    return format_response(event=event, http_code=200, body={"leaderboard": get_leaderboard(version)}, log_this=False)
