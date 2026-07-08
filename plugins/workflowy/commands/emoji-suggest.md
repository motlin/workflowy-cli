---
name: emoji-suggest
description: Suggest and add emojis to calendar journal entries
arguments:
    - name: parent-id
      description: UUID of the calendar node to scan (e.g., 6bf42551caa3)
      required: true
    - name: batch-size
      description: Number of entries to process per batch (default 8)
      required: false
---

# Emoji Suggest for Calendar Entries

Add contextually appropriate emojis to the beginning of journal entries in a Workflowy calendar.

## Workflow

### Load Metadata

> Run `./bin/run.js node list --help` to verify available flags before constructing commands.

First, sync the GTD metadata cache (it contains the preferred emoji mappings for hashtags): if the `gtd` plugin is installed, launch its `gtd:metadata-sync` agent ("Sync GTD metadata to .llm/gtd/metadata/"); otherwise reuse an existing `.llm/gtd/metadata/` cache if present.

```bash
# Extract emoji mappings from hobbies (metadata/hobbies-registry.json)
# Hobbies structure: .children[] has .children[] with name like "#tag", emoji in .children[].name like "Emoji: 🎮"
jq '
  [.. | objects | select(.name and (.name | type == "string")) |
    # Strip HTML tags and extract #tag (handles <span class="colored">...</span> wrapper)
    (.name | gsub("<[^>]+>"; "") | gsub("^[^#]*"; "") | ltrimstr("#") | gsub("^\\s+|\\s+$"; "")) as $tag |
    (.children[]?.name | select(type == "string" and startswith("Emoji: ")) | sub("^Emoji: *"; "")) as $emoji |
    select($emoji and ($tag | length > 0)) | {key: $tag, value: $emoji}]
  | from_entries
' .llm/gtd/metadata/hobbies-registry.json
```

This produces a tag→emoji lookup like:

```json
{
	"reading": "📚",
	"gaming": "🎮",
	"running": "🏃",
	"cooking": "🍳"
}
```

When an entry contains a hashtag that has a preferred emoji in metadata, use that emoji as the only option. The user has already specified their preference.

### Load Calendar Children

Fetch date nodes and their entry children:

```bash
LOG_LEVEL=fatal ./bin/run.js node list \
  --parent-id <parent-id> \
  --depth 2 \
  --json 2>/dev/null
```

### Filter to Dated Nodes with Entries

From the JSON array, filter to date nodes (containing `<time`) that have children:

```bash
jq '[.[] | select(.name | type == "string") | select(.name | contains("<time")) | {date: .name, children: [.children[]? | {id, name}]}] | map(select(.children | length > 0))'
```

This produces an array like:

```json
[
	{
		"date": "<time startYear=\"2026\" startMonth=\"1\" startDay=\"7\">Wed, Jan 7, 2026</time>",
		"children": [
			{"id": "abc123...", "name": "Worked from the city."},
			{"id": "def456...", "name": "Played games with friends."}
		]
	}
]
```

### Process Each Entry

For each journal entry bullet:

**Skip entries that:**

- Already have an emoji at the start (check if first character is emoji)
- Have a null or empty name

**For entries needing emojis:**

1. **Check for hashtag with preferred emoji** - Extract any `#tag` from the entry text and look it up in the metadata emoji map from the Load Metadata section. If found, use that emoji directly without asking (auto-apply) or offer it as the only option.

2. **Otherwise, suggest contextual options** - Analyze the content to suggest exactly 4 appropriate emoji options based on themes like: exercise, food, TV, family, work, travel, games, medical, shopping, weather, etc.

### Batch Processing

Process entries in batches (default 8, configurable via `--batch-size`):

- Collect the next N entries that need emojis
- Ask questions in groups of 4 (AskUserQuestion max is 4 per call)
- After all questions answered, apply all N updates

```text
Question format:
- question: "<full entry text> (<date>)"
- header: "Emoji?"
- options: exactly 4 relevant emoji choices (AskUserQuestion auto-adds "Other" for None/custom)
- multiSelect: false
```

Example:

```json
{
	"question": "\"Worked from the city. Played Skull with the family.\" (Jan 14)",
	"header": "Emoji?",
	"options": [
		{"label": "💼 Briefcase", "description": "Work theme"},
		{"label": "💀 Skull", "description": "Skull game"},
		{"label": "🏙️ City", "description": "City theme"},
		{"label": "👨‍👩‍👧 Family", "description": "Family time"}
	]
}
```

### Apply Updates

After collecting answers for the batch, update all nodes:

```bash
LOG_LEVEL=fatal ./bin/run.js node update \
  --id <node-id> \
  --name "<emoji> <original-text>"
```

### Track Progress

Use TodoWrite to track progress through the calendar dates. Mark dates as completed as you process them.

## Emoji Suggestions by Theme

| Theme             | Suggested Emojis |
| ----------------- | ---------------- |
| Exercise/Workout  | 💪 🏋️ 🏃         |
| Food/Cooking      | 🍗 🍕 🌮 🌭 🍽️   |
| TV/Streaming      | 📺 🎬            |
| Board Games       | 🎲 🎮 💣         |
| Work/Office       | 💼 💻 📞         |
| Medical/Health    | 💉 💊 🏥         |
| Family/Kids       | 👨‍👩‍👧‍👦 📚 🎵         |
| Weather           | ❄️ 🌧️ ☀️         |
| Travel/Driving    | 🚗 ✈️ 🛹         |
| Shopping          | 🎯 🛒 📦         |
| Theater/Shows     | 🎭 🎫            |
| Money/Finance     | 💰 🪙            |
| Home/Cleaning     | 🏠 🧹            |
| Religion          | ✡️ ⛪            |
| Social/Party      | 🎉 🎊            |
| Funny/Quotes      | 😂 💬            |
| Mistakes/Problems | 🤦 ⚠️            |

## Example Session

```text
📋 EMOJI SUGGEST

Scanning calendar: Personal > 📅 Calendar

Found 12 dates with 55 entries

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Processing entries...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[AskUserQuestion batches]

✓ 💼 Worked from the city.
✓ 🏓 Played ~4 games of #pickleball...
✓ 🧹 The cleaning ladies came...
✓ 🤫 I came home and the house seemed silent...
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Processed 55 entries across 12 days
- 52 entries updated with emojis
- 2 entries already had emojis (skipped)
- 1 entry had no content (skipped)
```

## Notes

- Emojis go at the START of the entry, before any existing text
- If an entry already has an emoji anywhere in the text but not at the start, the emoji should still be added to the front
- Preserve HTML entities like `&quot;` in the node names
- The "None" option should skip the entry without modification
- User can provide custom emoji via the "Other" option in AskUserQuestion
