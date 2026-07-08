-- Migration: Remove is_virtual_root column from nodes table
-- Reason: is_virtual_root=1 always correlates with original_id IS NOT NULL (362 rows)
-- Derivation: A node is a virtual root if and only if original_id IS NOT NULL

-- Rename old table
ALTER TABLE `nodes` RENAME TO `nodes_old`;
--> statement-breakpoint
-- Create new table without is_virtual_root column
CREATE TABLE `nodes` (
	`id` text NOT NULL,
	`name` text,
	`note` text,
	`parent_id` text,
	`created_at` integer,
	`modified_at` integer,
	`completed_at` integer,
	`layout_mode` text,
	`is_references_root` integer,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (omitting is_virtual_root)
INSERT INTO `nodes` (`id`, `name`, `note`, `parent_id`, `created_at`, `modified_at`, `completed_at`, `layout_mode`, `is_references_root`, `original_id`, `system_from`, `system_to`)
SELECT
	`id`,
	`name`,
	`note`,
	`parent_id`,
	`created_at`,
	`modified_at`,
	`completed_at`,
	`layout_mode`,
	`is_references_root`,
	`original_id`,
	`system_from`,
	`system_to`
FROM `nodes_old`;
--> statement-breakpoint
-- Drop old table
DROP TABLE `nodes_old`;
--> statement-breakpoint
-- Create indexes
CREATE INDEX `nodes_system_from_idx` ON `nodes` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `parent_idx` ON `nodes` (`parent_id`,`id`,`system_to`);
