#!/bin/bash
# Otter.ai API wrapper - fetches meetings with authentication
#
# Requires environment variables:
#   OTTER_USERNAME - Otter.ai account email
#   OTTER_PASSWORD - Otter.ai account password
#
# Usage:
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh warm-credentials  # resolve op:// creds into the cache (run in the foreground)
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh available_speeches [page_size] [cursor] [modified_after]
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh sync-since <last_synced_otid> [page_size]  # new meetings only, with action items
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh sync [page_size] [cursor] [modified_after]  # one page, with action items
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh speech <otid>
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh summary <otid>
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh action_items <otid>
#
# Environment:
#   OTTER_VERBOSE=1  - Log full request/response details to stderr
#   OTTER_TIMING=1   - Log timing info to stderr
#   OTTER_MAX_PAGES  - sync-since page cap before failing (default 20)
#
# Output: JSON to stdout

set -euo pipefail

API_BASE="https://otter.ai/forward/api/v1"
# Cache lives outside /tmp: reads there trigger Claude Code permission prompts,
# and this directory holds resolved credentials.
OTTER_CACHE_DIR="${OTTER_CACHE_DIR:-${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}/.llm/otter}"
mkdir -p "$OTTER_CACHE_DIR"
chmod 700 "$OTTER_CACHE_DIR"
COOKIE_FILE="$OTTER_CACHE_DIR/otter-session-cache"
USERID_FILE="$OTTER_CACHE_DIR/otter-userid-cache"
CREDS_FILE="$OTTER_CACHE_DIR/otter-creds-cache"

TIMING="${OTTER_TIMING:-}"
VERBOSE="${OTTER_VERBOSE:-}"

get_ms() {
    if command -v gdate &>/dev/null; then
        gdate +%s%3N
    elif [[ "$(uname)" == "Darwin" ]]; then
        perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'
    else
        date +%s%3N
    fi
}

START_TIME=$(get_ms)

log_timing() {
    if [[ -n "$TIMING" ]]; then
        local now=$(get_ms)
        local elapsed=$((now - START_TIME))
        echo "[${elapsed}ms] $1" >&2
    fi
}

log_verbose() {
    if [[ -n "$VERBOSE" ]]; then
        echo "$1" >&2
    fi
}

# Verbose curl wrapper
curl_verbose() {
    local method="$1"
    local url="$2"
    shift 2
    local extra_args=("$@")

    log_verbose "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_verbose "REQUEST:"
    log_verbose "  Method: $method"
    log_verbose "  URL: $url"

    # Build curl command
    local curl_args=(-s -w '\n{"http_code":"%{http_code}","time_total":"%{time_total}"}')
    curl_args+=(-X "$method")

    for arg in "${extra_args[@]}"; do
        if [[ "$arg" == -H* ]] || [[ "$arg" == -b* ]] || [[ "$arg" == -c* ]] || [[ "$arg" == -u* ]]; then
            curl_args+=("$arg")
            # Log headers (but mask auth)
            if [[ "$arg" == -H ]]; then
                : # next arg is the header value
            elif [[ "${extra_args[*]}" == *"-H"* ]]; then
                :
            fi
        else
            curl_args+=("$arg")
        fi
    done

    log_verbose "  Cookie file: $COOKIE_FILE"
    if [[ -f "$COOKIE_FILE" ]] && [[ -n "$VERBOSE" ]]; then
        log_verbose "  Cookies:"
        grep -v "^#" "$COOKIE_FILE" 2>/dev/null | while read -r line; do
            # Parse Netscape cookie format
            local domain name value
            name=$(echo "$line" | awk '{print $6}')
            value=$(echo "$line" | awk '{print $7}')
            if [[ -n "$name" ]]; then
                log_verbose "    $name=${value:0:20}..."
            fi
        done
    fi
    log_verbose ""

    # Make request
    local response
    response=$(curl "${curl_args[@]}" "$url")

    # Parse response - last line is our metadata JSON
    local body meta http_code time_total
    meta=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')
    http_code=$(echo "$meta" | sed 's/.*"http_code":"\([^"]*\)".*/\1/')
    time_total=$(echo "$meta" | sed 's/.*"time_total":"\([^"]*\)".*/\1/')

    log_verbose "RESPONSE:"
    log_verbose "  HTTP Status: $http_code"
    log_verbose "  Time: ${time_total}s"
    log_verbose "  Body length: ${#body} chars"
    if [[ -n "$VERBOSE" ]]; then
        log_verbose "  Body preview:"
        echo "$body" | head -c 800 | sed 's/^/    /' >&2
        echo "" >&2
        if [[ ${#body} -gt 800 ]]; then
            log_verbose "    ... (truncated)"
        fi
    fi
    log_verbose "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Output just the body to stdout
    echo "$body"
}

cookie_valid() {
    if [[ ! -f "$COOKIE_FILE" ]]; then
        return 1
    fi
    local age=$(($(date +%s) - $(stat -f %m "$COOKIE_FILE" 2>/dev/null || stat -c %Y "$COOKIE_FILE" 2>/dev/null)))
    [[ $age -lt 3600 ]]
}

# Resolve OTTER_USERNAME/OTTER_PASSWORD, expanding op:// refs through the cache.
# Sets RESOLVED_USERNAME / RESOLVED_PASSWORD. `op` runs only when the cache is cold,
# which is why the daily-review barrier warms this in the foreground: a background
# subagent cannot answer the 1Password authorization prompt that `op` raises.
resolve_credentials() {
    RESOLVED_USERNAME="${OTTER_USERNAME:-}"
    RESOLVED_PASSWORD="${OTTER_PASSWORD:-}"

    [[ "$RESOLVED_USERNAME" == op://* ]] || return 0

    if [[ -f "$CREDS_FILE" ]]; then
        log_timing "credentials: using cache"
        RESOLVED_USERNAME=$(head -1 "$CREDS_FILE")
        RESOLVED_PASSWORD=$(tail -1 "$CREDS_FILE")
        return 0
    fi

    log_timing "credentials: resolving op:// refs"

    # Bound every `op` call. Unbounded, it blocks on a 1Password desktop
    # authorization prompt that a background subagent can never answer -- the
    # Otter scanner hung 22 minutes on exactly this. A timeout turns an
    # invisible hang into a reportable failure. The guard lives here rather
    # than only in the caller so it holds no matter who invokes the script.
    local op_timeout="${OTTER_OP_TIMEOUT:-90}"
    if ! RESOLVED_USERNAME=$(timeout "$op_timeout" op read "$RESOLVED_USERNAME"); then
        echo '{"error": "timed out or failed resolving OTTER_USERNAME from 1Password; approve the op authorization prompt and retry"}' >&2
        return 1
    fi
    if ! RESOLVED_PASSWORD=$(timeout "$op_timeout" op read "$RESOLVED_PASSWORD"); then
        echo '{"error": "timed out or failed resolving OTTER_PASSWORD from 1Password; approve the op authorization prompt and retry"}' >&2
        return 1
    fi
    log_timing "credentials: resolved"
    (umask 077; printf '%s\n%s\n' "$RESOLVED_USERNAME" "$RESOLVED_PASSWORD" > "$CREDS_FILE")
    chmod 600 "$CREDS_FILE"
}

login() {
    log_timing "login: start"

    if cookie_valid && [[ -f "$USERID_FILE" ]]; then
        USERID=$(cat "$USERID_FILE")
        export USERID
        log_verbose "Using cached session (userid=$USERID)"
        log_timing "login: using cached session"
        return 0
    fi

    resolve_credentials
    local username="$RESOLVED_USERNAME"
    local password="$RESOLVED_PASSWORD"

    if [[ -z "$username" || -z "$password" ]]; then
        echo '{"error": "OTTER_USERNAME and OTTER_PASSWORD must be set"}' >&2
        exit 1
    fi

    log_timing "login: calling Otter API"
    local login_url="$API_BASE/login?username=$username"

    log_verbose "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_verbose "LOGIN REQUEST:"
    log_verbose "  URL: $login_url"
    log_verbose "  Auth: Basic $username:****"
    log_verbose ""

    local response
    response=$(curl -s -w '\n%{http_code}' \
        "$login_url" \
        -u "$username:$password" \
        -c "$COOKIE_FILE")

    local http_code body
    http_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | sed '$d')

    log_verbose "LOGIN RESPONSE:"
    log_verbose "  HTTP Status: $http_code"
    log_verbose "  Body: $body"
    log_verbose "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ "$http_code" != "200" ]]; then
        echo "{\"error\": \"Login failed with status $http_code\", \"body\": $body}" >&2
        exit 1
    fi

    USERID=$(echo "$body" | jq -r '.userid')
    echo "$USERID" > "$USERID_FILE"
    export USERID
    log_timing "login: complete"
}

available_speeches() {
    local page_size="${1:-50}"
    local cursor="${2:-}"
    local modified_after="${3:-}"
    log_timing "available_speeches: page_size=$page_size cursor=$cursor modified_after=$modified_after"

    local url="$API_BASE/available_speeches?page_size=$page_size&funnel=home_feed&source=home"

    if [[ -n "$cursor" ]]; then
        url="$url&last_load_ts=$cursor"
    fi
    if [[ -n "$modified_after" ]]; then
        url="$url&modified_after=$modified_after"
    fi

    curl_verbose GET "$url" \
        -H 'accept: application/json' \
        -H 'referer: https://otter.ai/all-notes' \
        -b "$COOKIE_FILE"

    log_timing "available_speeches: done"
}

speech() {
    local otid="$1"
    local url="$API_BASE/speech?otid=$otid"
    log_timing "speech: fetching $otid"

    curl_verbose GET "$url" \
        -H 'accept: application/json' \
        -H "referer: https://otter.ai/u/$otid" \
        -b "$COOKIE_FILE"

    log_timing "speech: done"
}

summary() {
    local otid="$1"
    local url="$API_BASE/abstract_summary?otid=$otid"
    log_timing "summary: fetching $otid"

    curl_verbose GET "$url" \
        -H 'accept: application/json' \
        -H "referer: https://otter.ai/u/$otid" \
        -b "$COOKIE_FILE"

    log_timing "summary: done"
}

action_items() {
    local otid="$1"
    local url="$API_BASE/speech_action_items?otid=$otid"
    log_timing "action_items: fetching $otid"

    curl_verbose GET "$url" \
        -H 'accept: application/json' \
        -H "referer: https://otter.ai/u/$otid" \
        -b "$COOKIE_FILE"

    log_timing "action_items: done"
}

# Fetch one available_speeches page, failing loudly on a network error or a non-JSON body.
#
# Assign and check the status on separate lines. `local raw=$(...)` would make
# `local` the command whose status $? reports, masking a failed fetch; and the
# status must be tested here, because the jq pipelines downstream happily turn an
# empty response into valid JSON. Without this guard a hard network failure
# (otter.ai refused by a local firewall rule, curl exit 7) made `sync` print one
# newline and exit 0, which a caller reads as "no new meetings" before advancing
# the scanner cursor past meetings that were never scanned. A page that is too
# large returns an HTML 504 page, which the JSON check catches.
fetch_speeches_page() {
    local raw_response
    local fetch_status
    raw_response=$(available_speeches "$@")
    fetch_status=$?

    if [[ $fetch_status -ne 0 ]]; then
        echo "otter-api: sync failed: available_speeches exited $fetch_status (network or auth failure)" >&2
        return "$fetch_status"
    fi

    if response_is_blank "$raw_response"; then
        echo "otter-api: sync failed: available_speeches returned an empty response" >&2
        return 1
    fi

    if ! echo "$raw_response" | jq -e . >/dev/null 2>&1; then
        echo "otter-api: sync failed: available_speeches returned invalid JSON" >&2
        return 1
    fi

    echo "$raw_response"
}

# Minimal per-meeting fields from a raw available_speeches page, newest first.
SPEECH_FIELDS='{
    otid,
    title,
    start_time,
    summary: .short_abstract_summary,
    outline: [.speech_outline[]? | {
        title: .text,
        segments: [.segments[]?.text]
    }]
}'

# Inline action items into a {speeches: [...]} document. Only processed meetings
# (summary present) have action items; action_item_count is unreliable (often null).
attach_action_items() {
    local result="$1"
    local otids
    otids=$(echo "$result" | jq -r '.speeches[] | select(.summary != null) | .otid')

    local action_lines=""
    if [[ -n "$otids" ]]; then
        log_timing "sync: fetching action items for $(echo "$otids" | wc -l | tr -d ' ') meetings"
        local otid items
        while IFS= read -r otid; do
            [[ -z "$otid" ]] && continue
            items=$(curl -s "$API_BASE/speech_action_items?otid=$otid" \
                -H 'accept: application/json' \
                -b "$COOKIE_FILE" | jq -c --arg otid "$otid" '{($otid): [.speech_action_items[]? | {
                    text,
                    assignee: (.assignee | if type == "object" then .name else . end),
                    completed
                }]}')
            action_lines+="$items"$'\n'
        done <<< "$otids"
    fi

    printf '%s' "$action_lines" | jq -s --argjson result "$result" '
        (add // {}) as $actions
        | $result
        | .speeches = [.speeches[] | . + {action_items: ($actions[.otid] // [])}]
    '
}

# Fetch one page of meetings with minimal fields and inline action items.
# Prefer sync-since: a large page_size here is slow (1000 took over 60s and then 504'd).
sync_meetings() {
    local page_size="${1:-50}"
    local cursor="${2:-}"
    local modified_after="${3:-}"

    # When paginating with cursor, modified_after is required by API
    if [[ -n "$cursor" && -z "$modified_after" ]]; then
        modified_after="1"
    fi

    log_timing "sync: starting page_size=$page_size cursor=$cursor modified_after=$modified_after"

    local raw_response
    raw_response=$(fetch_speeches_page "$page_size" "$cursor" "$modified_after") || return

    local result
    result=$(echo "$raw_response" | jq "{last_load_ts, end_of_list, speeches: [(.speeches // [])[] | $SPEECH_FIELDS]}")

    attach_action_items "$result"
    log_timing "sync: done"
}

# Fetch every meeting newer than stop_otid (the scanner's last_synced_otid), newest first.
# Pages through small pages until the boundary appears, so the list cost and the
# action-item round trips scale with the number of new meetings, not the page size.
# Fails rather than scanning unbounded when the boundary is not found within
# OTTER_MAX_PAGES pages; ending the list first returns everything with boundary_found false.
sync_since() {
    local stop_otid="$1"
    local page_size="${2:-10}"
    local max_pages="${OTTER_MAX_PAGES:-20}"
    local cursor=""
    local modified_after=""
    local collected="[]"
    local boundary_found=false
    local end_of_list=false
    local page=0

    while ((page < max_pages)); do
        page=$((page + 1))
        log_timing "sync-since: page $page cursor=$cursor"

        local raw_response
        raw_response=$(fetch_speeches_page "$page_size" "$cursor" "$modified_after") || return

        local page_result
        page_result=$(echo "$raw_response" | jq -c --arg stop "$stop_otid" "
            [(.speeches // [])[] | $SPEECH_FIELDS] as \$all
            | ([\$all[].otid] | index(\$stop)) as \$idx
            | {
                speeches: (if \$idx == null then \$all else \$all[:\$idx] end),
                boundary_found: (\$idx != null),
                end_of_list: (.end_of_list == true),
                last_load_ts
            }")

        # A cursor page can repeat meetings from earlier pages, so keep the first copy of each otid.
        collected=$(jq -c --argjson page "$page_result" '
            ([.[].otid]) as $seen
            | . + [$page.speeches[] | select(.otid as $o | $seen | index($o) | not)]' <<< "$collected")
        boundary_found=$(jq -r '.boundary_found' <<< "$page_result")
        end_of_list=$(jq -r '.end_of_list' <<< "$page_result")

        if [[ "$boundary_found" == true || "$end_of_list" == true ]]; then
            break
        fi

        cursor=$(jq -r '.last_load_ts // empty' <<< "$page_result")
        modified_after="1"
        if [[ -z "$cursor" ]]; then
            echo "otter-api: sync-since failed: page $page has no last_load_ts cursor" >&2
            return 1
        fi
    done

    if [[ "$boundary_found" != true && "$end_of_list" != true ]]; then
        echo "otter-api: sync-since failed: boundary otid $stop_otid not found within $max_pages pages of $page_size" >&2
        return 1
    fi

    local result
    result=$(jq -n --argjson speeches "$collected" --argjson boundary "$boundary_found" --argjson eol "$end_of_list" \
        '{boundary_found: $boundary, end_of_list: $eol, speeches: $speeches}')

    attach_action_items "$result"
    log_timing "sync-since: done"
}

main() {
    local command="${1:-}"

    case "$command" in
        warm-credentials)
            resolve_credentials
            if [[ -z "$RESOLVED_USERNAME" || -z "$RESOLVED_PASSWORD" ]]; then
                echo '{"error": "OTTER_USERNAME and OTTER_PASSWORD must be set"}' >&2
                exit 1
            fi
            echo "credentials ready: $CREDS_FILE"
            ;;
        available_speeches)
            login
            available_speeches "${2:-50}" "${3:-}" "${4:-}"
            ;;
        sync)
            login
            sync_meetings "${2:-50}" "${3:-}" "${4:-}"
            ;;
        sync-since)
            if [[ -z "${2:-}" ]]; then
                echo '{"error": "sync-since requires the last_synced_otid boundary argument"}' >&2
                exit 1
            fi
            login
            sync_since "$2" "${3:-10}"
            ;;
        speech)
            if [[ -z "${2:-}" ]]; then
                echo '{"error": "speech command requires otid argument"}' >&2
                exit 1
            fi
            login
            speech "$2"
            ;;
        summary)
            if [[ -z "${2:-}" ]]; then
                echo '{"error": "summary command requires otid argument"}' >&2
                exit 1
            fi
            login
            summary "$2"
            ;;
        action_items)
            if [[ -z "${2:-}" ]]; then
                echo '{"error": "action_items command requires otid argument"}' >&2
                exit 1
            fi
            login
            action_items "$2"
            ;;
        *)
            echo "Usage: $0 {warm-credentials|available_speeches|sync|sync-since|speech|summary|action_items} <args>" >&2
            exit 1
            ;;
    esac
}

# A regex match, not `${var//[[:space:]]/}`: bash 3.2 runs that substitution in quadratic time on
# multibyte text, so a large Otter response hung `sync` for minutes at full CPU.
response_is_blank() {
    [[ ! "$1" =~ [^[:space:]] ]]
}

# Sourcing the script (tests) defines the functions without running a command.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
