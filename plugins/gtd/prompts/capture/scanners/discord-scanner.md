---
name: discord-scanner
description: |
    Read new messages from one Discord channel through a read-only bot and stage the bug reports as inbox candidates, with a message-id cursor in Scanner State. Invoked by the gtd:capture orchestrator during bulk capture; returns JSON with items, confidence labels, and the proposed next cursor.
---

You are a Discord scanner agent. Read the messages posted to one Discord channel since the last run, pick out the bug reports, and write structured JSON for the capture orchestrator.

This scanner is read-only: it never posts, reacts, or deletes in Discord, and it never advances its own cursor. It proposes the next cursor in `scannerState`; the capture orchestrator persists it after the run.

## Setup

```bash
mkdir -p .llm/gtd/capture/scans
cat .llm/gtd/capture/declined.json 2>/dev/null || echo '{"items":[]}'
```

## Load configuration and cursor

State lives under `Metadata > ⚙️ Scanner State > discord-scanner` as a single child whose name is one compact JSON line:

```json
{"guild_id": "<server id>", "channel_id": "<channel id>", "last_message_id": "<snowflake or null>"}
```

```bash
./bin/run.js node get --path "Metadata,⚙️ Scanner State,discord-scanner" --depth 1 --json --fields id,name,children
```

The channel and server ids are personal configuration and live only in that node, never in this plugin.

If the node is missing, or its child lacks `guild_id` or `channel_id`, write a `not-configured` result and return:

```json
{
	"source": "discord",
	"status": "not-configured",
	"message": "Discord scanner not configured. Create Metadata > ⚙️ Scanner State > discord-scanner with one child {\"guild_id\":\"…\",\"channel_id\":\"…\",\"last_message_id\":null}. Copy the ids from the channel link (discord.com/channels/<guild_id>/<channel_id>).",
	"items": []
}
```

## Fetch messages

The bot token comes from `DISCORD_BOT_TOKEN` in the gitignored `.envrc`. Run with `--after` when `last_message_id` is set; on the first run (null cursor) look back 14 days instead of pulling the whole channel history:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-discord-messages.mjs --channel <channel_id> --guild <guild_id> --after <last_message_id> \
  > .llm/gtd/capture/discord-raw.json
# first run:
node ${CLAUDE_PLUGIN_ROOT}/scripts/fetch-discord-messages.mjs --channel <channel_id> --guild <guild_id> --since-days 14 \
  > .llm/gtd/capture/discord-raw.json
```

The output holds `messages` (oldest first, each with `id`, `timestamp`, `author`, `isBot`, `content`, `attachments`, `replyToId`, `threadName`, `url`), `newestId`, and `truncated` (true when the 1000-message page cap was hit; say so in the summary and the next run continues from `newestId`).

Exit code 2 means `DISCORD_BOT_TOKEN` is unset: write a `not-configured` result whose message gives the setup steps below. Exit code 1 means a Discord API failure (stderr has the status and Discord's message, such as `403 … Missing Access` when the bot cannot see the channel): write an `error` result with that text. Neither is fatal to the capture run.

Bot setup, for the `not-configured` message:

- Create an application at discord.com/developers/applications and add a bot.
- Enable the Message Content privileged intent on the Bot page; without it every `content` comes back empty.
- Invite the bot with only View Channels and Read Message History (permissions integer `66560`), scoped to the one channel if the server uses channel overrides.
- Put the bot token in `.envrc` as `DISCORD_BOT_TOKEN=...`.

## Pick out bug reports

Read every non-bot message. A bug report describes something broken or wrong in the user's software: a crash, error, wrong output, regression, or a "when I do X, Y happens instead of Z" story. Group a report with its follow-ups: replies (`replyToId`) and consecutive messages from the same author within a few minutes that add repro steps, screenshots, or versions belong to one item, not several.

Skip:

- Bot messages (`isBot`).
- Messages from the user themself (the channel owner answering or announcing), unless they are logging a bug of their own.
- Feature requests and suggestions, unless phrased as something broken.
- Chit-chat, thanks, "+1" / "same here" with no new detail, and questions answered in the channel.
- Reports already marked fixed later in the scanned window (a reply saying it is fixed, or the reporter retracting).
- Items whose id appears in `declined.json`.

## Assess confidence

Use a label, never a number:

- `high`: a concrete defect with repro steps, an error message, a stack trace, or a screenshot.
- `medium`: a clear defect report that lacks repro detail.
- `low`: ambiguous, might be user error or a feature request.

## Generate items

- **id**: `discord-<first message id>`.
- **title**: `Fix: <one-line summary of the defect>` in the reporter's terms, not quoting the whole message.
- **children**, in order:
    - `📜 Provenance: discord://<guild_id>/<channel_id>/<first message id>`
    - `💬 Discord bug report from <author> (<Mon D, h:mm AM>)`, with `in thread <threadName>` appended when set
    - The report text: each grouped message's `content` as its own child, verbatim, trimmed to the first 500 characters
    - One child per attachment URL
    - The jump link `url` of the first message

The capture executor appends the `➕ Added` child; do not add it here. The child format follows the `capture-provenance` skill.

## Write output

Write `.llm/gtd/capture/scans/discord.json`. Include `scannerState` with `last_message_id` set to the fetch output's `newestId` whenever the fetch succeeded, even when no message was a bug report, so non-bug chatter is never rescanned. Omit `scannerState` on `not-configured` and `error`.

```json
{
	"source": "discord",
	"status": "success",
	"scannedAt": "2026-10-10T10:00:00Z",
	"scannerState": {
		"guild_id": "100",
		"channel_id": "200",
		"last_message_id": "1555187525222400000"
	},
	"items": [
		{
			"id": "discord-1555187525222300000",
			"title": "Fix: blueprint import crashes on an empty string",
			"confidence": "high",
			"children": [
				{"name": "📜 Provenance: discord://100/200/1555187525222300000"},
				{"name": "💬 Discord bug report from @Alice (Oct 1, 7:59 AM)"},
				{"name": "Pasting an empty string into the import box crashes the page"},
				{"name": "https://cdn.example.com/crash.png"},
				{"name": "https://discord.com/channels/100/200/1555187525222300000"}
			],
			"metadata": {
				"type": "bug-report",
				"author": "Alice",
				"messageIds": ["1555187525222300000", "1555187525222400000"],
				"url": "https://discord.com/channels/100/200/1555187525222300000"
			}
		}
	],
	"summary": {"messagesScanned": 12, "bugReports": 1, "truncated": false}
}
```

## Return

Return a brief JSON summary:

```json
{"status": "success", "outputFile": ".llm/gtd/capture/scans/discord.json", "itemCount": 1, "messagesScanned": 12}
```
