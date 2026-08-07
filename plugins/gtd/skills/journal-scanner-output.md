---
description: JSON output contract for GTD journal scanner agents (gmail, github, calendar, imessage, otter, photos, reminders, things3, tvtime, chrome). Use when writing or modifying a scanner that emits .llm/gtd/journal/scans/<source>.json — the per-item fields, required vs optional keys, source emoji and source-URL formats, and the file-level wrapper — so the journal executor can consume the output.
---

# Journal Scanner Output Format

All journal scanners write to `.llm/gtd/journal/scans/<source>.json`.

## Item Format

```json
{
  "id": "<source>-journal-<hash>",
  "title": "Brief description of event",
  "eventDate": "2026-01-04",
  "emoji": "📧",
  "sourceUrl": "https://...",
  "children": ["Detail 1", "Detail 2"],
  "source": "<source>",
  "category": "purchase|travel|meeting|activity|task",
  "confidence": "high",
  "metadata": { ... }
}
```

## Required Fields

| Field        | Description                                       |
| ------------ | ------------------------------------------------- |
| `id`         | `<source>-journal-<first 8 chars of hash>`        |
| `title`      | Event description (no emoji, no time, no amounts) |
| `eventDate`  | `YYYY-MM-DD`                                      |
| `emoji`      | Source emoji (see below)                          |
| `source`     | Scanner name                                      |
| `confidence` | `"high"`, `"medium"`, or `"low"` — never a number |

## Optional Fields

| Field       | Description                                   |
| ----------- | --------------------------------------------- |
| `sourceUrl` | Link to original item                         |
| `children`  | Array of detail strings to add as child nodes |
| `eventTime` | `HH:MM`                                       |
| `metadata`  | Source-specific data                          |

## Source Emojis

| Source    | Emoji |
| --------- | ----- |
| gmail     | 📧    |
| github    | 🐙    |
| calendar  | 📅    |
| imessage  | 💬    |
| reminders | ✅    |
| otter     | 🎤    |
| photos    | 📷    |
| chrome    | 🌐    |
| things3   | ☑️    |
| tvtime    | 📺    |

## Source URL Formats

| Source | URL Format                                            |
| ------ | ----------------------------------------------------- |
| gmail  | `https://mail.google.com/mail/u/0/#inbox/<messageId>` |
| github | `https://github.com/<owner>/<repo>/pull/<number>`     |
| otter  | `https://otter.ai/u/<meetingId>`                      |
| chrome | Original page URL                                     |

Sources without URLs (imessage, reminders, photos, things3, tvtime): omit `sourceUrl`.

## File Structure

```json
{
  "source": "<source>",
  "scannedAt": "2026-01-04T10:00:00Z",
  "items": [ ... ],
  "summary": {
    "eventsFound": 5,
    "highConfidenceCount": 3
  }
}
```
