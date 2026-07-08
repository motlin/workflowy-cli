-- 🗝️ Drop vestigial surrogate `id` columns from backlinks and virtual_root_ids.
-- These auto-increment integers were used only as temporal primary keys and were
-- never referenced as foreign keys by application code.
--   * backlinks       PK becomes (node_id, source_id, target_id, system_from)
--   * virtual_root_ids PK becomes (node_id, virtual_root_id, system_from)
-- SQLite cannot DROP a primary-key column, so do the table-rebuild dance.

-- Rebuild backlinks without the `id` column.
CREATE TABLE backlinks_new (
    node_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, source_id, target_id, system_from)
);
--> statement-breakpoint
INSERT INTO backlinks_new
SELECT node_id, source_id, target_id, system_from, system_to
FROM backlinks;
--> statement-breakpoint
DROP TABLE backlinks;
--> statement-breakpoint
ALTER TABLE backlinks_new RENAME TO backlinks;
--> statement-breakpoint
CREATE INDEX backlinks_node_idx ON backlinks (node_id, system_to);
--> statement-breakpoint
CREATE INDEX backlinks_source_idx ON backlinks (source_id, system_to);
--> statement-breakpoint
CREATE INDEX backlinks_target_idx ON backlinks (target_id, system_to);
--> statement-breakpoint

-- Rebuild virtual_root_ids without the `id` column.
CREATE TABLE virtual_root_ids_new (
    node_id TEXT NOT NULL,
    virtual_root_id TEXT NOT NULL,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, virtual_root_id, system_from)
);
--> statement-breakpoint
INSERT INTO virtual_root_ids_new
SELECT node_id, virtual_root_id, system_from, system_to
FROM virtual_root_ids;
--> statement-breakpoint
DROP TABLE virtual_root_ids;
--> statement-breakpoint
ALTER TABLE virtual_root_ids_new RENAME TO virtual_root_ids;
--> statement-breakpoint
CREATE INDEX virtual_root_ids_node_idx ON virtual_root_ids (node_id, system_to);
