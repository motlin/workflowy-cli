-- Migration: Remove is_mirror_root column from mirrors table
-- Reason: All 400 rows have is_mirror_root=1, so it carries no information

-- Rename old table
ALTER TABLE `mirrors` RENAME TO `mirrors_old`;
--> statement-breakpoint
-- Create new table without is_mirror_root column
CREATE TABLE `mirrors` (
	`node_id` text NOT NULL,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (omitting is_mirror_root)
INSERT INTO `mirrors` (`node_id`, `original_id`, `system_from`, `system_to`)
SELECT
	`node_id`,
	`original_id`,
	`system_from`,
	`system_to`
FROM `mirrors_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `mirrors_old`;
--> statement-breakpoint
-- Create indexes
CREATE INDEX `mirrors_system_from_idx` ON `mirrors` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `mirrors_current_records_idx` ON `mirrors` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `mirrors_original_id_idx` ON `mirrors` (`original_id`,`system_to`);
