#!/usr/bin/env bash
set -euo pipefail

denylist_path=".llm/personal-names-denylist.txt"

mapfile -t staged_paths < <(git diff --cached --name-only --diff-filter=ACMR -- plugins .claude)
if [ "${#staged_paths[@]}" -eq 0 ]; then
	exit 0
fi

if [ ! -f "$denylist_path" ]; then
	echo "PII guard blocked this commit: create $denylist_path with one personal-name pattern per line."
	exit 1
fi

mapfile -t denylist_patterns < <(sed 's/[[:space:]]*#.*$//' "$denylist_path" | sed '/^[[:space:]]*$/d')
if [ "${#denylist_patterns[@]}" -eq 0 ]; then
	echo "PII guard blocked this commit: $denylist_path is empty."
	exit 1
fi

added_lines=$(git diff --cached --unified=0 --no-ext-diff -- plugins .claude | sed -n '/^+++ /d; /^+[^+]/p')
if [ -z "$added_lines" ]; then
	exit 0
fi

match_count=0
for pattern in "${denylist_patterns[@]}"; do
	if grep --fixed-strings --ignore-case --quiet -- "$pattern" <<< "$added_lines"; then
		match_count=$((match_count + 1))
	fi
done

if [ "$match_count" -gt 0 ]; then
	echo "PII guard blocked this commit: staged additions under plugins/ or .claude/ matched $match_count local denylist pattern(s)."
	echo "Review the staged diff locally; matched text is intentionally not printed."
	exit 1
fi
