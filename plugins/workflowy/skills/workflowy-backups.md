---
description: Workflowy backup file format and metadata fields not available via API. Use when parsing OPML backups or understanding backup-specific data.
---

# Workflowy Backup Files

Workflowy backups are OPML files with additional metadata not available through the API. This skill documents backup-specific features.

## Backup Format

Backups are XML/OPML files with this structure:

```xml
<?xml version="1.0"?>
<opml version="2.0">
  <head>
    <ownerEmail>user@example.com</ownerEmail>
  </head>
  <body>
    <outline text="Node name" _note="Note content" ...attributes...>
      <outline text="Child node" />
    </outline>
  </body>
</opml>
```

## Common Attributes

| Attribute   | Description                  |
| ----------- | ---------------------------- |
| `text`      | Node name (may contain HTML) |
| `_note`     | Node note/description        |
| `_complete` | `"true"` if completed        |
| `_id`       | Full UUID of the node        |

## Calendar Metadata (Backup Only)

The backup file contains calendar hierarchy metadata NOT available via API:

```text
📆 Calendar (root: true)
├── 2025 (level: year, dateId: 20250000)
│   ├── 10 (level: month, dateId: 20251000)
│   │   └── <time ...>Thu, Oct 30, 2025</time> (level: day, dateId: 20251030)
│   ├── 11 (level: month)
│   └── 12 (level: month)
```

**Calendar metadata fields:**

| Field       | Type    | Description                                |
| ----------- | ------- | ------------------------------------------ |
| `root`      | boolean | `true` for the calendar root node          |
| `level`     | string  | `"year"`, `"month"`, or `"day"`            |
| `value`     | string  | Numeric value (year, month, or day number) |
| `dateId`    | number  | Compact date ID: YYYYMMDD (e.g., 20251030) |
| `timestamp` | number  | Unix timestamp in milliseconds             |

**Important:** The API does NOT return or accept `metadata.calendar` fields. These only exist in backup files.

## Mirror Metadata (Backup Only)

Mirrors in backups have a `_mirror` attribute pointing to the original node:

```xml
<outline text="" _mirror="61111c3a-e939-d4dc-1a8c-6bf42551caa3" />
```

The mirror node has no text - it displays the original node's content.

## Shared/Published Metadata

Backups may contain sharing information:

| Field      | Description                         |
| ---------- | ----------------------------------- |
| `_shared`  | Share ID if node is shared          |
| `_publish` | Publish settings if publicly shared |

## Parsing Backups

### Schema Reference

The codebase has Zod schemas for backup parsing in:

- `packages/shared/src/schemas/backup-node.ts`

Key schemas:

- `BackupNodeSchema` - Full node with all metadata
- `CalendarSchema` - Calendar-specific fields
- `MetadataSchema` - All metadata fields

### Importing Backups

The CLI can import backups to SQLite:

> Run `./bin/run.js cache import-backup --help` to verify available flags before constructing commands.

```bash
# Downloads from Workflowy
./bin/run.js dropbox:download-backup

# Imports to SQLite
./bin/run.js cache:import-backup
```

## Local Storage Layout

Downloaded backups are stored compressed under `backups/` (zstd):

```text
backups/Data/(email).YYYY-MM-DD.workflowy.backup.zst   recent days, per-file zstd
backups/Data/archive/YYYY-MM.tar.zst                   older days, solid monthly archive
backups/History/WorkFlowy (email).YYYY-MM-DD.txt.zst   recent days, per-file zstd
backups/History/archive/YYYY-MM.tar.zst                older days, solid monthly archive
```

- `dropbox:download-backup` writes new backups as `.zst`.
- `backups:archive` keeps recent days (default 30) as per-file `.zst` and folds older days into solid monthly `archive/YYYY-MM.tar.zst` archives. It is idempotent and runs automatically as part of `cache:import-backups`.
- Backup reads (`readBackupFile`, `listBackups`, `materializeBackup` in `packages/cli/src/utils/backup-archive.ts`) transparently handle raw files, loose `.zst` files, and entries inside monthly archives — no manual decompression needed.

## API vs Backup Differences

| Feature             | API               | Backup              |
| ------------------- | ----------------- | ------------------- |
| Calendar metadata   | ❌                | ✅                  |
| Mirror original ID  | Via mirrors table | `_mirror` attribute |
| Sharing info        | Limited           | Full                |
| Node ordering       | `priority` field  | Document order      |
| Historical versions | ❌                | ❌ (current only)   |

## Use Cases

- **Calendar analysis**: Parse dateId for date-based queries
- **Migration**: Import full backup with all metadata
- **Archival**: Preserve complete node state including sharing
