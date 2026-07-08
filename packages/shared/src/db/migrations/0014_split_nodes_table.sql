-- Migration: Split nodes table into node_content and node_metadata
--
-- Purpose: Separate content (affects embeddings) from metadata (doesn't affect embeddings)
-- so that priority changes don't trigger unnecessary embedding regeneration.
--
-- node_content: id, name, note, parentId (affects embeddings)
-- node_metadata: priority, createdAt, modifiedAt, completedAt, layoutMode, originalId (no embedding impact)

CREATE TABLE `node_content` (
	`id` text NOT NULL,
	`name` text,
	`note` text,
	`parent_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
CREATE INDEX `node_content_system_to_idx` ON `node_content` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `node_content_parent_idx` ON `node_content` (`parent_id`,`id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `node_metadata` (
	`node_id` text NOT NULL,
	`priority` integer,
	`created_at` integer,
	`modified_at` integer,
	`completed_at` integer,
	`layout_mode` text,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
CREATE INDEX `node_metadata_system_to_idx` ON `node_metadata` (`node_id`,`system_to`);
--> statement-breakpoint
INSERT INTO `node_content` (`id`, `name`, `note`, `parent_id`, `system_from`, `system_to`)
SELECT `id`, `name`, `note`, `parent_id`, `system_from`, `system_to` FROM `nodes`;
--> statement-breakpoint
INSERT INTO `node_metadata` (`node_id`, `priority`, `created_at`, `modified_at`, `completed_at`, `layout_mode`, `original_id`, `system_from`, `system_to`)
SELECT `id`, `priority`, `created_at`, `modified_at`, `completed_at`, `layout_mode`, `original_id`, `system_from`, `system_to` FROM `nodes`;
