-- Migration: Replace backup_file_date with backup_import_filename in backup_data table
-- Reason: backup_file_date is derivable by joining to backup_imports on filename

-- Rename old table
ALTER TABLE `backup_data` RENAME TO `backup_data_old`;
--> statement-breakpoint
-- Create new table with backup_import_filename instead of backup_file_date
CREATE TABLE `backup_data` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`backup_import_filename` text NOT NULL,
	`backup_ct` integer,
	`backup_lm` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
-- Copy data, joining with backup_imports to get filename from backup_file_date
-- For rows where backup_file_date matches a backup_imports.backup_date, use that filename
-- For rows without a matching backup_imports entry, use 'unknown' as placeholder
INSERT INTO `backup_data` (`node_id`, `json`, `backup_import_filename`, `backup_ct`, `backup_lm`, `system_from`, `system_to`)
SELECT
	bd.`node_id`,
	bd.`json`,
	COALESCE(bi.`filename`, 'unknown'),
	bd.`backup_ct`,
	bd.`backup_lm`,
	bd.`system_from`,
	bd.`system_to`
FROM `backup_data_old` bd
LEFT JOIN `backup_imports` bi ON date(bd.`backup_file_date`, 'unixepoch') = bi.`backup_date`
	AND bi.`system_to` = '9999-12-31 23:59:59';
--> statement-breakpoint
-- Drop old table
DROP TABLE `backup_data_old`;
--> statement-breakpoint
-- Create index
CREATE INDEX `backup_data_system_from_idx` ON `backup_data` (`node_id`,`system_from`);
