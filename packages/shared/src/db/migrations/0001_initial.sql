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
	`is_virtual_root` integer,
	`original_id` text,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `nodes_system_from_idx` ON `nodes` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `parent_idx` ON `nodes` (`parent_id`,`id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `api_data` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`priority` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `api_data_system_from_idx` ON `api_data` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE TABLE `backup_data` (
	`node_id` text NOT NULL,
	`json` text NOT NULL,
	`imported_at` integer NOT NULL,
	`backup_file_date` integer,
	`backup_ct` integer,
	`backup_lm` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `backup_data_system_from_idx` ON `backup_data` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE TABLE `node_embeddings` (
	`node_id` text NOT NULL,
	`model` text DEFAULT 'minilm' NOT NULL,
	`embedding` blob NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `model`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `node_embeddings_system_from_idx` ON `node_embeddings` (`node_id`,`model`,`system_from`);
--> statement-breakpoint
CREATE TABLE `mirrors` (
	`node_id` text NOT NULL,
	`original_id` text,
	`is_mirror_root` integer,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `mirrors_system_from_idx` ON `mirrors` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `mirrors_current_records_idx` ON `mirrors` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `mirrors_original_id_idx` ON `mirrors` (`original_id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `mirror_root_ids` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`mirror_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `mirror_root_ids_system_from_idx` ON `mirror_root_ids` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `mirror_root_ids_node_idx` ON `mirror_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `mirror_root_ids_current_idx` ON `mirror_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `backlink_mirror_root_ids` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`backlink_mirror_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `backlink_mirror_root_ids_system_from_idx` ON `backlink_mirror_root_ids` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `backlink_mirror_root_ids_node_idx` ON `backlink_mirror_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlink_mirror_root_ids_current_idx` ON `backlink_mirror_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `backlinks` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `backlinks_system_from_idx` ON `backlinks` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `backlinks_node_idx` ON `backlinks` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_current_idx` ON `backlinks` (`id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_source_idx` ON `backlinks` (`source_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `backlinks_target_idx` ON `backlinks` (`target_id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `virtual_root_ids` (
	`id` integer NOT NULL,
	`node_id` text NOT NULL,
	`virtual_root_id` text NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `virtual_root_ids_system_from_idx` ON `virtual_root_ids` (`id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `virtual_root_ids_node_idx` ON `virtual_root_ids` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE INDEX `virtual_root_ids_current_idx` ON `virtual_root_ids` (`id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `ai_metadata` (
	`node_id` text NOT NULL,
	`in_chat` integer NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `ai_metadata_system_from_idx` ON `ai_metadata` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `ai_metadata_current_idx` ON `ai_metadata` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `s3_files` (
	`node_id` text NOT NULL,
	`is_file` integer NOT NULL,
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
CREATE INDEX `s3_files_system_from_idx` ON `s3_files` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `s3_files_current_idx` ON `s3_files` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `changes_metadata` (
	`node_id` text NOT NULL,
	`ct_by` integer NOT NULL,
	`system_from` text NOT NULL,
	`system_to` text NOT NULL,
	PRIMARY KEY(`node_id`, `system_to`)
);
--> statement-breakpoint
CREATE INDEX `changes_metadata_system_from_idx` ON `changes_metadata` (`node_id`,`system_from`);
--> statement-breakpoint
CREATE INDEX `changes_metadata_current_idx` ON `changes_metadata` (`node_id`,`system_to`);
--> statement-breakpoint
CREATE TABLE `backup_imports` (
	`filename` text PRIMARY KEY NOT NULL,
	`backup_date` text NOT NULL,
	`imported_at` integer NOT NULL
);
