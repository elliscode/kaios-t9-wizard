import json
import re
import secrets
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

digits = "0123456789"
lowercase_letters = "abcdefghijklmnopqrstuvwxyz"
uppercase_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# A run must be submitted within this window of starting to count toward the
# leaderboard -- see create_game/RUN_EXPIRATION_SECONDS usage in start_route.
RUN_EXPIRATION_SECONDS = 7 * 24 * 60 * 60

dynamo = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")


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
    python_data = {
        "key1": f"leaderboard#v{version}",
        "key2": key2,
        "run_id": run_id,
        "display_name": display_name,
        # DynamoDB's TypeSerializer rejects native float outright ("use
        # Decimal instead") -- str(score) first avoids binary-float
        # imprecision artifacts that Decimal(score) directly would carry in.
        "score": Decimal(str(score)),
        "submitted_at": int(time.time()),
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    return python_data


LEADERBOARD_LIMIT = 10  # matches LEADERBOARD_ROWS in frontend-v3/js/render.js -- no point
# fetching more than the screen ever actually shows


def get_leaderboard(version):
    # key2 is stored inverted (see create_leaderboard_entry), so ascending
    # key2 order -- the table's native sort, ScanIndexForward's default --
    # already is descending score order. No GSI, no scan, no explicit sort.
    result = dynamo.query(
        TableName=TABLE_NAME,
        KeyConditionExpression="#key1 = :key1",
        ExpressionAttributeNames={"#key1": "key1"},
        ExpressionAttributeValues=python_obj_to_dynamo_obj({":key1": f"leaderboard#v{version}"}),
        Limit=LEADERBOARD_LIMIT,
    )
    return [
        {k: decimal_to_number(v) for k, v in dynamo_obj_to_python_obj(item).items()} for item in result.get("Items", [])
    ]
