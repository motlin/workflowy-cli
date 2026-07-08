-- Migration: Remove is_file column from s3_files table
-- Reason: All 731 rows have is_file=1, so it carries no information (always true)

-- Rename old table
ALTER TABLE `s3_files` RENAME TO `s3_files_old`;
--> statement-breakpoint
-- Create new table without is_file column
CREATE TABLE `s3_files` (
	`node_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`object_folder` text,
	`is_animated_gif` integer,
	`image_original_width` integer,
	`image_original_height` integer,
	`image_original_pixels` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (omitting is_file)
INSERT INTO `s3_files` (`node_id`, `file_name`, `file_type`, `object_folder`, `is_animated_gif`, `image_original_width`, `image_original_height`, `image_original_pixels`, `system_from`, `system_to`)
SELECT
	`node_id`,
	`file_name`,
	`file_type`,
	`object_folder`,
	`is_animated_gif`,
	`image_original_width`,
	`image_original_height`,
	`image_original_pixels`,
	`system_from`,
	`system_to`
FROM `s3_files_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `s3_files_old`;
--> statement-breakpoint
-- Create indexes
CREATE INDEX `s3_files_system_from_idx` ON `s3_files` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `s3_files_current_idx` ON `s3_files` (`node_id`,`system_to`);
