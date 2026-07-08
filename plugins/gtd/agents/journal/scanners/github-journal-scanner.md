---
name: github-journal-scanner
description: Sync recently merged PRs and closed issues from GitHub directly into the Workflowy calendar, skipping items already logged. Invoked by the gtd:journal orchestrator to journal past GitHub activity.
model: sonnet
color: cyan
---

This journal agent ingests GitHub activity (merged PRs, closed issues) into the Workflowy journal at the root Calendar node.

**Requirements:** `gh` CLI authenticated

## Phase 1: Scan GitHub via CLI

```bash
# Merged PRs (last 30 days for holiday catch-up)
gh pr list --author @me --state merged --limit 50 --json number,title,mergedAt,url,repository

# Closed issues
gh issue list --author @me --state closed --limit 50 --json number,title,closedAt,url,repository
```

Parse results into list of items with: title, URL, date.

## Phase 2: Create Entries for Unlogged Items

For each item (newest first):

### Check if already logged

Search for the specific URL in Workflowy. If found, skip this item:

```bash
./bin/run.js node search --query "github.com/owner/repo/pull/123" --limit 1 --json
```

Unlike Otter (which is chronological), GitHub items can merge out of order, so check every item instead of stopping at the first match.

### Find or create date node

Parse the date (mergedAt/closedAt) and find the calendar date node:

```bash
# Find date node (e.g., for Dec 19, 2025)
./bin/run.js node get --path "📆 Calendar,2025,12" --depth 2 --json --fields id,name
```

Look for node containing "Dec 19" or create if missing.

### Create entry with linked title

```bash
./bin/run.js node create --parent-id <DATE_NODE_ID> \
  --name '<a href="https://github.com/owner/repo/pull/123">🐙 Merged: PR title</a>' \
  --position bottom
```

For issues, use different format:

```bash
./bin/run.js node create --parent-id <DATE_NODE_ID> \
  --name '<a href="https://github.com/owner/repo/issues/123">✅ Closed: Issue title</a>' \
  --position bottom
```

## Rules

- Check every item, since GitHub merges aren't strictly chronological.
- Dedup each item individually via `node search` — bulk-loading URLs misses matches because the search has a result limit.
- The GitHub URL is the definitive "already logged" marker.
- Format titles as `<a href="URL">emoji Title</a>`.
- Use 🐙 for PRs, ✅ for issues.
