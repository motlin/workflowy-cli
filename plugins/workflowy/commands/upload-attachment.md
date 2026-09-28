---
name: upload-attachment
description: Attach images to a Workflowy entry as one empty child node per image
arguments:
    - name: node-id
      description: ID of the entry that receives the images (e.g., 4edcfb354f85)
      required: true
    - name: file-paths
      description: One or more local image paths, in the order they should appear (e.g., ~/Downloads/a.jpg ~/Downloads/b.jpg)
      required: true
---

# Attach Images to a Workflowy Entry

Each image lives on its own empty child node under the entry:

```text
📷 Sun, Jan 18, 2026 at 5:03 PM Evening at the park
├── [image 1]
├── [image 2]
└── [image 3]
```

Never upload onto the entry itself. That path no longer works; the entry keeps its text and each image gets a fresh empty child.

## Prerequisites

- Chrome DevTools MCP must be connected
- The user must be logged into Workflowy in Chrome
- Every file must exist

## Workflow

### Validate the Files

```bash
ls -la "<file-path>"
file --mime-type "<file-path>"
```

Convert HEIC and shrink anything over about 5MB before uploading:

```bash
sips -s format jpeg -Z 2400 "<file-path>" --out "<output-path>.jpg"
```

### Create One Empty Child per Image

Create the children in image order, all at the bottom of the entry. Capture each new node's ID from the output.

```bash
./bin/run.js node create --parent-id <node-id> --name '' --position bottom
```

Run the command once per image, one after another, so the children stay in order.

### Upload One Image into Each Child

Zoom into the entry so the empty children show as bullets:

```text
Chrome DevTools MCP navigate_page tool with:
  url: "https://workflowy.com/#/<node-id>"
```

For each child, in order:

- Take a snapshot and click the child's empty bullet text to focus it (the Nth empty child for the Nth image)
- Type `/` to open the slash menu and click "Upload file"
- Pass the file to the file chooser the menu opened

```text
Chrome DevTools MCP upload_file tool with:
  uid: <file-chooser-uid-from-snapshot>
  filePath: "<file-path>"
```

- Check the network log before moving to the next child

```text
Chrome DevTools MCP list_network_requests tool with:
  resourceTypes: ["xhr", "fetch"]
  pageSize: 10
```

Expect, in order:

- `POST /files/get-presigned-post-url/` - Workflowy gets an S3 presigned URL
- `POST s3.amazonaws.com/user-uploads.workflowy` - file uploaded to S3 (status 204)
- `POST /push_and_poll` - metadata synced

If the image lands anywhere other than the focused empty child (on the entry, or on a new sibling), stop and fix it before uploading the next one.

### Verify Every Child

Reload the entry and take a snapshot:

```text
Chrome DevTools MCP navigate_page tool with:
  type: "reload"
```

The upload is done only when every child created above holds exactly one image whose URL starts with:

```text
https://workflowy.com/file-proxy/file/
```

A `blob:https://workflowy.com/...` URL means that S3 upload did not finish; retry that child. An empty child left with no image gets deleted with `./bin/run.js node delete --id <child-id>`.

## Example Usage

```text
/workflowy:upload-attachment --node-id 4edcfb354f85 --file-paths ~/Downloads/photos/snow-day.jpg ~/Downloads/photos/sled.jpg
```

## MIME Type Reference

| Extension   | MIME Type       |
| ----------- | --------------- |
| .jpg, .jpeg | image/jpeg      |
| .png        | image/png       |
| .gif        | image/gif       |
| .webp       | image/webp      |
| .pdf        | application/pdf |
| .heic       | image/heic      |

## Error Handling

- **File not found**: check the path
- **No "Upload file" in the slash menu**: the child is not focused; click it again
- **Upload fails**: check the network requests for errors and the file size
- **Blob URL persists after reload**: the S3 upload failed; retry that child
