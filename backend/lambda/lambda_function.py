import traceback

from t9_wizard.logger import log
from t9_wizard.utils import (
    path_equals,
    format_response,
    has_invalid_domain,
    get_request_metadata,
    extract_version,
    otp_route,
    login_route,
    logged_in_check_route,
)
from t9_wizard.t9_wizard import (
    start_route,
    submit_route,
    leaderboard_route,
    get_pending_names_route,
    approve_name_route,
    deny_name_route,
)


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

    # Admin moderation routes live outside the /api/v<N>/... scheme entirely
    # -- moderating a leaderboard name isn't scoped to one season, so these
    # are checked before version extraction, not per-version like everything
    # else below.
    if path_equals(event=event, method="POST", path="/admin/otp"):
        return otp_route(event)
    if path_equals(event=event, method="POST", path="/admin/login"):
        return login_route(event)
    if path_equals(event=event, method="POST", path="/admin/logged-in-check"):
        return logged_in_check_route(event)
    if path_equals(event=event, method="POST", path="/admin/get-pending-names"):
        return get_pending_names_route(event)
    if path_equals(event=event, method="POST", path="/admin/approve-name"):
        return approve_name_route(event)
    if path_equals(event=event, method="POST", path="/admin/deny-name"):
        return deny_name_route(event)

    # Every remaining endpoint lives under /api/v<N>/... -- a season's
    # frontend build bakes in its own version number and every call it makes
    # carries it, so the whole API surface is naturally partitioned per
    # season. Unknown/unsupported versions (not in KNOWN_VERSIONS) 404
    # uniformly here, before any route-specific logic runs.
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
