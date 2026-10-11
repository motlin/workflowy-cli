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
      description: Comma-separated path to the personal calendar (default "Personal,📅 Calendar"). Never the root "📆 Calendar", which holds Otter meetings
      required: false
---

# Photo Journal Entry

Create a personal calendar journal entry with a photo attachment, filed under the photo's day node.

## Structure

Creates a single node with an inline `<time>` datetime, under the day node in `Personal > 📅 Calendar`:

```text
Personal > 📅 Calendar
└── Sun, Jan 18, 2026
    └── 📷 Sun, Jan 18, 2026 at 5:03 PM Sunset over the lake at the park
        └── [photo attachment]
```

**Key points:**

- Photos are personal: file under `Personal > 📅 Calendar`, never the root `📆 Calendar` (that one holds Otter work meetings)
- Write the datetime as an explicit `<time>` element, never bracket text — the CLI stores `[YYYY-MM-DD HH:MM]` as literal text, and nothing reliably converts it later
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

### Find the Day Node

Recent days sit directly under `Personal > 📅 Calendar`; older days are archived under `🗃️ Archive > <decade> > <year> > <Month name>`. Search by display date and keep only a match whose path starts with `Personal > 📅 Calendar` (the same date also exists under `Work > 📅 Calendar` and the root `📆 Calendar`):

```bash
./bin/run.js node search --query "Sun, Jan 18, 2026" --limit 20
```

If no personal day node exists, create one with a `<time>` element as described in the `calendar-dates` skill.

### Create the Journal Entry Node

Build the `<time>` element with `date` (never type the weekday by hand), then create the entry under the day node:

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
DT="2026-01-18 17:03"
TIME_EL=$(printf '<time startYear="%s" startMonth="%s" startDay="%s" startHour="%s" startMinute="%s">%s</time>' \
  "$(date -j -f '%Y-%m-%d %H:%M' "$DT" +%Y)" "$(date -j -f '%Y-%m-%d %H:%M' "$DT" +%-m)" \
  "$(date -j -f '%Y-%m-%d %H:%M' "$DT" +%-d)" "$(date -j -f '%Y-%m-%d %H:%M' "$DT" +%-H)" \
  "$(date -j -f '%Y-%m-%d %H:%M' "$DT" +%-M)" "$(date -j -f '%Y-%m-%d %H:%M' "$DT" '+%a, %b %-d, %Y at %-I:%M %p')")
./bin/run.js node create \
  --parent-id <DAY_NODE_ID> \
  --name "📷 $TIME_EL Sunset over the lake at the park" \
  --position bottom
```

For a date-only photo, drop `startHour`/`startMinute` and the trailing " at 5:03 PM" part of the display text.

**Capture the node ID** from the CLI output for the next step.

### Attach the Photo

Follow `/workflowy:upload-attachment` with the new entry's ID: it creates an empty child under the entry and uploads the photo into that child, then verifies the child shows a `https://workflowy.com/file-proxy/file/` image. Never upload onto the entry itself.

## DateTime Formatting

| Input            | `<time>` attributes                                                            | Display                      |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| 2026-01-18 17:03 | `startYear="2026" startMonth="1" startDay="18" startHour="17" startMinute="3"` | Sun, Jan 18, 2026 at 5:03 PM |
| 2026-01-18       | `startYear="2026" startMonth="1" startDay="18"`                                | Sun, Jan 18, 2026            |

Attributes are not zero-padded.

## Example Session

```text
/workflowy:photo-journal \
  --file-path ~/Downloads/photos/IMG_0127.jpg \
  --description "Sunset over the lake at the park" \
  --datetime "2026-01-18 17:03"
```

**Result:**

```text
Personal > 📅 Calendar
└── Sun, Jan 18, 2026
    └── 📷 Sun, Jan 18, 2026 at 5:03 PM Sunset over the lake at the park
        └── [IMG_0127.jpg - photo of kids in snow]
```

## Batch Processing Multiple Photos

For multiple photos from the same day/event:

- Create one parent node for the event
- Attach all its photos with `/workflowy:upload-attachment`, which gives each photo its own empty child
- Or create separate entries if photos are from different times

```bash
# Multiple photos, same event - use a parent node under the day node ($TIME_EL built as above)
./bin/run.js node create \
  --parent-id <DAY_NODE_ID> \
  --name "📷 $TIME_EL Evening at the park"

# Then attach the photos with /workflowy:upload-attachment, one empty child per photo
```

## Notes

- The 📷 emoji at the start indicates a photo entry
- For large images, resize first: `sips -Z 1200 "<file-path>" --out "<output-path>"`
- Maximum recommended file size: 5MB
