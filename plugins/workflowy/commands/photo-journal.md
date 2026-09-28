---
name: photo-journal
description: Create a photo journal entry in the Workflowy calendar with proper date formatting
arguments:
    - name: file-path
      description: Local file path to upload (e.g., ~/Downloads/photos/snow-day.jpg)
      required: true
    - name: description
      description: Description of the photo/event (e.g., "Sunset over the lake at the park")
      required: true
    - name: datetime
      description: Date and time in ISO format (e.g., 2026-01-18 17:03). Defaults to file modification time.
      required: false
    - name: calendar-path
      description: Path to calendar node (default "📆 Calendar")
      required: false
---

# Photo Journal Entry

Create a calendar journal entry with a photo attachment. Uses proper Workflowy date formatting and flat node structure.

## Structure

Creates a single node with inline datetime:

```text
📆 Calendar
└── 📷 Sun, Jan 18, 2026 at 5:03 PM Sunset over the lake at the park
    └── [photo attachment]
```

**Key points:**

- Date uses bracket syntax `[YYYY-MM-DD HH:MM]`. The CLI stores it as literal text; the web UI "Update" migration later converts it to a native date and files the entry by date (see the `calendar-dates` skill)
- Single level - description and date in one node
- Photo is a direct child (empty node with image)
- 📷 emoji indicates photo entry

## Prerequisites

- Chrome DevTools MCP must be connected
- User must be logged into Workflowy in Chrome
- File must exist at the specified path

## Workflow

### Validate File and Get Metadata

```bash
ls -la "<file-path>"
file --mime-type "<file-path>"
```

If no datetime provided, extract from file:

```bash
# Get file modification time
stat -f "%Sm" -t "%Y-%m-%d %H:%M" "<file-path>"
```

For photos with EXIF data:

```bash
# Try to get EXIF DateTimeOriginal (requires exiftool)
exiftool -DateTimeOriginal -s3 "<file-path>" 2>/dev/null || stat -f "%Sm" -t "%Y-%m-%d %H:%M" "<file-path>"
```

### Create the Journal Entry Node

Use the CLI with bracket date syntax:

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
./bin/run.js node create \
  --parent-path "📆 Calendar" \
  --name '📷 [<DATETIME>] <DESCRIPTION>' \
  --position bottom \

```

**Example:**

```bash
./bin/run.js node create \
  --parent-path "📆 Calendar" \
  --name '📷 [2026-01-18 17:03] Sunset over the lake at the park' \
  --position bottom \

```

The bracket date `[2026-01-18 17:03]` stays literal text until the user runs the web UI "Update" migration, which renders it as `Sun, Jan 18, 2026 at 5:03 PM`.

**Capture the node ID** from the CLI output for the next step.

### Attach the Photo

Follow `/workflowy:upload-attachment` with the new entry's ID: it creates an empty child under the entry and uploads the photo into that child, then verifies the child shows a `https://workflowy.com/file-proxy/file/` image. Never upload onto the entry itself.

## DateTime Formatting

| Input            | Bracket Format     | Display after "Update"       |
| ---------------- | ------------------ | ---------------------------- |
| 2026-01-18 17:03 | [2026-01-18 17:03] | Sun, Jan 18, 2026 at 5:03 PM |
| 2026-01-18       | [2026-01-18]       | Sun, Jan 18, 2026            |
| 2026-01-05 09:30 | [2026-01-05 09:30] | Mon, Jan 5, 2026 at 9:30 AM  |

**Important:** Always zero-pad months and days: `[2026-01-05]` not `[2026-1-5]`

## Example Session

```text
/workflowy:photo-journal \
  --file-path ~/Downloads/photos/IMG_0127.jpg \
  --description "Sunset over the lake at the park" \
  --datetime "2026-01-18 17:03"
```

**Result:**

```text
📆 Calendar
└── 📷 Sun, Jan 18, 2026 at 5:03 PM Sunset over the lake at the park
    └── [IMG_0127.jpg - photo of kids in snow]
```

## Batch Processing Multiple Photos

For multiple photos from the same day/event:

- Create one parent node for the event
- Attach all its photos with `/workflowy:upload-attachment`, which gives each photo its own empty child
- Or create separate entries if photos are from different times

```bash
# Multiple photos, same event - use a parent node
./bin/run.js node create \
  --parent-path "📆 Calendar" \
  --name '📷 [2026-01-18 17:03] Evening at the park' \


# Then attach the photos with /workflowy:upload-attachment, one empty child per photo
```

## Notes

- The 📷 emoji at the start indicates a photo entry
- Workflowy's "Update" calendar feature will organize entries by date
- For large images, resize first: `sips -Z 1200 "<file-path>" --out "<output-path>"`
- Maximum recommended file size: 5MB
