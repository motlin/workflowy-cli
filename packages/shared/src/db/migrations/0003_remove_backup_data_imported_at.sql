-- Migration: Remove imported_at column from backup_data table
-- Reason: system_from already captures when the record was imported

-- Rename old table
ALTER TABLE `backup_data` RENAME TO `backup_data_old`;
--> statement-breakpoint
-- Create new table without imported_at column
CREATE TABLE `backup_data` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`backup_file_date` integer,
	`backup_ct` integer,
	`backup_lm` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (imported_at is dropped since system_from already has the timestamp)
INSERT INTO `backup_data` (`node_id`, `json`, `backup_file_date`, `backup_ct`, `backup_lm`, `system_from`, `system_to`)
SELECT
	`node_id`,
	`json`,
	`backup_file_date`,
	`backup_ct`,
	`backup_lm`,
	`system_from`,
	`system_to`
FROM `backup_data_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `backup_data_old`;
--> statement-breakpoint
-- Create index
CREATE INDEX `backup_data_system_from_idx` ON `backup_data` (`node_id`,`system_from`);
