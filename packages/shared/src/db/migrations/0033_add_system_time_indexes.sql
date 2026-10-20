-- ⏱️ Index node_content and node_metadata by system time, so "which rows changed
-- since system time T" (new versions after T, versions closed after T) is a
-- range seek instead of a scan. The web server's search snapshot and tag-count
-- cache patch themselves from that change set after every write.
-- The system_to indexes are partial, over closed rows only: a full system_to
-- index would win every live-row lookup (system_to = far future) and turn the
-- recursive subtree queries quadratic.
CREATE INDEX node_content_system_from_idx ON node_content (system_from);
--> statement-breakpoint
CREATE INDEX node_content_closed_at_idx ON node_content (system_to) WHERE system_to < '9999-12-31 23:59:59';
--> statement-breakpoint
CREATE INDEX node_metadata_system_from_idx ON node_metadata (system_from);
--> statement-breakpoint
CREATE INDEX node_metadata_closed_at_idx ON node_metadata (system_to) WHERE system_to < '9999-12-31 23:59:59';
