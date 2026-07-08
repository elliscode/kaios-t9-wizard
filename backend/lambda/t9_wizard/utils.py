import json
import secrets
import os
import time
from urllib.parse import parse_qsl

import boto3

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from .logger import log

APP_NAME = os.environ.get("APP_NAME")
DOMAIN_NAMES = os.environ.get("DOMAIN_NAMES", "").split(",")
TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME")

digits = "0123456789"
lowercase_letters = "abcdefghijklmnopqrstuvwxyz"
uppercase_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# A run must be submitted within this window of starting to count toward the
# leaderboard -- see create_game/RUN_EXPIRATION_SECONDS usage in start_route.
RUN_EXPIRATION_SECONDS = 7 * 24 * 60 * 60

dynamo = boto3.client("dynamodb")


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


def python_obj_to_dynamo_obj(python_obj: dict) -> dict:
    serializer = TypeSerializer()
    return {k: serializer.serialize(v) for k, v in python_obj.items()}


def path_equals(event, method, path):
    event_path = get_event_path(event)
    event_method = event.get("httpMethod", event.get("requestContext", {}).get("http", {}).get("method"))
    return event_method == method and (event_path == path or event_path == path + "/" or path == "*")


def create_id(length):
    return "".join(secrets.choice(digits + lowercase_letters + uppercase_letters) for i in range(length))


def create_game(run_id, seed):
    python_data = {
        "key1": "game",
        "key2": run_id,
        "seed": seed,
        "expiration": int(time.time()) + RUN_EXPIRATION_SECONDS,
    }
    dynamo.put_item(
        TableName=TABLE_NAME,
        Item=python_obj_to_dynamo_obj(python_data),
    )
    return python_data
