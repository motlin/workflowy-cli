-- Consolidate mirror tables into a single normalized table
-- Old tables: mirrors, mirror_root_ids, backlink_mirror_root_ids
-- New table: mirrors with (original_id, mirror_id)
-- Backlinks are derived via inverse queries, not stored separately

-- Create new consolidated mirrors table
CREATE TABLE mirrors_new (
    original_id TEXT NOT NULL,
    mirror_id TEXT NOT NULL,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (original_id, mirror_id, system_from)
);
--> statement-breakpoint
CREATE INDEX mirrors_new_mirror_idx ON mirrors_new (mirror_id, system_to);
--> statement-breakpoint
CREATE INDEX mirrors_new_original_idx ON mirrors_new (original_id, system_to);
--> statement-breakpoint
-- Migrate from mirror_root_ids: nodeId is the mirror, mirrorRootId is the original
INSERT INTO mirrors_new (original_id, mirror_id, system_from, system_to)
SELECT DISTINCT mirror_root_id, node_id, system_from, system_to
FROM mirror_root_ids;
--> statement-breakpoint
-- Migrate from old mirrors table if it has data (nodeId is mirror, originalId is original)
INSERT OR IGNORE INTO mirrors_new (original_id, mirror_id, system_from, system_to)
SELECT original_id, node_id, system_from, system_to
FROM mirrors
WHERE original_id IS NOT NULL;
--> statement-breakpoint
-- Drop old tables
DROP TABLE IF EXISTS mirrors;
--> statement-breakpoint
DROP TABLE IF EXISTS mirror_root_ids;
--> statement-breakpoint
DROP TABLE IF EXISTS backlink_mirror_root_ids;
--> statement-breakpoint
-- Rename new table
ALTER TABLE mirrors_new RENAME TO mirrors;
