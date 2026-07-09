import traceback

from t9_wizard.logger import log
from t9_wizard.utils import (
    path_equals,
    format_response,
    has_invalid_domain,
    get_request_metadata,
    extract_version,
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

    # Every endpoint lives under /api/v<N>/... -- a season's frontend build
    # bakes in its own version number and every call it makes carries it, so
    # the whole API surface is naturally partitioned per season. Unknown/
    # unsupported versions (not in KNOWN_VERSIONS) 404 uniformly here, before
    # any route-specific logic runs.
    version = extract_version(event)
    if version is None:
        return format_response(event=event, http_code=403, body={"message": "Forbidden"})

    if path_equals(event=event, method="POST", path=f"/api/v{version}/ping"):
        return format_response(event=event, http_code=200, body="pong")
    if path_equals(event=event, method="POST", path=f"/api/v{version}/start"):
        return start_route(event, version)
    if path_equals(event=event, method="POST", path=f"/api/v{version}/submit"):
        return submit_route(event, version)
    if path_equals(event=event, method="GET", path=f"/api/v{version}/leaderboard"):
        return leaderboard_route(event, version)
    return format_response(event=event, http_code=403, body={"message": "Forbidden"})
