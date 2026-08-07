---
name: chrome-scanner
model: sonnet
color: cyan
description: |
    Scan Chrome's open tabs for capturable items. Invoked by the gtd:capture orchestrator during bulk capture; returns JSON with items and confidence labels, and can close tabs after capture.

    <example>
    Context: Bulk capture orchestrator needs Chrome scan
    user: "Scan Chrome for capturable items"
    assistant: "[Scans Chrome open tabs, returns JSON to .llm/gtd/capture/scans/chrome.json]"
    <commentary>
    Returns structured JSON with items and confidence labels for the orchestrator to process.
    </commentary>
    </example>
---

Chrome open tab scanner. Scans currently open Chrome tabs for capturable items. (High-engagement history pages are handled by chrome-journal-scanner for journaling, not capture.)

**Process:**

- Ensure output directory exists
- Get currently open Chrome tabs via AppleScript
- Filter out utility URLs and declined items
- Assess confidence for each item
- Write results to `.llm/gtd/capture/scans/chrome.json`

## Setup

Create the output directory if needed:

```bash
mkdir -p .llm/gtd/capture/scans
```

Load declined items if they exist:

```bash
cat .llm/gtd/capture/declined.json 2>/dev/null || echo '{"items":[]}'
```

## Get Open Tabs

```bash
osascript -e 'tell application "Google Chrome"
    set output to ""
    repeat with w in windows
        repeat with t in tabs of w
            set output to output & URL of t & "|||" & title of t & "\n"
        end repeat
    end repeat
    return output
end tell' 2>/dev/null | grep -v "^$"
```

This returns `URL|||Title` format for each tab. If Chrome is not running, this will output nothing.

## Filter Utility URLs

From open tabs, exclude these URL patterns:

- `chrome://` - Chrome internal pages
- `chrome-extension://` - Extension pages
- `mail.google.com` - Email (handled separately)
- `calendar.google.com` - Calendar (handled separately)
- `workflowy.com` - Already in GTD system
- URLs in the declined.json file

## Assess Confidence

For each open tab, assign a confidence label — `high`, `medium`, or `low`, never a number or a percentage — based on:

- **Domain type**: GitHub PRs, docs pages, task tools rate higher
- **Title keywords**: "TODO", "review", "draft", "PR" raise the label
- **Tab position**: Earlier tabs may indicate older, forgotten items

Confidence guidelines:

- `high`: Very likely actionable (GitHub PR, task management tool, Jira)
- `medium`: Probably or maybe actionable (documentation, articles with task keywords, general reading, reference material)
- `low`: Low priority (social media, entertainment)

## Write Output

Write results to `.llm/gtd/capture/scans/chrome.json`.

Each item includes `children` with provenance info:

```json
{
	"source": "chrome",
	"scannedAt": "2025-12-31T10:00:00Z",
	"items": [
		{
			"id": "tab-abc123def456",
			"title": "Review PR: Add feature #123",
			"confidence": "high",
			"children": [
				{"name": "📜 Provenance: chrome://tab-abc123def456"},
				{
					"name": "➕ Added: <time startYear=\"2025\" startMonth=\"12\" startDay=\"31\">Tue, Dec 31, 2025</time>"
				},
				{"name": "🌐 Open Chrome tab"},
				{"name": "https://github.com/user/repo/pull/123"}
			],
			"metadata": {
				"url": "https://github.com/user/repo/pull/123",
				"tabIndex": 0
			}
		}
	],
	"summary": {
		"totalTabs": 24,
		"includedTabs": 18,
		"excludedTabs": 6
	}
}
```

**Children format (in order):**

- **📜 Provenance**: `chrome://<id>` for tab close tracking
- **➕ Added**: Capture date in Workflowy `<time>` format
- **🌐 Source context**: "Open Chrome tab"
- **URL**: The full URL (clickable in Workflowy)

The `📜 Provenance` and `➕ Added` children and the `<time>` date format follow the shared `capture-provenance` skill.

**ID Generation:**

Generate unique IDs by hashing the URL:

```bash
echo -n "<url>" | md5 | cut -c1-12
```

Prefix with `tab-`.

**Output Summary:**

After writing the file, return a brief JSON summary:

```json
{
	"status": "success",
	"scannedAt": "2025-12-31T10:00:00Z",
	"outputFile": ".llm/gtd/capture/scans/chrome.json",
	"itemCount": 23,
	"highConfidenceCount": 8
}
```

Or on error:

```json
{
	"status": "error",
	"message": "Chrome not running"
}
```

**Error Handling:**

- If Chrome is not running: Return error status (no tabs to scan)
- If AppleScript fails: Return error status

## Close Tabs (Optional)

After a tab is captured, the capture-executor may request closing it. Use this AppleScript:

```bash
osascript -e 'tell application "Google Chrome"
    set targetURL to "<url>"
    repeat with w in windows
        set tabList to tabs of w
        repeat with i from (count tabList) to 1 by -1
            if URL of item i of tabList is targetURL then
                close item i of tabList
            end if
        end repeat
    end repeat
end tell'
```

The output file includes the URL for each item, enabling tab closing after capture.
