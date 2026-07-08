from t9_wizard.utils import format_response, parse_body


def start_route(event):
    # TODO: generate a seed + game_id, write to DynamoDB with a 7-day expiration
    return format_response(event=event, http_code=200, body={"message": "not implemented yet"})


def submit_route(event):
    # TODO: validate + accept the final run payload (seed, input log, score, tickCount, etc.)
    body = parse_body(event.get("body"))
    return format_response(event=event, http_code=200, body={"message": "not implemented yet"})


def leaderboard_route(event):
    # TODO: query DynamoDB for the top 100 scores and return them
    return format_response(event=event, http_code=200, body={"message": "not implemented yet"})
