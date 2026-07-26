#!/usr/bin/env bash
# Add fixed-path Time Machine exclusions for build directories under ~/projects.
# Requires sudo. Run directly; the daily review never runs sudo itself.
set -euo pipefail

ROOT="${1:-$HOME/projects}"

if [ ! -d "$ROOT" ]; then
	echo "No such directory: $ROOT" >&2
	exit 1
fi

echo "Scanning $ROOT for node_modules / target / build / dist ..."

# -prune stops the walk at each match, so nested build output inside an excluded
# directory is covered by its parent exclusion rather than listed separately.
mapfile -d '' DIRS < <(find "$ROOT" -type d \
	\( -name node_modules -o -name target -o -name build -o -name dist \) \
	-prune -print0)

if [ "${#DIRS[@]}" -eq 0 ]; then
	echo "Nothing to exclude."
	exit 0
fi

echo "Found ${#DIRS[@]} directories. Adding fixed-path exclusions (sudo required)..."
printf '%s\0' "${DIRS[@]}" | sudo xargs -0 -n40 tmutil addexclusion -p

echo "Verifying..."
REMAINING=0
for d in "${DIRS[@]}"; do
	if ! tmutil isexcluded "$d" | grep -q '\[Excluded\]'; then
		echo "  still included: $d"
		REMAINING=$((REMAINING + 1))
	fi
done

if [ "$REMAINING" -gt 0 ]; then
	echo "$REMAINING directories are still backed up." >&2
	exit 1
fi

echo "All ${#DIRS[@]} directories excluded."
