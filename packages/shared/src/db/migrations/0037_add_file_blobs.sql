-- Local copies of attachment bytes downloaded by `files mirror`: one row per
-- attachment node, pointing into a content-addressed store on disk (sha256).
-- Local state, not Workflowy data, so not bitemporal. status is 'ok' or 'error';
-- an error row keeps the message and is retried on the next run.
CREATE TABLE file_blobs (
	node_id TEXT PRIMARY KEY NOT NULL,
	status TEXT NOT NULL,
	sha256 TEXT,
	size INTEGER,
	content_type TEXT,
	local_path TEXT,
	error TEXT,
	fetched_at INTEGER NOT NULL
);
