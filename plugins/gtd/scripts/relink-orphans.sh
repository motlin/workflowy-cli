#!/bin/bash
# Relink orphans: move children that accumulated on the GTD bucket navigation
# links onto the real nodes those links point to.
#
# Under `Metadata`, each GTD bucket category (📥 Inboxes, ☑️ Next Actions, …)
# holds navigation-link nodes — a node whose name is a single <a href> that the
# CLI resolves as a linkTargets entry (e.g. `📥 Inboxes > Personal 📥 Inbox`
# links to the real `Personal > 📥 Inbox`). These shortcuts are meant to be
# childless, but items occasionally get filed *under the link* instead of under
# the node it points to. This moves each such orphan to the link's target.
#
# Scope is deliberately limited to the listed bucket categories — NOT all of
# Metadata — so sections whose nodes legitimately have children (👥 People,
# 📂 Project Directories, 🧠 Session Memory, …) are never touched. Within a
# bucket the orphan count and names are unknown and irrelevant: orphans are
# discovered by link resolution and each moves as an intact subtree (a moved
# orphan that is itself a link node with its own metadata children is never
# taken apart).
#
# Usage:
#   ./relink-orphans.sh [--category "Name"]... [--dry-run]
#
# Options:
#   --category NAME  Limit to one bucket category (repeatable). Defaults to all.
#   --dry-run        Show what would move without moving.
#
# Example:
#   ./relink-orphans.sh
#   ./relink-orphans.sh --dry-run
#   ./relink-orphans.sh --category "📁 Projects"

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$PROJECT_ROOT"

METADATA_PATH="Metadata"
POSITION=bottom
DRY_RUN=false

# The GTD bucket categories under Metadata whose children are navigation links.
DEFAULT_CATEGORIES=(
  "📥 Inboxes"
  "☑️ Next Actions"
  "📅 Calendar"
  "📤 Waiting For"
  "🌱 Someday"
  "📚 Reference"
  "📁 Projects"
)
CATEGORIES=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --category)
      CATEGORIES+=("$2")
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ ${#CATEGORIES[@]} -eq 0 ]]; then
  CATEGORIES=("${DEFAULT_CATEGORIES[@]}")
fi

# Emit one TSV row (childId, targetId, childName, targetName) per orphan in a
# bucket. Walk down to the first link node that has children: its children are
# the orphans, and we do NOT recurse into them so each moves as an intact
# subtree. Keep recursing through non-link containers in case links are nested.
# shellcheck disable=SC2016  # $t/$tn are jq variables, must not be shell-expanded
WALK='
  def walk:
    if ((.linkTargets // []) | length > 0) and ((.children // []) | length > 0)
    then ( .linkTargets[0].id as $t
         | .linkTargets[0].name as $tn
         | (.children[] | [.id, $t, ((.name // "") | gsub("<[^>]*>"; "")), $tn] | @tsv) )
    else ( .children[]? | walk )
    end;
  walk'

MOVED=0
for CATEGORY in "${CATEGORIES[@]}"; do
  # Fetch the bucket; isolate the JSON object (the CLI may print a stderr audit
  # warning, and leading SQL logs aren't part of the object). Depth 2 reaches
  # bucket > link > orphan; missing buckets are skipped.
  DATA=$(./bin/run.js node get --path "$METADATA_PATH,$CATEGORY" --depth 2 --json \
    --fields name,id,children,linkTargets 2>/dev/null \
    | awk 'BEGIN {in_json=0} /^\{/ {in_json=1} in_json {print} /^\}/ {exit}')

  if [[ -z "$DATA" ]]; then
    echo "  ⚠️  Skipping missing bucket: $CATEGORY"
    continue
  fi

  PAIRS=$(echo "$DATA" | jq -r "$WALK")
  [[ -z "$PAIRS" ]] && continue

  while IFS=$'\t' read -r CHILD_ID TARGET_ID CHILD_NAME TARGET_NAME; do
    [[ -z "$CHILD_ID" ]] && continue
    LABEL=$(echo "$CHILD_NAME" | head -c 60)
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [DRY-RUN] $LABEL → $TARGET_NAME"
    else
      ./bin/run.js node move --node-id "$CHILD_ID" --parent-id "$TARGET_ID" -p "$POSITION" >/dev/null 2>&1
      echo "  ✓ $LABEL → $TARGET_NAME"
    fi
    MOVED=$((MOVED + 1))
  done <<< "$PAIRS"
done

echo ""
if [[ "$MOVED" -eq 0 ]]; then
  echo "✅ No orphaned children under the GTD bucket links."
elif [[ "$DRY_RUN" == true ]]; then
  echo "📊 Relink summary: $MOVED orphan(s) would move (DRY-RUN, no changes made)"
else
  echo "📊 Relink summary: $MOVED orphan(s) moved"
fi
echo "✅ Done!"
