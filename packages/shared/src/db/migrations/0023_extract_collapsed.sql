-- Extract collapsed state into separate 1:1 table
-- collapsed is local UI state, not from API/backup, so it gets its own non-temporal table

-- Create the new table for local collapsed state
CREATE TABLE node_collapsed (
    node_id TEXT PRIMARY KEY,
    collapsed INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
-- Migrate existing collapsed data from node_metadata
-- Only migrate rows where collapsed is set and the record is current (not phased out)
INSERT INTO node_collapsed (node_id, collapsed)
SELECT node_id, collapsed
FROM node_metadata
WHERE collapsed IS NOT NULL
  AND system_to = '9999-12-31 23:59:59';
--> statement-breakpoint
-- Drop the collapsed column from node_metadata
-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
CREATE TABLE node_metadata_new (
    node_id TEXT NOT NULL,
    short_id TEXT,
    priority INTEGER,
    created_at INTEGER,
    modified_at INTEGER,
    completed_at INTEGER,
    cp INTEGER,
    layout_mode TEXT,
    numbered_start INTEGER,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, system_from)
);
--> statement-breakpoint
-- Copy data without collapsed column
INSERT INTO node_metadata_new
SELECT node_id, short_id, priority, created_at, modified_at, completed_at, cp,
       layout_mode, numbered_start, system_from, system_to
FROM node_metadata;
--> statement-breakpoint
-- Drop old table and rename new one
DROP TABLE node_metadata;
--> statement-breakpoint
ALTER TABLE node_metadata_new RENAME TO node_metadata;
--> statement-breakpoint
-- Recreate indexes
CREATE INDEX node_metadata_system_to_idx ON node_metadata (node_id, system_to);
--> statement-breakpoint
CREATE INDEX node_metadata_short_id_idx ON node_metadata (short_id, system_to);
