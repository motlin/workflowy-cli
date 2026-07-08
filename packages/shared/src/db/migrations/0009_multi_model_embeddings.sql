-- Rename existing embedding column to reflect the MiniLM model that created it
ALTER TABLE `node_embeddings` RENAME COLUMN `embedding` TO `embedding_minilm_l6_v2`;--> statement-breakpoint
-- Add new column for BGE embeddings (768 dimensions)
ALTER TABLE `node_embeddings` ADD `embedding_bge_base_en_v1_5` blob;
