-- The app's own durable copy of every setting written to workflowy.com, so the
-- values survive when the app runs without it. Never refreshed from the server.
CREATE TABLE local_settings (
	key TEXT PRIMARY KEY NOT NULL,
	json TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
