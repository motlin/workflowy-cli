-- Migration: Move is_references_root from nodes to separate references_roots table
-- Reason: Only 27 rows have is_references_root=1 out of 107,996 nodes (0.025%)
-- Per the <50% normalization rule, sparse data should be in separate tables

-- Step 1: Create new temporal table references_roots
CREATE TABLE `references_roots` (
	`node_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `references_roots_system_from_idx` ON `references_roots` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `references_roots_current_idx` ON `references_roots` (`node_id`,`system_to`);
--> statement-breakpoint
-- Step 2: INSERT into references_roots from nodes WHERE is_references_root=1
INSERT INTO `references_roots` (`node_id`, `system_from`, `system_to`)
SELECT `id`, `system_from`, `system_to`
FROM `nodes`
WHERE `is_references_root` = 1;
--> statement-breakpoint
-- Step 3: ALTER TABLE nodes to remove is_references_root column (rename, create, copy, drop pattern)
-- Rename old table
ALTER TABLE `nodes` RENAME TO `nodes_old`;
--> statement-breakpoint
-- Create new table without is_references_root column
CREATE TABLE `nodes` (
	`id` text NOT NULL,
	`name` text,
	`note` text,
	`parent_id` text,
	`created_at` integer,
	`modified_at` integer,
	`completed_at` integer,
	`layout_mode` text,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
-- Copy data (omitting is_references_root)
INSERT INTO `nodes` (`id`, `name`, `note`, `parent_id`, `created_at`, `modified_at`, `completed_at`, `layout_mode`, `original_id`, `system_from`, `system_to`)
SELECT
	`id`,
	`name`,
	`note`,
	`parent_id`,
	`created_at`,
	`modified_at`,
	`completed_at`,
	`layout_mode`,
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
