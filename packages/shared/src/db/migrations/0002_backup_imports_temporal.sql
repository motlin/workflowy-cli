-- Migration: Make backup_imports table temporal
-- Convert imported_at to system_from/system_to columns

-- Rename old table
ALTER TABLE `backup_imports` RENAME TO `backup_imports_old`;
--> statement-breakpoint
-- Create new table with temporal columns
CREATE TABLE `backup_imports` (
	`filename` text NOT NULL,
	`backup_date` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`filename`, `system_to`)
);
--> statement-breakpoint
-- Copy data, converting imported_at (unix timestamp) to ISO datetime for system_from
INSERT INTO `backup_imports` (`filename`, `backup_date`, `system_from`, `system_to`)
SELECT
	`filename`,
	`backup_date`,
	datetime(`imported_at`, 'unixepoch') || 'Z',
	'9999-12-31 23:59:59'
FROM `backup_imports_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `backup_imports_old`;
--> statement-breakpoint
-- Create index
CREATE INDEX `backup_imports_system_from_idx` ON `backup_imports` (`filename`,`system_from`);
