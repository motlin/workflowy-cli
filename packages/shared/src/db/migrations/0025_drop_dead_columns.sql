-- Drop unused columns and tables that were declared in the schema but never written.
--   * node_metadata.cp           — never assigned. Backup `cp` is mapped to completedAt during ingestion.
--   * node_metadata.numbered_start — never assigned by any code path.
--   * node_collapsed table       — never inserted into (user does not collapse nodes).

-- Drop the node_collapsed table outright.
DROP TABLE node_collapsed;
--> statement-breakpoint

-- Rebuild node_metadata without `cp` and `numbered_start` columns.
-- SQLite (older versions) cannot DROP COLUMN, so do the table-rebuild dance.
CREATE TABLE node_metadata_new (
    node_id TEXT NOT NULL,
    short_id TEXT,
    priority INTEGER,
    created_at INTEGER,
    modified_at INTEGER,
    completed_at INTEGER,
    layout_mode TEXT,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, system_from)
);
--> statement-breakpoint
INSERT INTO node_metadata_new
SELECT node_id, short_id, priority, created_at, modified_at, completed_at,
       layout_mode, system_from, system_to
FROM node_metadata;
--> statement-breakpoint
DROP TABLE node_metadata;
--> statement-breakpoint
ALTER TABLE node_metadata_new RENAME TO node_metadata;
--> statement-breakpoint
CREATE INDEX node_metadata_system_to_idx ON node_metadata (node_id, system_to);
--> statement-breakpoint
CREATE INDEX node_metadata_short_id_idx ON node_metadata (short_id, system_to);
