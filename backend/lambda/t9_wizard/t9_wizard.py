import secrets

from t9_wizard.utils import format_response, parse_body, create_id, create_game


def start_route(event):
    # 32 bits, matching the frontend's Rng.seed(s) contract exactly (mulberry32
    # uses a 32-bit generator state -- js/rng.js does `state = s >>> 0`).
    run_id = create_id(32)
    seed = secrets.randbits(32)
    create_game(run_id, seed)
    return format_response(event=event, http_code=200, body={"run_id": run_id, "seed": seed})


def submit_route(event):
    # TODO: validate + accept the final run payload (seed, input log, score, tickCount, etc.)
    body = parse_body(event.get("body"))
    return format_response(event=event, http_code=200, body={"message": "not implemented yet"})


def leaderboard_route(event):
    # TODO: query DynamoDB for the top 100 scores and return them
    return format_response(event=event, http_code=200, body={"message": "not implemented yet"})
