-- 👤 Cached Workflowy account state from the internal API: the account
-- (user id, join date), root (Home) metadata and account settings, one JSON
-- document per key. A write-through cache only: rows are written after the
-- server accepts a change or after a refresh, never before. Non-bitemporal.
CREATE TABLE IF NOT EXISTS account_state (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
