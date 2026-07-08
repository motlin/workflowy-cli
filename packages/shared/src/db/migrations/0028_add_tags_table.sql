-- 🎨 Per-tag color assignments (e.g. @Ellen -> green).
-- Workflowy has no API for tag colors; this is our own local-only feature.
-- `name` is the full tag text including the leading #/@; `color` is a Workflowy
-- color name (red/orange/yellow/green/teal/sky/blue/purple/pink/gray).
CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
