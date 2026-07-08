-- Migration: Remove backup_ct and backup_lm columns from backup_data table
-- Reason: These values are already stored in the json column and can be extracted when needed

-- Rename old table
ALTER TABLE `backup_data` RENAME TO `backup_data_old`;
--> statement-breakpoint
-- Create new table without backup_ct and backup_lm columns
CREATE TABLE `backup_data` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`backup_import_filename` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (omitting backup_ct and backup_lm)
INSERT INTO `backup_data` (`node_id`, `json`, `backup_import_filename`, `system_from`, `system_to`)
SELECT
	`node_id`,
	`json`,
	`backup_import_filename`,
	`system_from`,
	`system_to`
FROM `backup_data_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `backup_data_old`;
--> statement-breakpoint
-- Create index
CREATE INDEX `backup_data_system_from_idx` ON `backup_data` (`node_id`,`system_from`);
