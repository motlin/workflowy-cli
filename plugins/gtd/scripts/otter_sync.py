#!/usr/bin/env python3
"""Otter.ai sync with parallel action item fetching using trio.

This script replaces the sequential sync_meetings() function from otter-api.sh
with a parallel implementation using trio for concurrent HTTP requests.

Usage:
    python otter_sync.py [page_size] [cursor] [modified_after]

Environment:
    OTTER_USERNAME - Otter.ai account email (required if no valid session)
    OTTER_PASSWORD - Otter.ai account password (required if no valid session)
    OTTER_VERBOSE=1 - Log timing info to stderr
    OTTER_CONCURRENCY=10 - Max concurrent action item requests (default: 10)

Output: JSON to stdout in the same format as otter-api.sh sync
"""

import http.cookiejar
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import trio

API_BASE = "https://otter.ai/forward/api/v1"
COOKIE_FILE = Path("/tmp/otter-session-cache")
USERID_FILE = Path("/tmp/otter-userid-cache")
CREDS_FILE = Path("/tmp/otter-creds-cache")

VERBOSE = os.environ.get("OTTER_VERBOSE", "")
CONCURRENCY = int(os.environ.get("OTTER_CONCURRENCY", "10"))

START_TIME = time.time()


def log_timing(msg: str) -> None:
    """Log timing message to stderr if VERBOSE is set."""
    if VERBOSE:
        elapsed_ms = int((time.time() - START_TIME) * 1000)
        print(f"[{elapsed_ms}ms] {msg}", file=sys.stderr)


def load_cookies() -> dict[str, str]:
    """Load cookies from Netscape-format cookie file."""
    cookies = {}
    if not COOKIE_FILE.exists():
        return cookies

    with open(COOKIE_FILE, "r") as f:
        for line in f:
            line = line.strip()
            # Skip empty lines and pure comment lines (but not #HttpOnly_ lines)
            if not line:
                continue
            # #HttpOnly_ is a special prefix for HttpOnly cookies in Netscape format
            # Lines starting with just "#" (comment) but not "#HttpOnly_" should be skipped
            if line.startswith("#") and not line.startswith("#HttpOnly_"):
                continue
            # Netscape cookie format:
            # domain\tflag\tpath\tsecure\texpiry\tname\tvalue
            # For HttpOnly cookies, domain is prefixed with #HttpOnly_
            parts = line.split("\t")
            if len(parts) >= 7:
                name = parts[5]
                value = parts[6]
                cookies[name] = value
    return cookies


def cookie_valid() -> bool:
    """Check if cookie file exists and is less than 1 hour old."""
    if not COOKIE_FILE.exists():
        return False
    age = time.time() - COOKIE_FILE.stat().st_mtime
    return age < 3600


def login() -> dict[str, str]:
    """Login to Otter.ai and return cookies.

    Uses cached session if valid, otherwise performs fresh login.
    Returns cookies dict for use with httpx.
    """
    log_timing("login: start")

    if cookie_valid() and USERID_FILE.exists():
        cookies = load_cookies()
        log_timing("login: using cached session")
        return cookies

    # Get credentials
    username = os.environ.get("OTTER_USERNAME", "")
    password = os.environ.get("OTTER_PASSWORD", "")

    # Handle 1Password references
    if username.startswith("op://"):
        if CREDS_FILE.exists():
            log_timing("login: using cached credentials")
            lines = CREDS_FILE.read_text().strip().split("\n")
            username = lines[0]
            password = lines[1]
        else:
            log_timing("login: resolving op:// credentials")
            orig_username = username
            orig_password = password
            username = subprocess.check_output(
                ["op", "read", orig_username], text=True
            ).strip()
            log_timing("login: got username")
            password = subprocess.check_output(
                ["op", "read", orig_password], text=True
            ).strip()
            log_timing("login: got password")
            CREDS_FILE.write_text(f"{username}\n{password}\n")
            CREDS_FILE.chmod(0o600)

    if not username or not password:
        print(
            '{"error": "OTTER_USERNAME and OTTER_PASSWORD must be set"}',
            file=sys.stderr,
        )
        sys.exit(1)

    log_timing("login: calling Otter API")

    # Use curl for login since it handles cookie jar format correctly
    # and httpx doesn't easily write Netscape cookie files
    result = subprocess.run(
        [
            "curl",
            "-s",
            "-w",
            "\n%{http_code}",
            f"{API_BASE}/login?username={username}",
            "-u",
            f"{username}:{password}",
            "-c",
            str(COOKIE_FILE),
        ],
        capture_output=True,
        text=True,
    )

    lines = result.stdout.strip().split("\n")
    http_code = lines[-1]
    body = "\n".join(lines[:-1])

    if http_code != "200":
        print(
            f'{{"error": "Login failed with status {http_code}", "body": {body}}}',
            file=sys.stderr,
        )
        sys.exit(1)

    data = json.loads(body)
    USERID_FILE.write_text(str(data.get("userid", "")))

    log_timing("login: complete")
    return load_cookies()


async def fetch_available_speeches(
    client: httpx.AsyncClient,
    page_size: int,
    cursor: str | None,
    modified_after: str | None,
) -> dict[str, Any]:
    """Fetch available speeches from Otter API."""
    log_timing(
        f"available_speeches: page_size={page_size} cursor={cursor} modified_after={modified_after}"
    )

    params = {
        "page_size": str(page_size),
        "funnel": "home_feed",
        "source": "home",
    }
    if cursor:
        params["last_load_ts"] = cursor
    if modified_after:
        params["modified_after"] = modified_after

    response = await client.get(
        f"{API_BASE}/available_speeches",
        params=params,
        headers={
            "accept": "application/json",
            "referer": "https://otter.ai/all-notes",
        },
    )
    response.raise_for_status()
    log_timing("available_speeches: done")
    return response.json()


async def fetch_action_items(
    client: httpx.AsyncClient,
    otid: str,
    limiter: trio.CapacityLimiter,
) -> tuple[str, list[dict[str, Any]]]:
    """Fetch action items for a single meeting."""
    async with limiter:
        log_timing(f"action_items: fetching {otid}")
        try:
            response = await client.get(
                f"{API_BASE}/speech_action_items",
                params={"otid": otid},
                headers={
                    "accept": "application/json",
                    "referer": f"https://otter.ai/u/{otid}",
                },
            )
            response.raise_for_status()
            data = response.json()
            items = [
                {
                    "text": item.get("text"),
                    "assignee": (item.get("assignee") or {}).get("name"),
                    "completed": item.get("completed"),
                }
                for item in data.get("speech_action_items", [])
            ]
            log_timing(f"action_items: done {otid}")
            return (otid, items)
        except Exception as e:
            log_timing(f"action_items: error {otid}: {e}")
            return (otid, [])


async def sync_meetings_async(
    page_size: int = 50,
    cursor: str | None = None,
    modified_after: str | None = None,
) -> dict[str, Any]:
    """Sync meetings with parallel action item fetching."""
    # When paginating with cursor, modified_after is required by API
    if cursor and not modified_after:
        modified_after = "1"

    log_timing(
        f"sync: starting page_size={page_size} cursor={cursor} modified_after={modified_after}"
    )

    # Login and get cookies
    cookies = login()

    async with httpx.AsyncClient(cookies=cookies, timeout=30.0) as client:
        # Fetch available speeches
        raw_response = await fetch_available_speeches(
            client, page_size, cursor, modified_after
        )

        # Extract pagination info and minimal meeting data
        result = {
            "last_load_ts": raw_response.get("last_load_ts"),
            "end_of_list": raw_response.get("end_of_list"),
            "speeches": [],
        }

        speeches = raw_response.get("speeches") or []
        for speech in speeches:
            outline = []
            for item in speech.get("speech_outline") or []:
                outline.append(
                    {
                        "title": item.get("text"),
                        "segments": [
                            seg.get("text") for seg in (item.get("segments") or [])
                        ],
                    }
                )

            result["speeches"].append(
                {
                    "otid": speech.get("otid"),
                    "title": speech.get("title"),
                    "start_time": speech.get("start_time"),
                    "summary": speech.get("short_abstract_summary"),
                    "action_item_count": speech.get("action_item_count"),
                    "outline": outline,
                }
            )

        # Find meetings that need action items (have summary)
        meetings_needing_actions = [
            s["otid"] for s in result["speeches"] if s.get("summary") is not None
        ]

        if meetings_needing_actions:
            log_timing(
                f"sync: fetching action items for {len(meetings_needing_actions)} meetings"
            )

            # Fetch action items in parallel with concurrency limit
            limiter = trio.CapacityLimiter(CONCURRENCY)
            action_map: dict[str, list[dict[str, Any]]] = {}

            async with trio.open_nursery() as nursery:
                results: list[tuple[str, list[dict[str, Any]]]] = []

                async def fetch_and_store(otid: str) -> None:
                    result_tuple = await fetch_action_items(client, otid, limiter)
                    results.append(result_tuple)

                for otid in meetings_needing_actions:
                    nursery.start_soon(fetch_and_store, otid)

            # Build action map from results
            for otid, items in results:
                action_map[otid] = items

            # Merge action items into result
            for speech in result["speeches"]:
                speech["action_items"] = action_map.get(speech["otid"], [])

    log_timing("sync: done")
    return result


def sync_meetings(
    page_size: int = 50,
    cursor: str | None = None,
    modified_after: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for sync_meetings_async."""
    return trio.run(sync_meetings_async, page_size, cursor, modified_after)


def main() -> None:
    """Main entry point.

    Usage:
        otter_sync.py [page_size] [cursor] [modified_after] [prev_last_synced_otid]

    Args:
        page_size: Items per page (default 50)
        cursor: Pagination cursor (default none)
        modified_after: Timestamp filter (default none)
        prev_last_synced_otid: Stop boundary - meeting we synced last time (optional)
    """
    # Parse command line arguments
    page_size = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    cursor = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    modified_after = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    prev_last_synced_otid = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

    try:
        raw_result = sync_meetings(page_size, cursor, modified_after)

        # Transform speeches to items format for journal dedup compatibility
        items = []
        boundary_found = False
        items_before_boundary = 0

        for speech in raw_result.get("speeches", []):
            otid = speech.get("otid")
            start_time = speech.get("start_time", 0)
            # Convert Unix timestamp to ISO date
            dt = datetime.fromtimestamp(start_time, tz=timezone.utc)

            # Check if we've hit the boundary (previous sync's most recent meeting)
            if prev_last_synced_otid and otid == prev_last_synced_otid:
                boundary_found = True
                log_timing(f"sync: boundary reached at otid={otid} (expected duplicate)")
                # Still process this item to include in results, but we'll stop after

            # Validation: assert all meetings are >= modified_after timestamp
            if modified_after:
                modified_after_ts = int(modified_after)
                if start_time < modified_after_ts:
                    log_timing(f"sync: WARNING - meeting {otid} has start_time={start_time} < modified_after={modified_after_ts}")

            item = {
                "id": f"otter-{otid}",
                "title": speech.get("title", ""),
                "eventDate": dt.strftime("%Y-%m-%d"),
                "eventTime": dt.strftime("%H:%M"),
                "source": "otter",
                "category": "meeting",
                "confidence": "high",
                "metadata": {
                    "meetingId": otid,
                    "participants": "Multiple participants",
                    "summary": speech.get("summary", ""),
                    "actionItemCount": speech.get("action_item_count", 0),
                    "actionItems": speech.get("action_items", []),
                    "outline": speech.get("outline", []),
                }
            }
            items.append(item)

            if not boundary_found:
                items_before_boundary += 1

            # Stop after boundary is found
            if boundary_found:
                break

        # Wrap in metadata structure for journal scanner compatibility
        result = {
            "source": "otter",
            "scannedAt": datetime.now(timezone.utc).isoformat() + "Z",
            "items": items,
            "pagination": {
                "last_load_ts": raw_result.get("last_load_ts"),
                "end_of_list": raw_result.get("end_of_list"),
            },
            "sync_info": {
                "items_before_boundary": items_before_boundary,
                "boundary_found": boundary_found,
                "boundary_otid": prev_last_synced_otid,
            }
        }

        print(json.dumps(result))
    except httpx.HTTPStatusError as e:
        error = {
            "error": f"HTTP {e.response.status_code}: {e.response.reason_phrase}",
            "url": str(e.request.url),
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        error = {"error": str(e)}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
