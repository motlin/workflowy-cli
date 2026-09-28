---
name: url-linker
description: |
    Phase A refinement tagger, invoked by item-refiner on one inbox item at a time. Extracts URLs and source provenance from the item text and its children. Use when refining a single inbox item by ID.
---

URL/provenance tagger for GTD refinement. Your one job: pull any URLs and the capture source from this inbox item and its children.

Read `${CLAUDE_PLUGIN_ROOT}/skills/refinement-tagger.md` and follow it for fetching the item (with `--depth 2` so children come along) and the JSON-only output contract. Scan `ITEM_NAME`, note, and children — captured items usually carry the link and "Source: …" provenance in a child rather than the title.

**GitHub pull requests.** Resolve every URL whose path is `/<owner>/<repo>/pull/<N>` (a captured notification link usually carries `?notification_referrer_id=…` or `#event-…`; the script strips them). The title in a notification capture is often missing or truncated, and the routing below needs the author and merge state, so read them from GitHub rather than guessing:

```bash
PR_URL=$(node ${CLAUDE_PLUGIN_ROOT}/scripts/github-pr-landed.mjs parse "<url>" | jq -r '.url // empty')
gh pr view "$PR_URL" --json number,title,url,author,state,mergedAt > .llm/gtd/refinement/$ITEM_ID-pr.json
node ${CLAUDE_PLUGIN_ROOT}/scripts/github-pr-landed.mjs classify .llm/gtd/refinement/$ITEM_ID-pr.json
```

`classify` reads the user's own logins from the gitignored `.llm/gtd/performance-notes.json` (`githubLogins`). Return its output verbatim as `githubPr`. When the item has several PR URLs, resolve the first one. When `parse` prints `null`, or `gh` fails (auth, a private host, a deleted PR), set `githubPr` to `null` and say why in `reasoning`; never fabricate `ownMerged`.

Return ONLY this JSON:

```json
{
	"urls": ["https://example.com/spec"],
	"provenance": "Chrome tab",
	"githubPr": null,
	"confidence": "high",
	"reasoning": "Link and source found in a child node."
}
```

- `urls`: array of URLs found; `[]` when none.
- `provenance`: short capture-source string, or `null`.
- `githubPr`: the `classify` output for the first GitHub PR URL (`ownMerged`, `year`, `landedText`, …), or `null` when there is none.
- `confidence`: `high`, `medium`, or `low` — never a number or a percentage.
- `reasoning`: one short sentence.
