-- 🪞 The mirror node owns its mirror row (temporal composites): lead the
-- primary key with mirror_id, so it reads (mirror_id, original_id, system_from).
-- SQLite cannot alter a primary key, so rebuild the table.
CREATE TABLE mirrors_new (
    mirror_id TEXT NOT NULL,
    original_id TEXT NOT NULL,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (mirror_id, original_id, system_from)
);
--> statement-breakpoint
INSERT INTO mirrors_new (mirror_id, original_id, system_from, system_to)
SELECT mirror_id, original_id, system_from, system_to
FROM mirrors;
--> statement-breakpoint
DROP TABLE mirrors;
--> statement-breakpoint
ALTER TABLE mirrors_new RENAME TO mirrors;
--> statement-breakpoint
CREATE INDEX mirrors_mirror_idx ON mirrors (mirror_id, system_to);
--> statement-breakpoint
CREATE INDEX mirrors_original_idx ON mirrors (original_id, system_to);
