-- Remove originalId from node_metadata (now derivable from mirrors table)
-- SQLite doesn't support DROP COLUMN directly, so we recreate the table

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
    collapsed INTEGER,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, system_from)
);
--> statement-breakpoint
INSERT INTO node_metadata_new (
    node_id, short_id, priority, created_at, modified_at, completed_at,
    cp, layout_mode, numbered_start, collapsed, system_from, system_to
)
SELECT
    node_id, short_id, priority, created_at, modified_at, completed_at,
    cp, layout_mode, numbered_start, collapsed, system_from, system_to
FROM node_metadata;
--> statement-breakpoint
DROP TABLE node_metadata;
--> statement-breakpoint
ALTER TABLE node_metadata_new RENAME TO node_metadata;
--> statement-breakpoint
-- Recreate indexes
CREATE INDEX node_metadata_system_to_idx ON node_metadata (node_id, system_to);
--> statement-breakpoint
CREATE INDEX node_metadata_short_id_idx ON node_metadata (short_id, system_to);
