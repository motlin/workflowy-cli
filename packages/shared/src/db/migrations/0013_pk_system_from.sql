-- Migration: Change primary keys from (id, system_to) to (id, system_from)
-- and replace *_system_from_idx indexes with *_system_to_idx indexes
--
-- SQLite doesn't support ALTER PRIMARY KEY, so we recreate each table.
-- The pattern for each table is:
-- 1. Create new table with new primary key
-- 2. Copy data from old table
-- 3. Drop old table
-- 4. Rename new table
-- 5. Create new indexes

-- ============================================================================
-- nodes table
-- ============================================================================
CREATE TABLE `nodes_new` (
	`id` text NOT NULL,
	`name` text,
	`note` text,
	`parent_id` text,
	`priority` integer,
	`created_at` integer,
	`modified_at` integer,
	`completed_at` integer,
	`layout_mode` text,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `nodes_new` SELECT `id`, `name`, `note`, `parent_id`, `priority`, `created_at`, `modified_at`, `completed_at`, `layout_mode`, `original_id`, `system_from`, `system_to` FROM `nodes`;
--> statement-breakpoint
DROP TABLE `nodes`;
--> statement-breakpoint
ALTER TABLE `nodes_new` RENAME TO `nodes`;
--> statement-breakpoint
CREATE INDEX `nodes_system_to_idx` ON `nodes` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `parent_idx` ON `nodes` (`parent_id`,`id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- api_data table
-- ============================================================================
CREATE TABLE `api_data_new` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`priority` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `api_data_new` SELECT * FROM `api_data`;
--> statement-breakpoint
DROP TABLE `api_data`;
--> statement-breakpoint
ALTER TABLE `api_data_new` RENAME TO `api_data`;
--> statement-breakpoint
CREATE INDEX `api_data_system_to_idx` ON `api_data` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- backup_data table
-- ============================================================================
CREATE TABLE `backup_data_new` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`backup_import_filename` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `backup_data_new` SELECT * FROM `backup_data`;
--> statement-breakpoint
DROP TABLE `backup_data`;
--> statement-breakpoint
ALTER TABLE `backup_data_new` RENAME TO `backup_data`;
--> statement-breakpoint
CREATE INDEX `backup_data_system_to_idx` ON `backup_data` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- node_embeddings table
-- ============================================================================
CREATE TABLE `node_embeddings_new` (
	`node_id` text NOT NULL,
	`model` text DEFAULT 'minilm' NOT NULL,
	`embedding` blob NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `model`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `node_embeddings_new` SELECT * FROM `node_embeddings`;
--> statement-breakpoint
DROP TABLE `node_embeddings`;
--> statement-breakpoint
ALTER TABLE `node_embeddings_new` RENAME TO `node_embeddings`;
--> statement-breakpoint
CREATE INDEX `node_embeddings_system_to_idx` ON `node_embeddings` (`node_id`,`model`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- mirrors table
-- ============================================================================
CREATE TABLE `mirrors_new` (
	`node_id` text NOT NULL,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `mirrors_new` SELECT `node_id`, `original_id`, `system_from`, `system_to` FROM `mirrors`;
--> statement-breakpoint
DROP TABLE `mirrors`;
--> statement-breakpoint
ALTER TABLE `mirrors_new` RENAME TO `mirrors`;
--> statement-breakpoint
CREATE INDEX `mirrors_system_to_idx` ON `mirrors` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `mirrors_original_id_idx` ON `mirrors` (`original_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- mirror_root_ids table
-- ============================================================================
CREATE TABLE `mirror_root_ids_new` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`mirror_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `mirror_root_ids_new` SELECT * FROM `mirror_root_ids`;
--> statement-breakpoint
DROP TABLE `mirror_root_ids`;
--> statement-breakpoint
ALTER TABLE `mirror_root_ids_new` RENAME TO `mirror_root_ids`;
--> statement-breakpoint
CREATE INDEX `mirror_root_ids_system_to_idx` ON `mirror_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `mirror_root_ids_node_idx` ON `mirror_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- backlink_mirror_root_ids table
-- ============================================================================
CREATE TABLE `backlink_mirror_root_ids_new` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`backlink_mirror_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `backlink_mirror_root_ids_new` SELECT * FROM `backlink_mirror_root_ids`;
--> statement-breakpoint
DROP TABLE `backlink_mirror_root_ids`;
--> statement-breakpoint
ALTER TABLE `backlink_mirror_root_ids_new` RENAME TO `backlink_mirror_root_ids`;
--> statement-breakpoint
CREATE INDEX `backlink_mirror_root_ids_system_to_idx` ON `backlink_mirror_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlink_mirror_root_ids_node_idx` ON `backlink_mirror_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- backlinks table
-- ============================================================================
CREATE TABLE `backlinks_new` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `backlinks_new` SELECT * FROM `backlinks`;
--> statement-breakpoint
DROP TABLE `backlinks`;
--> statement-breakpoint
ALTER TABLE `backlinks_new` RENAME TO `backlinks`;
--> statement-breakpoint
CREATE INDEX `backlinks_system_to_idx` ON `backlinks` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_node_idx` ON `backlinks` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_source_idx` ON `backlinks` (`source_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_target_idx` ON `backlinks` (`target_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- virtual_root_ids table
-- ============================================================================
CREATE TABLE `virtual_root_ids_new` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`virtual_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `virtual_root_ids_new` SELECT * FROM `virtual_root_ids`;
--> statement-breakpoint
DROP TABLE `virtual_root_ids`;
--> statement-breakpoint
ALTER TABLE `virtual_root_ids_new` RENAME TO `virtual_root_ids`;
--> statement-breakpoint
CREATE INDEX `virtual_root_ids_system_to_idx` ON `virtual_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `virtual_root_ids_node_idx` ON `virtual_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- ai_metadata table
-- ============================================================================
CREATE TABLE `ai_metadata_new` (
	`node_id` text NOT NULL,
	`in_chat` integer NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `ai_metadata_new` SELECT * FROM `ai_metadata`;
--> statement-breakpoint
DROP TABLE `ai_metadata`;
--> statement-breakpoint
ALTER TABLE `ai_metadata_new` RENAME TO `ai_metadata`;
--> statement-breakpoint
CREATE INDEX `ai_metadata_system_to_idx` ON `ai_metadata` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- s3_files table
-- ============================================================================
CREATE TABLE `s3_files_new` (
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
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `s3_files_new` SELECT `node_id`, `file_name`, `file_type`, `object_folder`, `is_animated_gif`, `image_original_width`, `image_original_height`, `image_original_pixels`, `system_from`, `system_to` FROM `s3_files`;
--> statement-breakpoint
DROP TABLE `s3_files`;
--> statement-breakpoint
ALTER TABLE `s3_files_new` RENAME TO `s3_files`;
--> statement-breakpoint
CREATE INDEX `s3_files_system_to_idx` ON `s3_files` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- changes_metadata table
-- ============================================================================
CREATE TABLE `changes_metadata_new` (
	`node_id` text NOT NULL,
	`ct_by` integer NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `changes_metadata_new` SELECT * FROM `changes_metadata`;
--> statement-breakpoint
DROP TABLE `changes_metadata`;
--> statement-breakpoint
ALTER TABLE `changes_metadata_new` RENAME TO `changes_metadata`;
--> statement-breakpoint
CREATE INDEX `changes_metadata_system_to_idx` ON `changes_metadata` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- references_roots table
-- ============================================================================
CREATE TABLE `references_roots_new` (
	`node_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `references_roots_new` SELECT * FROM `references_roots`;
--> statement-breakpoint
DROP TABLE `references_roots`;
--> statement-breakpoint
ALTER TABLE `references_roots_new` RENAME TO `references_roots`;
--> statement-breakpoint
CREATE INDEX `references_roots_system_to_idx` ON `references_roots` (`node_id`,`system_to`);
--> statement-breakpoint

-- ============================================================================
-- backup_imports table
-- ============================================================================
CREATE TABLE `backup_imports_new` (
	`filename` text NOT NULL,
	`backup_date` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`filename`, `system_from`)
);
--> statement-breakpoint
INSERT INTO `backup_imports_new` SELECT * FROM `backup_imports`;
--> statement-breakpoint
DROP TABLE `backup_imports`;
--> statement-breakpoint
ALTER TABLE `backup_imports_new` RENAME TO `backup_imports`;
--> statement-breakpoint
CREATE INDEX `backup_imports_system_to_idx` ON `backup_imports` (`filename`,`system_to`);
