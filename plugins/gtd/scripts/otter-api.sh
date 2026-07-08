#!/bin/bash
# Otter.ai API wrapper - fetches meetings with authentication
#
# Requires environment variables:
#   OTTER_USERNAME - Otter.ai account email
#   OTTER_PASSWORD - Otter.ai account password
#
# Usage:
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh available_speeches [page_size] [cursor] [modified_after]
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh sync [page_size] [cursor] [modified_after]  # minimal JSON with action items
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh speech <otid>
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh summary <otid>
#   ${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh action_items <otid>
#
# Environment:
#   OTTER_VERBOSE=1  - Log full request/response details to stderr
#   OTTER_TIMING=1   - Log timing info to stderr
#
# Output: JSON to stdout

set -euo pipefail

API_BASE="https://otter.ai/forward/api/v1"
COOKIE_FILE="/tmp/otter-session-cache"
USERID_FILE="/tmp/otter-userid-cache"
CREDS_FILE="/tmp/otter-creds-cache"

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

login() {
    log_timing "login: start"

    if cookie_valid && [[ -f "$USERID_FILE" ]]; then
        USERID=$(cat "$USERID_FILE")
        export USERID
        log_verbose "Using cached session (userid=$USERID)"
        log_timing "login: using cached session"
        return 0
    fi

    local username="${OTTER_USERNAME:-}"
    local password="${OTTER_PASSWORD:-}"

    if [[ "$username" == op://* ]]; then
        if [[ -f "$CREDS_FILE" ]]; then
            log_timing "login: using cached credentials"
            username=$(head -1 "$CREDS_FILE")
            password=$(tail -1 "$CREDS_FILE")
        else
            log_timing "login: resolving op:// credentials"
            username=$(op read "$username")
            log_timing "login: got username"
            password=$(op read "$password")
            log_timing "login: got password"
            printf '%s\n%s\n' "$username" "$password" > "$CREDS_FILE"
            chmod 600 "$CREDS_FILE"
        fi
    fi

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

# Fetch meetings with minimal fields and inline action items
sync_meetings() {
    local page_size="${1:-50}"
    local cursor="${2:-}"
    local modified_after="${3:-}"

    # When paginating with cursor, modified_after is required by API
    if [[ -n "$cursor" && -z "$modified_after" ]]; then
        modified_after="1"
    fi

    log_timing "sync: starting page_size=$page_size cursor=$cursor modified_after=$modified_after"

    # Fetch meetings
    local raw_response
    raw_response=$(available_speeches "$page_size" "$cursor" "$modified_after")

    # Extract pagination info and minimal meeting data
    local result
    result=$(echo "$raw_response" | jq '{
        last_load_ts,
        end_of_list,
        speeches: [(.speeches // [])[] | {
            otid,
            title,
            start_time,
            summary: .short_abstract_summary,
            action_item_count,
            outline: [.speech_outline[]? | {
                title: .text,
                segments: [.segments[]?.text]
            }]
        }]
    }')

    # Fetch action items for processed meetings (have summary)
    # Note: action_item_count is unreliable (often null), so we check for summary instead
    local meetings_with_actions
    meetings_with_actions=$(echo "$result" | jq -r '.speeches[] | select(.summary != null) | .otid')

    if [[ -n "$meetings_with_actions" ]]; then
        log_timing "sync: fetching action items for $(echo "$meetings_with_actions" | wc -l | tr -d ' ') meetings"

        # Build action items map
        local action_map="{}"
        while IFS= read -r otid; do
            [[ -z "$otid" ]] && continue
            local items
            items=$(curl -s "$API_BASE/speech_action_items?otid=$otid" \
                -H 'accept: application/json' \
                -b "$COOKIE_FILE" | jq '[.speech_action_items[]? | {
                    text,
                    assignee: (.assignee | if type == "object" then .name else . end),
                    completed
                }]')
            action_map=$(echo "$action_map" | jq --arg otid "$otid" --argjson items "$items" '. + {($otid): $items}')
        done <<< "$meetings_with_actions"

        # Merge action items into result
        result=$(echo "$result" | jq --argjson actions "$action_map" '
            .speeches = [.speeches[] | . + {action_items: ($actions[.otid] // [])}]
        ')
    fi

    echo "$result"
    log_timing "sync: done"
}

main() {
    local command="${1:-}"

    case "$command" in
        available_speeches)
            login
            available_speeches "${2:-50}" "${3:-}" "${4:-}"
            ;;
        sync)
            login
            sync_meetings "${2:-50}" "${3:-}" "${4:-}"
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
            echo "Usage: $0 {speeches|available_speeches|speech|summary|action_items} <args>" >&2
            exit 1
            ;;
    esac
}

main "$@"
