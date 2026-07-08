-- 🗑️ Track deleted file attachments on s3_files.
-- Workflowy emits `s3File.isDeleted: true` on nodes whose attachment was removed.
-- Persist it so consumers (the web app) can hide or mark deleted attachments
-- instead of rendering them as live files. Stored as a nullable integer flag
-- (1 = deleted, 0 = present, NULL = unknown/never set) to match the other
-- boolean-ish columns on this table (e.g. is_animated_gif).
ALTER TABLE s3_files ADD COLUMN is_deleted INTEGER;
