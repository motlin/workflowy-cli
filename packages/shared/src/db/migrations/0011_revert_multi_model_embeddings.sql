-- Revert the multi-column embedding design back to single column + model discriminator
-- The code uses nodeEmbeddings.embedding with a model column, not separate columns per model
ALTER TABLE `node_embeddings` DROP COLUMN `embedding_bge_base_en_v1_5`;--> statement-breakpoint
ALTER TABLE `node_embeddings` RENAME COLUMN `embedding_minilm_l6_v2` TO `embedding`;
