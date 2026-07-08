---
description: Import web articles into Workflowy as structured outlines. Use when user wants to save/import article content for reading or reference.
---

# Article Import

Import web articles into Workflowy with automatic markdown parsing. Workflowy's API converts markdown headers and paragraphs into a structured outline.

## Quick Command

> Run `./bin/run.js node create --help` to verify available flags before constructing commands.

```bash
npx clean-mark <url> --stdout | ./bin/run.js node create --name - --parent-id <parent-id>
```

## How It Works

- `clean-mark` extracts article content as clean markdown
- `node create --name -` reads markdown from stdin
- Workflowy API parses markdown into children:
    - `## Header` → `[h2]` node
    - `### Subheader` → `[h3]` node
    - Paragraphs → `[p]` nodes
    - Links preserved as `text (url)` format

## Example

```bash
# Import Spotify engineering blog post
npx clean-mark "https://engineering.atspotify.com/2023/05/fleet-management-at-spotify-part-3-fleet-wide-refactoring/" --stdout \
  | ./bin/run.js node create --name - --parent-id <reading-list-id>
```

Result structure:

```text
Fleet Management at Spotify (Part 3)
├── [p] Introduction paragraph...
├── [h2] Why do we need fleet-wide refactoring?
├── [p] As mentioned in Part 1...
├── [h2] Actively managing dependencies
├── [p] When we decided to invest...
└── ...
```

## Prerequisites

- `clean-mark` npm package (runs via npx, no install needed)
- Parent node ID for where to create the article

## Tips

- The first `##` header becomes the parent node name
- YAML frontmatter from clean-mark appears in the parent name (can be edited after)
- Use with reading list items: import content, then mark original task complete
