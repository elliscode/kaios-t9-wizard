import json
import re
import secrets
import struct
import os
import time
from decimal import Decimal
from urllib.parse import parse_qsl

import boto3

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from .logger import log

APP_NAME = os.environ.get("APP_NAME")
DOMAIN_NAMES = os.environ.get("DOMAIN_NAMES", "").split(",")
TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME")
REPLAY_LAMBDA_NAME = os.environ.get("REPLAY_LAMBDA_NAME")
# Seasonal API versioning -- adding/retiring a version is an env var edit +
# redeploy, no code change. See extract_version and the replay Lambda's own
# version-keyed vendored/v<N>/ snapshots (backend/lambda-replay/index.js).
KNOWN_VERSIONS = {int(v) for v in os.environ.get("KNOWN_VERSIONS", "").split(",") if v}
# The real screen dimensions a legitimate KaiOS device can report (see
# submit_route) -- an allowlist, not a formula, since it's cheaper to just
# list the handful of real values than to compute/guess at them. Left unset
# (empty) means "don't enforce this" -- lets the check go live only once the
# real values are known/confirmed, and can be widened later (a new device
# with a different screen) purely via an env var edit, no code change.
EXPECTED_CANVAS_WIDTHS = {int(v) for v in os.environ.get("EXPECTED_CANVAS_WIDTHS", "").split(",") if v}
EXPECTED_CANVAS_HEIGHTS = {int(v) for v in os.environ.get("EXPECTED_CANVAS_HEIGHTS", "").split(",") if v}
# Admin moderation login (see login_route/otp_route) -- a single hardcoded
# phone number, not a general user system, since there's only ever one
# legitimate admin. SMS is sent through an already-deployed, project-agnostic
# SQS-triggered Twilio Lambda (github.com-style sibling project
# aws-lambda-twilio) -- this queue URL points at that *same* existing queue,
# no new queue/consumer needed.
ADMIN_PHONE = os.environ.get("ADMIN_PHONE")
SMS_SQS_QUEUE_URL = os.environ.get("SMS_SQS_QUEUE_URL")
ADMIN_COOKIE_NAME = "t9wizard-admin-token"
# Must match the custom domain admin.html actually calls (api.t9-wizard.
# elliscode.com) -- a Set-Cookie response can only set a Domain that
# domain-matches the host that sent it, so this has to track wherever the
# admin API is actually served from, not just any elliscode.com subdomain.
ADMIN_COOKIE_DOMAIN = ".t9-wizard.elliscode.com"

digits = "0123456789"
lowercase_letters = "abcdefghijklmnopqrstuvwxyz"
uppercase_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# A run must be submitted within this window of starting to count toward the
# leaderboard -- see create_game/RUN_EXPIRATION_SECONDS usage in start_route.
RUN_EXPIRATION_SECONDS = 7 * 24 * 60 * 60

dynamo = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")
sqs = boto3.client("sqs")


def has_invalid_domain(event):
    return "origin" not in event["headers"] or event["headers"]["origin"].rstrip("/") not in DOMAIN_NAMES


def get_event_path(event):
    req_ctx = event.get("requestContext") or {}
    event_path = event.get("path")
    if not event_path:
        http_ctx = req_ctx.get("http") or {}
        event_path = http_ctx.get("path", "")
        stage = req_ctx.get("stage", "")
        event_path = event_path.removeprefix(f"/{stage}")
    return event_path


def get_request_metadata(event):
    try:
        req_ctx = event.get("requestContext") or {}
        http_ctx = req_ctx.get("http") or {}
        identity = req_ctx.get("identity") or {}
        return {
            "path": get_event_path(event),
            "origin": (event.get("headers") or {}).get("origin"),
            "sourceIp": identity.get("sourceIp") or http_ctx.get("sourceIp"),
            "userAgent": identity.get("userAgent") or http_ctx.get("userAgent"),
        }
    except Exception:
        return {}


def format_response(event, http_code, body, headers=None, log_this=True):
    metadata = get_request_metadata(event)
    if isinstance(body, str):
        body = {"message": body}
    if "origin" in event["headers"] and event["headers"]["origin"].rstrip("/") in DOMAIN_NAMES:
        domain_name = event["headers"]["origin"]
    else:
        log(metadata, f'Invalid origin {event["headers"].get("origin")}')
        http_code = 403
        body = {"message": "Forbidden"}
        domain_name = "*"
    all_headers = {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Origin": domain_name,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Credentials": "true",
        # Without this, admin.html's fetch() can't read the x-csrf-token
        # header off the login response -- browsers hide non-simple response
        # headers cross-origin unless the server explicitly exposes them.
        "Access-Control-Expose-Headers": "x-csrf-token",
    }
    if headers is not None:
        all_headers.update(headers)
    if log_this:
        log(metadata, http_code, body)
    else:
        log(metadata, http_code)
    return {
        "statusCode": http_code,
        "body": json.dumps(body),
        "headers": all_headers,
    }


def parse_body(body):
    if body is None:
        return {}
    if isinstance(body, dict):
        return body
    elif body.startswith("{"):
        return json.loads(body)
    return dict(parse_qsl(body))


def dynamo_obj_to_python_obj(dynamo_obj: dict) -> dict:
    deserializer = TypeDeserializer()
    return {k: deserializer.deserialize(v) for k, v in dynamo_obj.items()}


def decimal_to_number(value):
    # dynamo_obj_to_python_obj deserializes every DynamoDB Number as Decimal,
    # which json.dumps can't encode -- convert back to a plain int/float
    # right before a value is going out over the wire.
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def python_obj_to_dynamo_obj(python_obj: dict) -> dict:
    serializer = TypeSerializer()
    return {k: serializer.serialize(v) for k, v in python_obj.items()}


def path_equals(event, method, path):
    event_path = get_event_path(event)
    event_method = event.get("httpMethod", event.get("requestContext", {}).get("http", {}).get("method"))
    return event_method == method and (event_path == path or event_path == path + "/" or path == "*")


VERSION_PATH_PATTERN = re.compile(r"^/api/v(\d+)/")


def extract_version(event):
    match = VERSION_PATH_PATTERN.match(get_event_path(event))
    if not match:
        return None
    version = int(match.group(1))
    return version if version in KNOWN_VERSIONS else None


def create_id(length):
    return "".join(secrets.choice(digits + lowercase_letters + uppercase_letters) for i in range(length))


def create_game(run_id, seed, version):
    python_data = {
        "key1": "game",
        "key2": run_id,
        "seed": seed,
        # The source of truth for which vendored/v<N>/ ruleset submit_route
        # replays this run against later -- never re-derived from the URL a
        # client happens to submit to. key1/key2 stay unscoped by version:
        # game records are only ever looked up by exact run_id, never
        # queried by version, so there's nothing to gain from partitioning
        # them (unlike leaderboard entries, which are).
        "version": version,
        "expiration": int(time.time()) + RUN_EXPIRATION_SECONDS,
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    return python_data


def get_game(run_id):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "game", "key2": run_id}),
        TableName=TABLE_NAME,
    )
    if "Item" not in result:
        return None
    game = dynamo_obj_to_python_obj(result["Item"])
    # DynamoDB's TTL deletion is background/eventually-consistent (can take
    # up to 48h) -- don't rely on the item having actually been removed yet.
    if game["expiration"] < int(time.time()):
        return None
    return game


def delete_game(run_id):
    dynamo.delete_item(
        Key=python_obj_to_dynamo_obj({"key1": "game", "key2": run_id}),
        TableName=TABLE_NAME,
    )


LEADERBOARD_SCORE_SCALE = 100  # 2 decimal places of precision in the sort key
LEADERBOARD_KEY2_OFFSET = 10**12  # comfortably above any realistic scaled score


def create_leaderboard_entry(run_id, display_name, score, version):
    # key1 is scoped per version, shared by every leaderboard entry within
    # that version, so a single Query (sorted by key2, the table's native
    # sort key) returns just that season's entries in score order with no
    # GSI/scan needed -- each season gets its own independent top-100, since
    # scores from different rulesets aren't really comparable. key2 is an
    # inverted, zero-padded score so ascending key2 order is descending
    # score -- run_id is appended only to guarantee uniqueness if two runs'
    # scores happen to be identical.
    scaled_score = round(score * LEADERBOARD_SCORE_SCALE)
    key2 = f"{LEADERBOARD_KEY2_OFFSET - scaled_score:013d}#{run_id}"
    # The score goes live immediately, but display_name is free-text and
    # public -- rather than delaying the whole entry behind manual review,
    # it posts under an anonymous placeholder right away and the *real*
    # submitted name sits in a separate moderation queue (see
    # create_pending_name/approve_pending_name/deny_pending_name) until an
    # admin approves it. The real name is never written onto this record at
    # all, so there's nothing here that could accidentally leak to a client
    # before it's been reviewed.
    # A name with a prior decision (see get_name_decision) skips that queue
    # entirely: previously approved posts the real name immediately;
    # previously denied still posts (a rejected *name* isn't a reason to
    # wipe an otherwise-legitimate score) but permanently under the
    # placeholder, since deny_pending_name never promotes it later.
    decision = get_name_decision(display_name)
    python_data = {
        "key1": f"leaderboard#v{version}",
        "key2": key2,
        "display_name": display_name if decision is True else f"Player {secrets.randbelow(10000)}",
        # DynamoDB's TypeSerializer rejects native float outright ("use
        # Decimal instead") -- str(score) first avoids binary-float
        # imprecision artifacts that Decimal(score) directly would carry in.
        "score": Decimal(str(score)),
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    if decision is None:
        create_pending_name(run_id, display_name, python_data["key1"], key2, version, score)
    return python_data


LEADERBOARD_LIMIT_DEFAULT = 10  # matches LEADERBOARD_ROWS in frontend-v3/js/render.js --
# the in-game screen's default, unaffected by callers that ask for more
LEADERBOARD_LIMIT_MAX = 500  # matches s3/leaderboard.html's "full leaderboard" request


def get_leaderboard(version, limit=LEADERBOARD_LIMIT_DEFAULT):
    # key2 is stored inverted (see create_leaderboard_entry), so ascending
    # key2 order -- the table's native sort, ScanIndexForward's default --
    # already is descending score order. No GSI, no scan, no explicit sort.
    result = dynamo.query(
        TableName=TABLE_NAME,
        KeyConditionExpression="#key1 = :key1",
        ExpressionAttributeNames={"#key1": "key1"},
        ExpressionAttributeValues=python_obj_to_dynamo_obj({":key1": f"leaderboard#v{version}"}),
        Limit=min(max(1, limit), LEADERBOARD_LIMIT_MAX),
    )
    return [
        {k: decimal_to_number(v) for k, v in dynamo_obj_to_python_obj(item).items()} for item in result.get("Items", [])
    ]


# --- Leaderboard replay-log companion records -------------------------------
# One record per submitted run holding the full seed/input_log/tickCount/
# canvas dimensions -- everything Game.replayRun needs to deterministically
# regenerate that run frame-by-frame later (for a future replay-serving
# endpoint, not built yet). Deliberately NOT stored on the public leaderboard
# entry itself (score + display_name only) -- key1 is
# f"leaderboard#v<N>#log", a different partition from f"leaderboard#v<N>", so
# get_leaderboard's Query (which only ever asks for the latter) never reads
# these items at all, not even to discard them. key2 matches the paired
# leaderboard entry's key2 exactly, so the two rows address as a pair.

# {tick: uint32, key: uint8} per entry, little-endian -- packed instead of
# storing input_log as-is because raw JSON runs surprisingly large (a real
# ~60-minute run's input_log was measured at ~235KB as JSON; this format cuts
# that to ~48KB, well clear of DynamoDB's 400KB hard per-item limit). A
# uint32 tick comfortably covers any realistic run length (a 60-minute run
# is ~110K ticks); T9 digits ('2'-'9') fit trivially in a uint8.
INPUT_LOG_ENTRY_FORMAT = "<IB"


def pack_input_log(input_log):
    return b"".join(struct.pack(INPUT_LOG_ENTRY_FORMAT, entry["tick"], ord(entry["key"])) for entry in input_log)


def unpack_input_log(packed):
    entry_size = struct.calcsize(INPUT_LOG_ENTRY_FORMAT)
    entries = []
    for offset in range(0, len(packed), entry_size):
        tick, key_code = struct.unpack_from(INPUT_LOG_ENTRY_FORMAT, packed, offset)
        entries.append({"tick": tick, "key": chr(key_code)})
    return entries


def create_leaderboard_log(run_id, version, key2, seed, input_log, tick_count, canvas_width, canvas_height):
    python_data = {
        "key1": f"leaderboard#v{version}#log",
        "key2": key2,
        "run_id": run_id,
        "seed": seed,
        "tick_count": tick_count,
        "canvas_width": canvas_width,
        "canvas_height": canvas_height,
        "move_count": len(input_log),
        "input_log_packed": pack_input_log(input_log),
        "submitted_at": int(time.time()),
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    return python_data


# --- Leaderboard name moderation queue -------------------------------------
# A separate record type (key1="unreviewed_name"), not a flag mutated on the
# public leaderboard item -- mirrors the same "unreviewed_X -> approve/deny"
# shape used for blog comment moderation elsewhere (a sibling project, not
# this repo). Keeping it a separate record means get_pending_names is a
# single Query on one partition key, never a full-table Scan, and it's
# naturally cross-version (moderation isn't scoped to one season the way
# leaderboard entries are).
def create_pending_name(run_id, real_name, leaderboard_key1, leaderboard_key2, version, score):
    python_data = {
        "key1": "unreviewed_name",
        "key2": run_id,
        "real_name": real_name,
        # The exact composite key of the public entry this pairs with, so
        # approve/deny can address it directly without recomputing the
        # inverted-score key2 encoding.
        "leaderboard_key1": leaderboard_key1,
        "leaderboard_key2": leaderboard_key2,
        "version": version,
        # Duplicated from the leaderboard entry purely so the admin UI can
        # show it during review without a second lookup -- not the source of
        # truth (the leaderboard entry is), never written back anywhere.
        "score": Decimal(str(score)),
        "submitted_at": int(time.time()),
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    return python_data


def get_pending_names():
    result = dynamo.query(
        TableName=TABLE_NAME,
        KeyConditionExpression="#key1 = :key1",
        ExpressionAttributeNames={"#key1": "key1"},
        ExpressionAttributeValues=python_obj_to_dynamo_obj({":key1": "unreviewed_name"}),
        ScanIndexForward=True,  # oldest first
    )
    # decimal_to_number: same reason as get_leaderboard -- score comes back
    # as Decimal, which json.dumps can't encode directly.
    return [
        {k: decimal_to_number(v) for k, v in dynamo_obj_to_python_obj(item).items()} for item in result.get("Items", [])
    ]


def _get_pending_name(run_id):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "unreviewed_name", "key2": run_id}),
        TableName=TABLE_NAME,
    )
    if "Item" not in result:
        return None
    return dynamo_obj_to_python_obj(result["Item"])


def approve_pending_name(run_id):
    pending = _get_pending_name(run_id)
    if pending is None:
        return False
    dynamo.update_item(
        TableName=TABLE_NAME,
        Key=python_obj_to_dynamo_obj({"key1": pending["leaderboard_key1"], "key2": pending["leaderboard_key2"]}),
        UpdateExpression="SET display_name = :name",
        ExpressionAttributeValues=python_obj_to_dynamo_obj({":name": pending["real_name"]}),
    )
    dynamo.delete_item(
        Key=python_obj_to_dynamo_obj({"key1": "unreviewed_name", "key2": run_id}),
        TableName=TABLE_NAME,
    )
    record_name_decision(pending["real_name"], True)
    return True


def deny_pending_name(run_id):
    # Deliberately does NOT delete the leaderboard entry -- a rejected name
    # isn't grounds to wipe an otherwise-legitimate score. It just stays
    # under its placeholder forever (create_leaderboard_entry never promotes
    # it, since this records a permanent False decision for the name below).
    pending = _get_pending_name(run_id)
    if pending is None:
        return False
    dynamo.delete_item(
        Key=python_obj_to_dynamo_obj({"key1": "unreviewed_name", "key2": run_id}),
        TableName=TABLE_NAME,
    )
    record_name_decision(pending["real_name"], False)
    return True


# A combined whitelist/blacklist of names an admin has already ruled on --
# case-sensitive and deliberately *not* normalized, e.g. approving
# "Finn Pulcik" must not silently auto-approve "Finn pUlCiK" (a
# capitalization trick to sneak a variant past review). validate_display_name
# (input_validation.py) already strips leading/trailing whitespace before a
# name ever reaches here, so there's nothing left to normalize.
def record_name_decision(name, approved):
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(
            {
                "key1": "name_decision",
                "key2": name,
                "approved": approved,
                "decided_at": int(time.time()),
            }
        ),
    )


def get_name_decision(name):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "name_decision", "key2": name}),
        TableName=TABLE_NAME,
    )
    if "Item" not in result:
        return None  # never decided before -- goes through moderation as usual
    return dynamo_obj_to_python_obj(result["Item"])["approved"]


# --- Admin login (phone OTP + cookie session) -------------------------------
# Ported from a sibling project's blog-comment-admin login (not part of this
# repo) -- same OTP/session/CSRF mechanics, adapted for a single hardcoded
# admin rather than a general registered-user system: there's only ever one
# legitimate admin, so the identity check is a direct equality test instead
# of a DynamoDB user lookup, and no "user" records are ever written at all.
def get_admin_identity(phone):
    return phone if phone == ADMIN_PHONE else None


def get_cookies(event):
    # HTTP API (v2) puts cookies in a native top-level array; REST API (v1)
    # doesn't, and the Cookie header has to be split by hand instead. Handles
    # either shape rather than assuming one.
    if "cookies" in event:
        return event["cookies"]
    header = (event.get("headers") or {}).get("cookie") or (event.get("headers") or {}).get("Cookie")
    if not header:
        return []
    return [c.strip() for c in header.split(";")]


def find_cookie(cookies):
    for cookie in cookies:
        parts = cookie.split("=")
        cookie_name = parts[0].strip(" ;")
        if cookie_name == ADMIN_COOKIE_NAME:
            return parts[1].strip(" ;")
    return None


def create_otp(phone, otp_value):
    python_data = {
        "key1": "otp",
        "key2": phone,
        "otp": otp_value,
        "expiration": int(time.time()) + (5 * 60),
        "last_failure": 0,
    }
    dynamo.put_item(TableName=TABLE_NAME, Item=python_obj_to_dynamo_obj(python_data))
    return python_data


def set_otp(phone, python_data):
    dynamo.put_item(TableName=TABLE_NAME, Item=python_obj_to_dynamo_obj(python_data))
    return python_data


def get_otp(phone):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "otp", "key2": phone}),
        TableName=TABLE_NAME,
    )
    if "Item" not in result:
        return None
    return dynamo_obj_to_python_obj(result["Item"])


def delete_otp(phone):
    dynamo.delete_item(
        Key=python_obj_to_dynamo_obj({"key1": "otp", "key2": phone}),
        TableName=TABLE_NAME,
    )


def create_token(phone):
    python_data = {
        "key1": "token",
        "key2": create_id(32),
        "csrf": create_id(32),
        "user": phone,
        "expiration": int(time.time()) + (4 * 30 * 24 * 60 * 60),
    }
    dynamo.put_item(TableName=TABLE_NAME, Item=python_obj_to_dynamo_obj(python_data))
    return python_data


def get_token(token_string):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "token", "key2": token_string}),
        TableName=TABLE_NAME,
    )
    if "Item" not in result:
        return None
    return dynamo_obj_to_python_obj(result["Item"])


def delete_token(token_id):
    dynamo.delete_item(
        Key=python_obj_to_dynamo_obj({"key1": "token", "key2": token_id}),
        TableName=TABLE_NAME,
    )


def get_active_tokens(phone):
    result = dynamo.get_item(
        Key=python_obj_to_dynamo_obj({"key1": "active_tokens", "key2": phone}),
        TableName=TABLE_NAME,
    )
    if "Item" in result:
        active_tokens = dynamo_obj_to_python_obj(result["Item"])
        active_tokens["tokens"] = {k: v for k, v in active_tokens["tokens"].items() if v > int(time.time())}
    else:
        active_tokens = {"key1": "active_tokens", "key2": phone, "tokens": {}}
    return active_tokens


def track_token(token_data):
    active_tokens = get_active_tokens(token_data["user"])
    active_tokens["tokens"][token_data["key2"]] = token_data["expiration"]
    dynamo.put_item(TableName=TABLE_NAME, Item=python_obj_to_dynamo_obj(active_tokens))


# Wraps an admin-only route: validates the session cookie + CSRF token
# before calling through. The wrapped function receives (event, admin_phone,
# body) -- admin_phone is always ADMIN_PHONE here (the only identity that
# can ever reach this point), passed through rather than hardcoded again so
# call sites don't need to import ADMIN_PHONE separately.
def authenticate(func):
    def wrapper_func(*args, **kwargs):
        event = args[0]
        cookie = find_cookie(get_cookies(event))
        body = parse_body(event.get("body"))
        csrf_token = body.get("csrf")
        token_data = get_token(cookie) if cookie else None
        if token_data is None or token_data["expiration"] < int(time.time()):
            return format_response(event=event, http_code=403, body="Your session has expired, please log in")
        active_tokens = get_active_tokens(token_data["user"])
        if token_data["key2"] not in active_tokens["tokens"]:
            return format_response(event=event, http_code=403, body="Your session has expired, please log in")
        if csrf_token is None or token_data["csrf"] != csrf_token:
            # token_data["key2"] is this session's own id -- not key1, which
            # is just the literal record-type string "token" and would
            # delete the wrong (nonexistent) item.
            delete_token(token_data["key2"])
            return format_response(event=event, http_code=403, body="Your CSRF token is invalid, please log in again")
        return func(event, token_data["user"], body)

    return wrapper_func


def otp_route(event):
    body = parse_body(event.get("body"))
    phone = str(body.get("phone", ""))
    if not re.match(r"^\d{10}$", phone):
        return format_response(event=event, http_code=400, body="Invalid phone number, must be a 10 digit US number")

    if get_admin_identity(phone) is None:
        return format_response(event=event, http_code=401, body="You are not permitted to log in")

    otp_data = get_otp(phone)
    if otp_data is None or otp_data["expiration"] < int(time.time()):
        otp_value = "".join(secrets.choice(digits) for _ in range(6))
        otp_data = create_otp(phone, otp_value)
        message = {
            "phone": f"+1{phone}",
            "message": f"{otp_data['otp']} is your T9 Wizard admin one-time passcode",
        }
        sqs.send_message(QueueUrl=SMS_SQS_QUEUE_URL, MessageBody=json.dumps(message))
        return format_response(event=event, http_code=200, body="OTP sent")
    return format_response(event=event, http_code=200, body="OTP already sent, please check your messages")


def login_route(event):
    body = parse_body(event.get("body"))
    phone = str(body.get("phone", ""))
    submitted_otp = body.get("otp")

    if get_admin_identity(phone) is None:
        return format_response(event=event, http_code=401, body="You are not permitted to log in")

    otp_data = get_otp(phone)
    if otp_data is None or otp_data["expiration"] < int(time.time()):
        return format_response(event=event, http_code=400, body="OTP expired, please try again")
    diff = otp_data["last_failure"] + 30 - int(time.time())
    if diff > 0:
        return format_response(event=event, http_code=403, body=f"Please wait {diff} seconds before trying again")
    if submitted_otp != otp_data["otp"]:
        otp_data["last_failure"] = int(time.time())
        set_otp(phone, otp_data)
        return format_response(event=event, http_code=403, body="Incorrect OTP, please try again")

    delete_otp(phone)
    token_data = create_token(phone)
    track_token(token_data)
    date_string = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(time.time() + (4 * 30 * 24 * 60 * 60)))
    return format_response(
        event=event,
        http_code=200,
        body="successfully logged in",
        headers={
            "x-csrf-token": token_data["csrf"],
            "Set-Cookie": f"{ADMIN_COOKIE_NAME}={token_data['key2']}; Domain={ADMIN_COOKIE_DOMAIN}; "
            f"Expires={date_string}; Secure; HttpOnly",
        },
    )


@authenticate
def logged_in_check_route(event, admin_phone, body):
    return format_response(event=event, http_code=200, body="You are logged in")
