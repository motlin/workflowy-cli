-- Migration: Add short_id column for fast Workflowy link resolution
--
-- Purpose: Enable efficient lookups of nodes by their 12-character short ID
-- which appears in Workflowy URLs like https://workflowy.com/#/ddc3729f7f7b
--
-- The short_id is derived from the UUID's last 12 hex characters (without hyphens).
-- Example: "57c4b47c-31d2-a22b-5607-ddc3729f7f7b" → "ddc3729f7f7b"

ALTER TABLE `node_content` ADD `short_id` text;
--> statement-breakpoint
CREATE INDEX `node_content_short_id_idx` ON `node_content` (`short_id`,`system_to`);
--> statement-breakpoint
ALTER TABLE `nodes` ADD `short_id` text;
--> statement-breakpoint
CREATE INDEX `nodes_short_id_idx` ON `nodes` (`short_id`,`system_to`);
--> statement-breakpoint
-- Populate short_id for existing records (last 12 hex chars of UUID)
UPDATE `node_content` SET `short_id` = substr(replace(`id`, '-', ''), -12);
--> statement-breakpoint
UPDATE `nodes` SET `short_id` = substr(replace(`id`, '-', ''), -12);
