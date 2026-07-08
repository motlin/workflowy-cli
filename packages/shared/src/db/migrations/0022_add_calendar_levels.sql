-- Add calendar_levels table for normalized calendar level flags
-- The levels field (JSON string) is being replaced with individual columns

-- Create calendar_levels table
CREATE TABLE calendar_levels (
    node_id TEXT NOT NULL,
    day INTEGER,
    week INTEGER,
    month INTEGER,
    year INTEGER,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, system_from)
);
--> statement-breakpoint
CREATE INDEX calendar_levels_system_to_idx ON calendar_levels (node_id, system_to);
--> statement-breakpoint
-- Migrate existing levels data from calendar_metadata
-- Parse the JSON levels field and insert into calendar_levels
INSERT INTO calendar_levels (node_id, day, week, month, year, system_from, system_to)
SELECT
    node_id,
    CASE WHEN json_extract(levels, '$.day') = 1 OR json_extract(levels, '$.day') = 'true' THEN 1 WHEN json_extract(levels, '$.day') = 0 OR json_extract(levels, '$.day') = 'false' THEN 0 ELSE NULL END,
    CASE WHEN json_extract(levels, '$.week') = 1 OR json_extract(levels, '$.week') = 'true' THEN 1 WHEN json_extract(levels, '$.week') = 0 OR json_extract(levels, '$.week') = 'false' THEN 0 ELSE NULL END,
    CASE WHEN json_extract(levels, '$.month') = 1 OR json_extract(levels, '$.month') = 'true' THEN 1 WHEN json_extract(levels, '$.month') = 0 OR json_extract(levels, '$.month') = 'false' THEN 0 ELSE NULL END,
    CASE WHEN json_extract(levels, '$.year') = 1 OR json_extract(levels, '$.year') = 'true' THEN 1 WHEN json_extract(levels, '$.year') = 0 OR json_extract(levels, '$.year') = 'false' THEN 0 ELSE NULL END,
    system_from,
    system_to
FROM calendar_metadata
WHERE levels IS NOT NULL;
--> statement-breakpoint
-- Recreate calendar_metadata without levels column
CREATE TABLE calendar_metadata_new (
    node_id TEXT NOT NULL,
    root INTEGER,
    level TEXT,
    value TEXT,
    date_id INTEGER,
    timestamp INTEGER,
    found_dates INTEGER,
    system_from TEXT NOT NULL,
    system_to TEXT NOT NULL,
    PRIMARY KEY (node_id, system_from)
);
--> statement-breakpoint
CREATE INDEX calendar_metadata_new_system_to_idx ON calendar_metadata_new (node_id, system_to);
--> statement-breakpoint
-- Migrate data (excluding levels column)
INSERT INTO calendar_metadata_new (node_id, root, level, value, date_id, timestamp, found_dates, system_from, system_to)
SELECT node_id, root, level, value, date_id, timestamp, found_dates, system_from, system_to
FROM calendar_metadata;
--> statement-breakpoint
-- Drop old table and rename new one
DROP TABLE calendar_metadata;
--> statement-breakpoint
ALTER TABLE calendar_metadata_new RENAME TO calendar_metadata;
