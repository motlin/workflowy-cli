---
name: upload-attachment
description: Upload a file attachment to a Workflowy node
arguments:
    - name: node-id
      description: UUID of the target node (e.g., 4edcfb354f85)
      required: true
    - name: file-path
      description: Local file path to upload (e.g., ~/Downloads/photo.jpg)
      required: true
---

# Upload Attachment to Workflowy Node

Upload a file (image, PDF, etc.) to a specific Workflowy node using browser automation.

## Prerequisites

- Chrome DevTools MCP must be connected
- User must be logged into Workflowy in Chrome
- File must exist at the specified path

## Workflow

### Validate File Exists

```bash
ls -la "<file-path>"
```

Get the file size and MIME type:

```bash
file --mime-type "<file-path>"
```

### Navigate to the Node

Use Chrome DevTools to navigate to the node:

```text
mcp__chrome-devtools__navigate_page with:
  url: "https://workflowy.com/#/<node-id>"
```

Wait for the page to load, then take a snapshot to verify:

```text
mcp__chrome-devtools__take_snapshot
```

### Read File as Base64

Read the file and convert to base64:

```bash
base64 -i "<file-path>" | tr -d '\n'
```

Store the base64 string for the next step.

### Upload via Browser

Execute JavaScript to create a File object and trigger Workflowy's upload:

```javascript
async () => {
	// Base64 data passed from previous step
	const base64Data = '<BASE64_STRING>';
	const fileName = '<FILENAME>';
	const mimeType = '<MIME_TYPE>';

	// Decode base64 to binary
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	const blob = new Blob([bytes], {type: mimeType});

	// Create File object
	const file = new File([blob], fileName, {type: mimeType});

	// Find Workflowy's hidden file input
	const fileInput = document.querySelector('input[type="file"][accept="*"]');
	if (!fileInput) {
		return {error: 'File input not found. Is Workflowy loaded?'};
	}

	// Set the file using DataTransfer API
	const dataTransfer = new DataTransfer();
	dataTransfer.items.add(file);
	fileInput.files = dataTransfer.files;

	// Dispatch change event to trigger upload
	const changeEvent = new Event('change', {bubbles: true});
	fileInput.dispatchEvent(changeEvent);

	return {
		success: true,
		fileName: file.name,
		fileSize: file.size,
		message: 'Upload triggered. Workflowy will upload to S3.',
	};
};
```

Use `mcp__chrome-devtools__evaluate_script` with the function above.

### Verify Upload

Check network requests to confirm the upload completed:

```text
mcp__chrome-devtools__list_network_requests with:
  resourceTypes: ["xhr", "fetch"]
  pageSize: 10
```

Look for these requests in order:

- `POST /files/get-presigned-post-url/` - Workflowy gets S3 presigned URL
- `POST s3.amazonaws.com/user-uploads.workflowy` - File uploaded to S3 (status 204)
- `POST /push_and_poll` - Metadata synced

### Confirm Persistence

Take a final snapshot to verify the image appears with a permanent URL:

```text
mcp__chrome-devtools__take_snapshot
```

The image should have a URL like:

```text
https://workflowy.com/file-proxy/file/gAAAAAB...
```

NOT a blob URL like:

```text
blob:https://workflowy.com/...
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

## Example Usage

Upload a photo to a journal entry:

```text
/workflowy:upload-attachment --node-id 4edcfb354f85 --file-path ~/Downloads/photos/snow-day.jpg
```

## Error Handling

- **File not found**: Check the file path exists
- **File input not found**: Ensure Workflowy is loaded and user is logged in
- **Upload fails**: Check network requests for errors, verify file size limits
- **Blob URL persists**: The S3 upload may have failed; check for errors in network requests

## File Size Limits

Workflowy has file size limits for uploads. For images:

- Recommended: Under 5MB
- Maximum: Check Workflowy's current limits

For large files, consider resizing images before upload:

```bash
# Resize to max 1200px width while preserving aspect ratio
sips -Z 1200 "<file-path>" --out "<output-path>"
```

## Notes

- The upload is asynchronous - the blob URL appears immediately, then changes to a permanent URL after S3 upload completes
- Workflowy uses AWS S3 for file storage via presigned URLs
- Files are served through Workflowy's file-proxy for access control
- This method works because it uses Workflowy's native file input mechanism
