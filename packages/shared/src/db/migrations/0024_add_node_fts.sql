-- Add FTS5 full-text search index for keyword search
CREATE VIRTUAL TABLE node_fts USING fts5(
    node_id UNINDEXED,
    content,
    tokenize='porter unicode61'
);
