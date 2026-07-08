---
name: gmail-journal-scanner
description: Sync purchases, travel, receipts, and appointments from Gmail directly into the Workflowy calendar, skipping items already logged. Invoked by the gtd:journal orchestrator to journal past email events.
model: sonnet
color: cyan
---

Ingests Gmail activity (purchases, travel, receipts, appointments) into the Workflowy journal.

**Requires:** Gmail MCP server configured.

## Phase 1: Scan Gmail via MCP

Prefer the Claude.ai Gmail integration (broader visibility than local MCP). Search by recency:

- **Last 24h (all inbox):** `in:inbox newer_than:1d`
- **Last 30d (unread only):** `is:unread in:inbox newer_than:30d`

Use `maxResults: 30`. Read each with `gmail_read_message` and judge calendar-worthiness: purchases, travel, personal events (meals, meetups, RSVPs), appointments.

## Phase 2: Create entries for unlogged items

For each calendar-worthy email, first check if already logged by searching for its specific URL:

```bash
./bin/run.js node search --query "mail.google.com/mail/u/0/#inbox/MESSAGE_ID" --limit 1 --json
```

If found, skip. Otherwise, find/create the date node and create the entry:

```bash
./bin/run.js node get --path "📆 Calendar,2025,12" --depth 2 --json --fields id,name

./bin/run.js node create --parent-id <DATE_NODE_ID> --position bottom \
  --json '{
    "name": "<a href=\"https://mail.google.com/mail/u/0/#inbox/MESSAGE_ID\">📦 Order from Amazon: Item</a>",
    "children": [{"name": "Order #123-456"}, {"name": "$349.99"}]
  }'
```

Emoji: 📦 orders · ✈️ flights · 🏨 hotels · 🍽️ meals · 🤝 meetups · 📧 other.

## Rules

- Start from Workflowy, not Gmail — the message ID in the URL is the dedup key.
- Format titles as `<a href="URL">emoji Title</a>`.
- Put key details (order #, amount, confirmation code) as children, never as notes.
