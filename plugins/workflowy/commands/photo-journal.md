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

- Date uses bracket syntax `[YYYY-MM-DD HH:MM]` which Workflowy converts to native `<time>` element
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

The bracket date `[2026-01-18 17:03]` will be converted by Workflowy to a native clickable date: `Sun, Jan 18, 2026 at 5:03 PM`

**Capture the node ID** from the CLI output for the next step.

### Navigate to the Node

```text
mcp__chrome-devtools__navigate_page with:
  url: "https://workflowy.com/#/<node-short-id>"
```

Wait for load, then take a snapshot:

```text
mcp__chrome-devtools__take_snapshot
```

### Trigger File Upload

The file input is created dynamically via the slash menu. Steps:

- Click on the node to focus it
- Type "/" to open slash menu
- Click "Upload file" option
- Use `upload_file` tool with the file path

```text
mcp__chrome-devtools__upload_file with:
  uid: <file-chooser-uid-from-snapshot>
  filePath: "<file-path>"
```

### Verify Upload

Check network requests for successful upload:

```text
mcp__chrome-devtools__list_network_requests with:
  resourceTypes: ["xhr", "fetch"]
  pageSize: 10
```

Look for:

- `POST /files/get-presigned-post-url/` - presigned URL request
- `POST s3.amazonaws.com/user-uploads.workflowy` - S3 upload (status 204)
- `POST /push_and_poll` - metadata sync

### Confirm Persistence

Reload and verify the image has a permanent URL:

```text
mcp__chrome-devtools__navigate_page with:
  type: "reload"
```

Take snapshot to verify:

- Image URL starts with `https://workflowy.com/file-proxy/file/`
- NOT a blob URL (`blob:https://workflowy.com/...`)

## DateTime Formatting

| Input            | Bracket Format     | Workflowy Display            |
| ---------------- | ------------------ | ---------------------------- |
| 2026-01-18 17:03 | [2026-01-18 17:03] | Sun, Jan 18, 2026 at 5:03 PM |
| 2026-01-18       | [2026-01-18]       | Sun, Jan 18, 2026            |
| 2026-01-05 09:30 | [2026-01-05 09:30] | Sun, Jan 5, 2026 at 9:30 AM  |

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
- Upload each photo as a child
- Or create separate entries if photos are from different times

```bash
# Multiple photos, same event - use a parent node
./bin/run.js node create \
  --parent-path "📆 Calendar" \
  --name '📷 [2026-01-18 17:03] Evening at the park' \


# Then upload multiple photos to that node
```

## Notes

- The 📷 emoji at the start indicates a photo entry
- Workflowy's "Update" calendar feature will organize entries by date
- For large images, resize first: `sips -Z 1200 "<file-path>" --out "<output-path>"`
- Maximum recommended file size: 5MB
