-- 🏷️ Item metadata cached from the internal API's `/get_tree_data/`, which the
-- public API does not return: numbered_start, calendar, priority.defaultToBottom
-- and layoutMode, one JSON document per node. A write-through cache only, fully
-- replaced on each import and patched after accepted metadata edits.
-- Non-bitemporal.
CREATE TABLE IF NOT EXISTS node_internal_metadata (
    node_id TEXT PRIMARY KEY,
    metadata_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
