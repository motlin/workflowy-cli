CREATE TABLE `calendar_metadata` (
	`node_id` text NOT NULL,
	`root` integer,
	`level` text,
	`levels` text,
	`value` text,
	`date_id` integer,
	`timestamp` integer,
	`found_dates` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
CREATE INDEX `calendar_metadata_system_to_idx` ON `calendar_metadata` (`node_id`,`system_to`);--> statement-breakpoint
DROP TABLE `api_data`;--> statement-breakpoint
DROP TABLE `backup_data`;--> statement-breakpoint
DROP INDEX `node_content_short_id_idx`;--> statement-breakpoint
DROP INDEX `node_content_parent_idx`;--> statement-breakpoint
DROP INDEX `node_content_system_to_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `node_content_parent_idx` ON `node_content` (`parent_id`,`system_from`,`system_to`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_content_system_to_idx` ON `node_content` (`id`,`system_to`);--> statement-breakpoint
ALTER TABLE `node_content` DROP COLUMN `short_id`;--> statement-breakpoint
ALTER TABLE `node_metadata` ADD `cp` integer;--> statement-breakpoint
ALTER TABLE `node_metadata` ADD `numbered_start` integer;
