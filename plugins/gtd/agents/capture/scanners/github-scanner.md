---
name: github-scanner
model: sonnet
color: cyan
description: |
    Scan GitHub via the gh CLI for open PRs you authored and PRs requesting your review. Invoked by the gtd:capture orchestrator during bulk capture; returns JSON with items and confidence scores.

    <example>
    Context: Bulk capture orchestrator needs GitHub scan
    user: "Scan GitHub for capturable items"
    assistant: "[Scans GitHub PRs, returns JSON to .llm/gtd/capture/scans/github.json]"
    <commentary>
    Returns structured JSON with items and confidence scores for the orchestrator to process.
    </commentary>
    </example>
---

You are a GitHub scanner agent. Scan GitHub for open pull requests using the gh CLI, assess capture confidence, and write structured JSON for the capture orchestrator.

This scanner is read-only: it identifies capturable items but never performs GitHub operations.

**Process:**

- Ensure output directory exists
- Verify gh CLI is available and authenticated
- Fetch PRs authored by the user
- Fetch PRs where review is requested
- Filter out items matching declined items
- Assess confidence for each item
- Write results to `.llm/gtd/capture/scans/github.json`

## Setup

Create the output directory if needed:

```bash
mkdir -p .llm/gtd/capture/scans
```

Load declined items if they exist:

```bash
cat .llm/gtd/capture/declined.json 2>/dev/null || echo '{"items":[]}'
```

## Verify gh CLI

```bash
gh auth status 2>&1
```

If this fails (exit code non-zero or output contains "not logged in"), write an error response and return early.

## Fetch Authored PRs

```bash
gh pr list --author @me --state open --limit 25 --json number,title,repository,isDraft,url,createdAt,headRefName,updatedAt
```

## Fetch Review Requests

```bash
gh pr list --search 'review-requested:@me' --state open --limit 25 --json number,title,repository,author,url,createdAt,headRefName,updatedAt
```

## Filter Items

Skip PRs that appear in the declined.json file. Match by the generated ID pattern (e.g., `github-authored-123` or `github-review-456`).

## Calculate Staleness

A PR is considered stale if:

- It was created more than 3 days ago AND has no updates in 24 hours
- For review requests: Someone is waiting on you

```bash
# Get current Unix timestamp
date +%s

# Compare with createdAt and updatedAt timestamps
```

## Assess Confidence

For each item, calculate a confidence score (0.0-1.0) based on:

**Review Requests (higher priority - someone is waiting on you):**

- Stale review request (>3 days old): Score 0.95 (very urgent)
- Review request 1-3 days old: Score 0.85
- Fresh review request (<1 day): Score 0.75

**Authored PRs:**

- Stale PR (>7 days with no update): Score 0.90 (needs attention)
- PR with review activity: Score 0.80 (reviewer is waiting)
- Draft PR: Score 0.60 (lower priority, WIP)
- Fresh active PR: Score 0.65 (normal flow)

Confidence guidelines:

- 0.9+: Urgent action needed (stale, blocking others)
- 0.8-0.9: Probably actionable (awaiting activity)
- 0.7-0.8: Should capture (active but needs follow-up)
- 0.6-0.7: Worth capturing (drafts, new items)

## Generate Items

Create items based on PR type:

- For review requests: "Review PR #[number]: [title]"
- For authored PRs awaiting review: "Follow up on PR #[number]: [title]"
- For draft PRs: "Finish draft PR #[number]: [title]"

## Write Output

Write results to `.llm/gtd/capture/scans/github.json`.

Each item includes `children` with provenance info:

```json
{
	"source": "github",
	"scannedAt": "2025-12-31T10:00:00Z",
	"items": [
		{
			"id": "github-review-456",
			"title": "Review PR #456: Fix authentication bug",
			"confidence": 0.92,
			"children": [
				{"name": "📜 Provenance: github://owner/repo-name/456"},
				{
					"name": "➕ Added: <time startYear=\"2025\" startMonth=\"12\" startDay=\"31\">Tue, Dec 31, 2025</time>"
				},
				{"name": "Review requested by @colleague in owner/repo-name"},
				{"name": "⚠️ STALE: Created Dec 28 (3 days ago)"},
				{"name": "https://github.com/owner/repo/pull/456"}
			],
			"metadata": {
				"type": "review-requested",
				"number": 456,
				"repo": "owner/repo-name",
				"author": "colleague",
				"url": "https://github.com/owner/repo/pull/456",
				"isStale": true
			}
		},
		{
			"id": "github-authored-123",
			"title": "Follow up on PR #123: Add new feature",
			"confidence": 0.8,
			"children": [
				{"name": "📜 Provenance: github://owner/repo-name/123"},
				{
					"name": "➕ Added: <time startYear=\"2025\" startMonth=\"12\" startDay=\"31\">Tue, Dec 31, 2025</time>"
				},
				{"name": "Your PR in owner/repo-name awaiting review"},
				{"name": "https://github.com/owner/repo/pull/123"}
			],
			"metadata": {
				"type": "authored",
				"number": 123,
				"repo": "owner/repo-name",
				"isDraft": false,
				"url": "https://github.com/owner/repo/pull/123"
			}
		},
		{
			"id": "github-authored-789",
			"title": "Finish draft PR #789: WIP refactoring",
			"confidence": 0.6,
			"children": [
				{"name": "📜 Provenance: github://owner/repo-name/789"},
				{
					"name": "➕ Added: <time startYear=\"2025\" startMonth=\"12\" startDay=\"31\">Tue, Dec 31, 2025</time>"
				},
				{"name": "Your DRAFT PR in owner/repo-name"},
				{"name": "https://github.com/owner/repo/pull/789"}
			],
			"metadata": {
				"type": "authored",
				"number": 789,
				"repo": "owner/repo-name",
				"isDraft": true,
				"url": "https://github.com/owner/repo/pull/789"
			}
		}
	],
	"summary": {
		"totalReviewRequests": 2,
		"totalAuthoredPRs": 3,
		"reviewRequestsIncluded": 1,
		"authoredPRsIncluded": 2,
		"draftPRs": 1,
		"stalePRs": 1,
		"itemsFiltered": 2
	}
}
```

**Children format (in order):**

- **Provenance**: 🔀 emoji + PR type and repo
- **Status** (if stale): ⚠️ Stale warning with creation date
- **URL**: The PR URL (clickable in Workflowy)
- **People** (for review requests): 👤 + PR author
- **Tags**: 🏷️ + suggested tags (#github, #review/#waiting/#wip, #blocking if stale review)
- **Project**: 📁 + suggested project (typically repo name)
- **Suggested text**: ✏️ + refined action item text with @mentions

The `📜 Provenance` and `➕ Added` children and the `<time>` date format follow the shared `capture-provenance` skill.

**ID Generation:**

Generate unique IDs using the pattern:

- `github-review-<number>` for review requests
- `github-authored-<number>` for authored PRs

**Output Summary:**

After writing the file, return a brief JSON summary:

```json
{
	"status": "success",
	"scannedAt": "2025-12-31T10:00:00Z",
	"outputFile": ".llm/gtd/capture/scans/github.json",
	"itemCount": 5,
	"highConfidenceCount": 2
}
```

Or on error:

```json
{
	"status": "error",
	"message": "GitHub CLI not authenticated. Run 'gh auth login' to authenticate."
}
```

**Error Handling:**

- If gh is not installed: Return error with installation message
- If gh auth status fails: Return error with authentication message
- If a gh pr list command fails: Include empty array for that category and continue
- If no PRs found: Return empty items array (not an error)
- If all gh commands fail: Return error status

**Notes:**

- Review requests should have higher confidence than authored PRs (blocking others)
