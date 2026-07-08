-- Migration: Move short_id from node_content to node_metadata
--
-- Purpose: short_id doesn't affect embeddings, so it belongs in node_metadata
-- not node_content. This migration adds short_id to node_metadata and populates
-- it from existing data.
--
-- Note: We don't drop short_id from node_content to avoid breaking existing
-- queries during rollout. It can be removed in a future migration.

ALTER TABLE `node_metadata` ADD `short_id` text;
--> statement-breakpoint
CREATE INDEX `node_metadata_short_id_idx` ON `node_metadata` (`short_id`,`system_to`);
--> statement-breakpoint
-- Populate short_id for existing records (last 12 hex chars of UUID)
UPDATE `node_metadata` SET `short_id` = substr(replace(`node_id`, '-', ''), -12);
