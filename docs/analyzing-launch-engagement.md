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
the 1000-point floor," not "conversion past game over."

## The CloudWatch Insights query

Run against the API Lambda's log group, last 7 days:

```
SOURCE "arn:aws:logs:us-east-1:<acct-id>:log-group:/aws/lambda/t9-wizard-api-prod" START=-604800s END=0s |
fields @timestamp, @message
| filter (path='/api/v1/start' and @message like 'run_id') or (path='/api/v1/submit' and @message like 'score')
| sort @timestamp desc
```

Export the results as CSV (Insights console → "Export results" → download,
or copy/paste the results table including the `@timestamp,@message` header
row — the parser below only needs those two columns).

## The script

`ast.literal_eval` on `@message` works directly because it's a real Python
tuple repr: `(request_dict, status_code, response_dict)`.

```python
#!/usr/bin/env python3
"""Parse a CloudWatch Insights export of /start and /submit hits and report
engagement stats."""
import argparse
import ast
import csv
import sys
from collections import defaultdict


def load_rows(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            message = row.get("@message", "").strip()
            if not message:
                continue
            try:
                request, status, response = ast.literal_eval(message)
            except (ValueError, SyntaxError):
                print(f"WARNING: could not parse row, skipping: {message[:120]}", file=sys.stderr)
                continue
            yield {
                "timestamp": row["@timestamp"],
                "path": request.get("path"),
                "ip": request.get("sourceIp"),
                "user_agent": request.get("userAgent"),
                "status": status,
                "response": response,
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="CloudWatch Insights export (CSV) with @timestamp, @message columns")
    parser.add_argument(
        "--exclude-ip", action="append", default=[], metavar="IP",
        help="Source IP to exclude (repeatable) -- use for your own test devices",
    )
    args = parser.parse_args()
    exclude = set(args.exclude_ip)

    rows = [r for r in load_rows(args.csv_path) if r["path"] in ("/api/v1/start", "/api/v1/submit")]
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


if __name__ == "__main__":
    main()
```

Usage: `python3 analyze_launch_logs.py export.csv --exclude-ip <your test
device's IP> [--exclude-ip ...]` — repeat `--exclude-ip` for every IP a known
test device has shown up under (carriers that CGNAT/rotate IPv6 addresses
mean one physical phone can span several IPs across a week; check each
`user_agent` grouping by eye before assuming an IP is or isn't yours).

Notes on the IP-based grouping, since it's an approximation, not ground
truth:
- IPv6 privacy-address rotation and carrier-side dynamic IP reassignment mean
  the same real player returning a day later can show up as a "new" IP —
  repeat-visit counts from this script are a floor, not the true rate.
- A bare device model in the user agent (e.g. "Nokia 2780") is not a unique
  identifier — it's a real, commonly-sold KaiOS phone, so two different real
  owners on the same carrier can be indistinguishable from one device
  changing IPs. When in doubt, don't assume an IP is a duplicate/test device
  without a specific reason to believe so.
