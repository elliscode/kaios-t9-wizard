import re

ID_REGEX = "^[a-zA-Z0-9]{32}$"  # matches create_id(32), e.g. a run_id
DISPLAY_NAME_MAX_LENGTH = 20
STORAGE_ERROR_MAX_LENGTH = 200
T9_DIGITS = set("23456789")


def validate_unix_time(value):
    if isinstance(value, str) and value.isnumeric():
        return value
    elif isinstance(value, int):
        return str(value)
    return None


def validate_id(value):
    if isinstance(value, str) and re.match(ID_REGEX, value):
        return value
    return None


def validate_display_name(value):
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed or len(trimmed) > DISPLAY_NAME_MAX_LENGTH:
        return None
    return trimmed


def validate_t9_digit(value):
    if isinstance(value, str) and value in T9_DIGITS:
        return value
    return None


# Diagnostic-only free text (a caught JS Error's name+message, see save.js's
# recordStorageFailure) -- never displayed or matched against anything, just
# length-capped so a single field can't blow up log line size.
def validate_error_string(value):
    if not isinstance(value, str):
        return None
    return value[:STORAGE_ERROR_MAX_LENGTH]


# int(value)/float(value) raise on non-numeric input instead of returning
# None like every other validator here -- using bare `int` as a schema field
# type would let a malformed request crash the handler with an uncaught
# ValueError (500) instead of a clean 400, so numeric fields go through this
# instead.
def validate_non_negative_int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    return None


# Scores are float-valued (unlike tick_count/canvas dimensions) -- same
# bool-exclusion guard as validate_non_negative_int, since bool is a
# subclass of int in Python.
def validate_non_negative_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return value
    return None


def validate_schema(value, schema):
    if schema["type"] == list or schema["type"] == dict:
        if not isinstance(value, schema["type"]):
            return None
        if schema["type"] == list:
            output = []
            for value_item in value:
                result = validate_schema(value_item, schema["elements"])
                if not result:
                    return None
                output.append(result)
            return output
        if schema["type"] == dict:
            output = {}
            for field in schema["fields"]:
                if "name" not in field:
                    for key, val in value.items():
                        result = validate_schema(val, field["elements"])
                        if not result:
                            return None
                        output[key] = result
                elif field["name"] not in value and not field.get("optional"):
                    return None
                elif field["name"] in value:
                    result = validate_schema(value[field["name"]], field)
                    if result is None:
                        return None
                    output[field["name"]] = result
            return output
    elif callable(schema["type"]):
        result = schema["type"].__call__(value)
        if result is not None:
            return result
        return None
    return None


SUBMIT_SCHEMA = {
    "type": dict,
    "fields": [
        {"type": validate_id, "name": "run_id"},
        {"type": validate_display_name, "name": "display_name"},
        {"type": validate_non_negative_int, "name": "tick_count"},
        {"type": validate_non_negative_int, "name": "canvas_width"},
        {"type": validate_non_negative_int, "name": "canvas_height"},
        # Optional -- an already-installed, not-yet-updated client (this is
        # a KaiOS app; store distribution lags a backend deploy) won't send
        # this at all. validate_schema's optional handling already treats a
        # genuinely-absent field as fine, no error.
        {"type": validate_non_negative_number, "name": "client_score", "optional": True},
        # Same "old client, field just absent" story as client_score above.
        {"type": validate_non_negative_int, "name": "client_wave", "optional": True},
        {"type": validate_non_negative_int, "name": "client_lives", "optional": True},
        {"type": validate_non_negative_int, "name": "client_storage_write_failures", "optional": True},
        {"type": validate_error_string, "name": "client_storage_last_error", "optional": True},
        {
            "type": list,
            "name": "input_log",
            "elements": {
                "type": dict,
                "fields": [
                    {"type": validate_non_negative_int, "name": "tick"},
                    {"type": validate_t9_digit, "name": "key"},
                ],
            },
        },
    ],
}

# Admin moderation actions (see approve_name_route/deny_name_route) -- both
# just need to identify which pending queue entry to act on.
MODERATE_NAME_SCHEMA = {
    "type": dict,
    "fields": [
        {"type": validate_id, "name": "run_id"},
    ],
}
