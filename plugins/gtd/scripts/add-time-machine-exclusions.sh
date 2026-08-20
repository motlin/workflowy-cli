#!/usr/bin/env bash
# Add fixed-path Time Machine exclusions for build directories under ~/projects.
# Requires sudo. Run directly; the daily review never runs sudo itself.
set -euo pipefail

ROOT="${1:-$HOME/projects}"

if [ ! -d "$ROOT" ]; then
	echo "No such directory: $ROOT" >&2
	exit 1
fi

# sudo needs a controlling terminal to prompt for a password. Claude Code's `!`
# prefix, and any other non-interactive wrapper, does not give it one: sudo then
# either fails with "a terminal is required" or (with a cached credential that
# expires mid-run) hangs waiting on a prompt nobody can see. Checking up front
# turns both of those into one clear instruction. Skip the check when sudo
# already has a valid cached credential, since no prompt will be needed.
if ! sudo -n true 2>/dev/null && [ ! -t 0 ]; then
	cat >&2 <<-'MSG'
		This script needs sudo, and sudo needs a real terminal to ask for your password.
		It cannot run through Claude Code's `!` prefix or any other non-interactive wrapper.

		Open Terminal or iTerm and run:
		  /Users/craig/projects/workflowy/plugins/gtd/scripts/add-time-machine-exclusions.sh

		Alternatively, authenticate first so no prompt is needed, then re-run here:
		  sudo -v
	MSG
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
