---
description: Fetch full Otter.ai meeting transcripts as plain text ("[mm:ss] Speaker: text") by otid, cache them locally, and search them. Use when Workflowy's meeting summary is too thin, when exact wording matters, or when a meeting is known only by its otter.ai/u/<otid> link. Find otids first with the otter-meetings-in-workflowy skill.
---

# Otter Transcripts

## Fetch

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/otter-api.sh transcript <otid> > .llm/otter/transcripts/<otid>.txt
```

- Output: a `# <title>` header, `Date:` (UTC), `URL:`, a blank line, then one `[mm:ss] Speaker: text` line per segment, in time order.
- The otid is the last path segment of `https://otter.ai/u/<otid>`.
- Cache under `.llm/otter/transcripts/` (gitignored) and reuse cached files. Transcripts do not change once a meeting ends.
- Fetch several meetings in one shell loop rather than one tool call each.
- `speech <otid>` returns the raw JSON (speakers, outline, word alignment) when you need more than text.

## Credentials

The script resolves `OTTER_USERNAME` / `OTTER_PASSWORD` (1Password `op://` refs are fine) and caches the session. If it fails with a credentials error, ask the user to run `! plugins/gtd/scripts/otter-api.sh warm-credentials` in the foreground, then retry.

## Read efficiently

A one-hour meeting is ~40-50 KB of text. Don't read whole transcripts into context when you only need part of one:

- `grep -n -i -E '<keyword>|<synonym>' <file>` to find the relevant stretch, then read just that range with `sed -n`.
- Filter to one speaker: `grep '] Alice:' <file>`.
- When you need several long transcripts, delegate reading to subagents with a specific extraction question, and have them return quotes with timestamps.

## Cite

Quote with the meeting title, date, and timestamp, e.g. `1:1 Alice, Sep 29 [12:34]`, so the user can jump to the spot in Otter.
