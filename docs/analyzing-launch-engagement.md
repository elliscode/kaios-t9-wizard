# Analyzing launch engagement from CloudWatch logs

A repeatable way to answer "are people actually playing this" from the API
Lambda's access logs, without needing any new instrumentation. Point Claude at
this file with a fresh CloudWatch export and ask it to run the analysis.

This analysis intentionally reuses existing operational CloudWatch logs rather than introducing additional client-side telemetry or persistent identifiers. The generated report is intended for one-time analysis and is not stored after use.

## Background: what this measures, and its one big blind spot

Every `/api/v1/start` and `/api/v1/submit` call is logged with the source IP,
user agent, and (for `/submit`) the resulting score (see
`backend/lambda/t9_wizard/t9_wizard.py`'s route handlers and `logger.py`'s
`log()`, which prints a Python tuple repr — that's why the query below filters
on `@message like`, not a JSON field). That's enough to see how many sessions
started vs. how many runs got submitted, and whether the same people are
coming back.

**The blind spot:** `frontend-v3/js/game.js` sets
`MIN_SUBMITTABLE_SCORE = 1000` — a run scoring under 1000 never even offers
"press 1 to submit," so the client never calls `/submit` at all. These logs
cannot distinguish "nobody is finishing a run" from "people are finishing runs
that just don't clear 1000 points." A low start→submit conversion rate is
not, by itself, evidence the game is too hard — treat it as "conversion past
the 1000-point floor," not "conversion past game over." The `replay_completed`
event below fires from the same `/submit` call, so it inherits this exact
blind spot too — it does not see anything below the 1000-point floor either.

The query also pulls in `replay_completed` events: `submit_route` in
`backend/lambda/t9_wizard/t9_wizard.py` logs one of these for *every* replay
outcome behind a `/submit` call, including ones the server goes on to reject
(run didn't reach a valid end state). That makes it possible to split "total
/submit calls" into accepted vs. rejected, and to see per-run `mode`
(`win`/`gameover`), `replay_duration_ms`, and `client_storage_write_failures` —
none of which are visible from the plain `/submit` request/response log line
alone. Unlike the `/start`/`/submit` lines, this event is logged via a bare
`log({...})` call rather than through `format_response`, so it has no `path`
and no source IP — it can't be joined into the per-IP breakdown below.

## The CloudWatch Insights query

Run against the API Lambda's log group, last 7 days:

```
SOURCE "arn:aws:logs:us-east-1:646933935516:log-group:/aws/lambda/t9-wizard-api-prod" START=-604800s END=0s |
fields @timestamp, @message
| filter (path='/api/v1/start' and @message like 'run_id') or (path='/api/v1/submit' and @message like 'score') or (event="replay_completed")
| sort @timestamp desc
| limit 10000
```

Export the results as CSV or JSON (Insights console → "Export results" →
download; the parser below accepts either).

## The script

`ast.literal_eval` on `@message` works directly because it's a real Python
repr, but the two log sources don't share a shape: `/start`/`/submit` log a
`(request_dict, status_code, response_dict)` tuple via `format_response`,
while `replay_completed` logs a bare dict via a direct `log({...})` call —
`logger.py`'s `log(*content)` still wraps that single dict in a 1-element
tuple, so it shows up as `({...},)`, not the 3-tuple. The parser below
branches on shape to tell them apart. `replay_completed`'s dict also carries
`display_name` — the name the player typed in on their own device, not an
authenticated identity (see the caveat in Notes below).

```python
#!/usr/bin/env python3
"""Parse a CloudWatch Insights export (CSV or JSON) of /start, /submit, and
replay_completed hits and report engagement stats."""
import argparse
import ast
import csv
import json
import sys
from collections import defaultdict


def load_rows(path):
    with open(path, newline="") as f:
        first_char = f.read(1)
        f.seek(0)
        entries = json.load(f) if first_char == "[" else csv.DictReader(f)
        for row in entries:
            message = row.get("@message", "").strip()
            if not message:
                continue
            try:
                parsed = ast.literal_eval(message)
            except (ValueError, SyntaxError):
                print(f"WARNING: could not parse row, skipping: {message[:120]}", file=sys.stderr)
                continue
            if len(parsed) == 3 and isinstance(parsed[0], dict) and "path" in parsed[0]:
                request, status, response = parsed
                yield {
                    "kind": "http",
                    "timestamp": row["@timestamp"],
                    "path": request.get("path"),
                    "ip": request.get("sourceIp"),
                    "user_agent": request.get("userAgent"),
                    "status": status,
                    "response": response,
                }
            elif len(parsed) == 1 and isinstance(parsed[0], dict) and "event" in parsed[0]:
                yield {"kind": "event", "timestamp": row["@timestamp"], **parsed[0]}
            else:
                print(f"WARNING: unrecognized row shape, skipping: {message[:120]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_path", help="CloudWatch Insights export (CSV or JSON) with @timestamp, @message")
    parser.add_argument(
        "--exclude-ip", action="append", default=[], metavar="IP",
        help="Source IP to exclude (repeatable) -- use for your own test devices",
    )
    parser.add_argument(
        "--exclude-name", action="append", default=[], metavar="NAME",
        help="display_name to exclude from the replay_completed breakdown (repeatable) -- use for your own test/admin names",
    )
    args = parser.parse_args()
    exclude = set(args.exclude_ip)
    exclude_names = set(args.exclude_name)

    all_rows = list(load_rows(args.export_path))
    rows = [r for r in all_rows if r["kind"] == "http" and r["path"] in ("/api/v1/start", "/api/v1/submit")]
    replays = [r for r in all_rows if r["kind"] == "event" and r.get("event") == "replay_completed"]
    starts = [r for r in rows if r["path"] == "/api/v1/start"]
    submits = [r for r in rows if r["path"] == "/api/v1/submit"]

    print(f"Total /start: {len(starts)}")
    print(f"Total /submit: {len(submits)}")
    print(f"Naive conversion rate: {len(submits) / len(starts) * 100:.1f}%" if starts else "n/a")
    print()

    by_ip = defaultdict(lambda: {"starts": 0, "submits": 0, "ua": set(), "times": []})
    for r in rows:
        if r["ip"] in exclude:
            continue
        d = by_ip[r["ip"]]
        d["ua"].add(r["user_agent"])
        d["times"].append(r["timestamp"])
        d["starts" if r["path"] == "/api/v1/start" else "submits"] += 1

    total_hits = sum(d["starts"] + d["submits"] for d in by_ip.values())
    repeat = {ip: d for ip, d in by_ip.items() if d["starts"] + d["submits"] > 1}

    print(f"Distinct non-excluded IPs: {len(by_ip)}")
    print(f"Total hits from non-excluded IPs: {total_hits}")
    print(f"IPs with >1 hit (repeat visits): {len(repeat)} ({len(repeat) / len(by_ip) * 100:.0f}% of distinct IPs)"
          if by_ip else "")
    print()

    print("=== per-IP summary, sorted by hits desc (excludes --exclude-ip) ===")
    for ip, d in sorted(by_ip.items(), key=lambda kv: -(kv[1]["starts"] + kv[1]["submits"])):
        hits = d["starts"] + d["submits"]
        span = f"{d['times'][-1]} -> {d['times'][0]}" if hits > 1 else d["times"][0]
        print(f"{hits:>3} hits ({d['starts']}s/{d['submits']}sub)  {ip:45s} {'/'.join(d['ua'])[:40]:40s} {span}")
    print()

    print("=== replay_completed breakdown (every replay outcome behind a /submit call) ===")
    print(f"Total replay_completed events: {len(replays)}")
    if replays:
        accepted = [r for r in replays if r.get("mode") in ("win", "gameover")]
        rejected = [r for r in replays if r.get("mode") not in ("win", "gameover")]
        wins = [r for r in replays if r.get("mode") == "win"]
        print(f"Accepted (mode=win/gameover): {len(accepted)}")
        print(f"Rejected (invalid end state): {len(rejected)}")
        if accepted:
            print(f"Wins among accepted: {len(wins)} ({len(wins) / len(accepted) * 100:.1f}%)")
        durations = [r["replay_duration_ms"] for r in replays if isinstance(r.get("replay_duration_ms"), (int, float))]
        if durations:
            print(f"Replay duration (ms): avg {sum(durations) / len(durations):.0f}, max {max(durations)}")
        storage_failures = [r for r in replays if r.get("client_storage_write_failures")]
        if storage_failures:
            print(f"Runs with nonzero client_storage_write_failures: {len(storage_failures)}")
    print()

    by_name = defaultdict(lambda: {"count": 0, "scores": [], "times": []})
    for r in replays:
        name = r.get("display_name")
        if name in exclude_names:
            continue
        d = by_name[name]
        d["count"] += 1
        if isinstance(r.get("score"), (int, float)):
            d["scores"].append(r["score"])
        d["times"].append(r["timestamp"])

    repeat_names = {n: d for n, d in by_name.items() if d["count"] > 1}
    print("=== display_name breakdown (from replay_completed events, excludes --exclude-name) ===")
    print(f"Distinct display names: {len(by_name)}")
    print(f"Names used >1 time: {len(repeat_names)} ({len(repeat_names) / len(by_name) * 100:.0f}% of distinct names)"
          if by_name else "")
    print()
    for name, d in sorted(by_name.items(), key=lambda kv: -kv[1]["count"]):
        avg_score = sum(d["scores"]) / len(d["scores"]) if d["scores"] else 0
        span = f"{d['times'][-1]} -> {d['times'][0]}" if d["count"] > 1 else d["times"][0]
        print(f"{d['count']:>3}x  {str(name):20s} avg score {avg_score:8.1f}  {span}")


if __name__ == "__main__":
    main()
```

Usage: `python3 analyze_launch_logs.py export.csv-or-.json --exclude-ip <your
test device's IP> [--exclude-ip ...] --exclude-name <your test display name>
[--exclude-name ...]` — repeat `--exclude-ip` for every IP a known test
device has shown up under (carriers that CGNAT/rotate IPv6 addresses mean one
physical phone can span several IPs across a week; check each `user_agent`
grouping by eye before assuming an IP is or isn't yours), and `--exclude-name`
for every display name your own test/admin runs used (see `ADMIN_DISPLAY_NAMES`
in `backend/lambda/t9_wizard/utils.py`). `replay_completed` rows have no
source IP, so `--exclude-ip` has no effect on the replay_completed or
display_name breakdowns — they always cover every replay, test devices
included, unless filtered out by name instead.

Notes on the IP- and name-based grouping, since both are approximations, not
ground truth:
- IPv6 privacy-address rotation and carrier-side dynamic IP reassignment mean
  the same real player returning a day later can show up as a "new" IP —
  repeat-visit counts from this script are a floor, not the true rate.
- A bare device model in the user agent (e.g. "Nokia 2780") is not a unique
  identifier — it's a real, commonly-sold KaiOS phone, so two different real
  owners on the same carrier can be indistinguishable from one device
  changing IPs. When in doubt, don't assume an IP is a duplicate/test device
  without a specific reason to believe so.
- `display_name` is whatever the player typed on their own device, entirely
  unauthenticated and unvalidated beyond whatever `SUBMIT_SCHEMA` enforces
  (see `backend/lambda/t9_wizard/input_validation.py`) — it is not a stable
  per-player identifier. Two different players can pick the same name (common
  defaults, copying the current leaderboard leader, etc.), and the same real
  player can submit under a different name on their next run. Treat the
  display_name breakdown as a rough signal of name reuse and possible repeat
  players, not a headcount.
