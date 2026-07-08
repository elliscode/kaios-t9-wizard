import traceback

from t9_wizard.logger import log
from t9_wizard.utils import (
    path_equals,
    format_response,
    has_invalid_domain,
    get_request_metadata,
)
from t9_wizard.t9_wizard import start_route, submit_route, leaderboard_route


def lambda_handler(event, context):
    try:
        log(get_request_metadata(event), event.get("headers"))
        result = route(event)
        return result
    except Exception:
        traceback.print_exc()
        return format_response(event=event, http_code=500, body="Internal server error")


def route(event):
    if has_invalid_domain(event=event):
        return format_response(event=event, http_code=403, body={"message": "Forbidden"})
    if path_equals(event=event, method="POST", path="/api/ping"):
        return format_response(event=event, http_code=200, body="pong")
    if path_equals(event=event, method="POST", path="/api/start"):
        return start_route(event)
    if path_equals(event=event, method="POST", path="/api/submit"):
        return submit_route(event)
    if path_equals(event=event, method="GET", path="/api/leaderboard"):
        return leaderboard_route(event)
    return format_response(event=event, http_code=403, body={"message": "Forbidden"})
