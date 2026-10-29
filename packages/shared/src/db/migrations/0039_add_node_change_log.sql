-- A commit-ordered log of which nodes changed, for GET /api/v1/nodes/changes.
-- System times are one per unit of work, may repeat, and need not be monotonic
-- (a unit can commit after another that read the clock later), so they cannot
-- serve as an exact change cursor. SQLite runs one write transaction at a time,
-- so seq, assigned inside the writing transaction, is in commit order: a reader
-- that has seen seq N has seen every change at or below it. Triggers fill the
-- log, so every writer (web server, CLI, Durable Object) records its changes.
-- left_parent = 1 marks a parent_id the node sat under before a node_content
-- row closed or was replaced. The log keeps roughly the newest 10000 entries;
-- a cursor older than that answers a reset.
CREATE TABLE node_change_log (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id TEXT NOT NULL,
	parent_id TEXT,
	left_parent INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TRIGGER node_change_log_prune AFTER INSERT ON node_change_log WHEN NEW.seq % 1000 = 0
BEGIN
	DELETE FROM node_change_log WHERE seq <= NEW.seq - 10000;
END;
--> statement-breakpoint
CREATE TRIGGER node_content_change_log_insert AFTER INSERT ON node_content
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER node_content_change_log_update AFTER UPDATE ON node_content
BEGIN
	INSERT INTO node_change_log (node_id, parent_id, left_parent) VALUES (OLD.id, OLD.parent_id, 1);
END;
--> statement-breakpoint
CREATE TRIGGER node_content_change_log_delete AFTER DELETE ON node_content
BEGIN
	INSERT INTO node_change_log (node_id, parent_id, left_parent) VALUES (OLD.id, OLD.parent_id, 1);
END;
--> statement-breakpoint
CREATE TRIGGER node_metadata_change_log_insert AFTER INSERT ON node_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (NEW.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER node_metadata_change_log_update AFTER UPDATE ON node_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER node_metadata_change_log_delete AFTER DELETE ON node_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER mirrors_change_log_insert AFTER INSERT ON mirrors
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (NEW.mirror_id);
END;
--> statement-breakpoint
CREATE TRIGGER mirrors_change_log_update AFTER UPDATE ON mirrors
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.mirror_id);
END;
--> statement-breakpoint
CREATE TRIGGER mirrors_change_log_delete AFTER DELETE ON mirrors
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.mirror_id);
END;
--> statement-breakpoint
CREATE TRIGGER references_roots_change_log_insert AFTER INSERT ON references_roots
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (NEW.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER references_roots_change_log_update AFTER UPDATE ON references_roots
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER references_roots_change_log_delete AFTER DELETE ON references_roots
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER ai_metadata_change_log_insert AFTER INSERT ON ai_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (NEW.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER ai_metadata_change_log_update AFTER UPDATE ON ai_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
--> statement-breakpoint
CREATE TRIGGER ai_metadata_change_log_delete AFTER DELETE ON ai_metadata
BEGIN
	INSERT INTO node_change_log (node_id) VALUES (OLD.node_id);
END;
