-- ⏱️ The cache-wide system clock: the last system time, in Unix ms, issued to
-- any write. Every writer takes its system_from/system_to from here, so two
-- writes — from any connection or process — never share a millisecond.
-- Seeded from the newest system_from already written.
CREATE TABLE IF NOT EXISTS system_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_ms INTEGER NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO system_clock (id, last_ms)
SELECT 1, COALESCE(CAST(ROUND((MAX(newest) - 2440587.5) * 86400000) AS INTEGER), 0)
FROM (
    SELECT MAX(julianday(system_from)) AS newest FROM node_content
    UNION ALL SELECT MAX(julianday(system_from)) FROM node_metadata
    UNION ALL SELECT MAX(julianday(system_from)) FROM calendar_metadata
    UNION ALL SELECT MAX(julianday(system_from)) FROM calendar_levels
    UNION ALL SELECT MAX(julianday(system_from)) FROM node_embeddings
    UNION ALL SELECT MAX(julianday(system_from)) FROM mirrors
    UNION ALL SELECT MAX(julianday(system_from)) FROM backlinks
    UNION ALL SELECT MAX(julianday(system_from)) FROM virtual_root_ids
    UNION ALL SELECT MAX(julianday(system_from)) FROM ai_metadata
    UNION ALL SELECT MAX(julianday(system_from)) FROM s3_files
    UNION ALL SELECT MAX(julianday(system_from)) FROM changes_metadata
    UNION ALL SELECT MAX(julianday(system_from)) FROM references_roots
    UNION ALL SELECT MAX(julianday(system_from)) FROM backup_imports
);
