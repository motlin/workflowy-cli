---
name: review-proposal-batch
description: Render a batch of proposed before/after edits as a self-contained page where the user Accepts/Rejects/Later each card — and optionally applies the accepted edits live. Use when you have concrete, reviewable edit proposals (tag sweeps, text rewrites, bulk node changes) the user should approve before they are applied. Trigger phrases include "review these edits", "let me accept/reject the changes", "proposal review page". NOT for plain status summaries or findings write-ups with no apply step — those belong in the chat, because the Accept/Reject buttons would be inert and misleading.
---

# Review Proposal Batch

Render a JSON spec of proposed edits into a polished, self-contained page with per-card Accept / Reject / Later controls, using the bundled `render_report.py`. Do not hand-write HTML or CSS — generate the JSON spec, then run the script.

The point of this skill is the **decide-then-apply** loop: the user reviews each proposed change and you act on their decisions. If there is nothing to accept or reject — i.e. you are just summarizing what happened — do not use this skill; summarize in the chat instead, so the buttons are never shown without being wired to anything.

## Generate the JSON spec

Write a JSON file (typically under `.llm/`) matching this schema:

```json
{
	"title": "Tag Sweep Review",
	"subtitle": "64 proposed edits · say \"apply\" when ready",
	"cards": [
		{
			"heading": "Sat, Jul 17, 2021",
			"href": "https://workflowy.com/#/97449b3a011f",
			"linkText": "97449b3a011f",
			"note": "judgment call explained here (renders italic with ⚠️)",
			"before": "old text",
			"after": "new text"
		},
		{
			"heading": "Plain card",
			"body": "Cards with body instead of before/after render as plain text."
		}
	]
}
```

All card fields except `heading` are optional. Cards with both `before` and `after` render a word-level diff (red strikethrough for removals, green for insertions).

## Render and open

```bash
python3 .claude/skills/review-proposal-batch/render_report.py <input.json> <output.html> --open
```

Omit `--open` to render without opening the browser. The page is fully self-contained (inline CSS, stdlib-only script) and follows the system dark/light mode.

## Interactive review with --serve

```bash
python3 .claude/skills/review-proposal-batch/render_report.py <input.json> <output.html> --open --serve [port]
```

Run this in the background (it blocks). Default port 8765. Every card gets Accept / Reject / Later / Undo buttons plus a rejection-note field; clicks append to `<output>.decisions.jsonl` (one JSON object per line — latest line per card id wins; ids come from `linkText`). Decisions survive page reloads via GET `/decisions`. Without `--serve` the same buttons persist to browser localStorage only.

To apply edits live instead of batch-processing later, pass `--apply-cmd "<command template with {id} {decision} {note}>"` alongside `--serve`. On Accept the server runs the command with the tokens substituted, the edit is applied immediately, and the card animates out of the list — removing the separate process-decisions and re-render round-trip. The command must print a JSON object with an `ok` boolean and a `removed` boolean (`removed: true` collapses the card; an `error` string is shown on the card on failure).

When the user says to process decisions: read the JSONL, collapse to latest per id, apply `accept` cards, leave `later` for the next round, and treat each `reject` note as a correction — mine it for rule fixes and add the id to a persistent skip-list so it stays out of future regens.

## Style contract

The script owns all presentation: card layout, diff colors, dark mode, typography. Keep data concerns (what to show) in the JSON and never patch styling per-report — if the style needs to change, edit `render_report.py` so every future report benefits.
