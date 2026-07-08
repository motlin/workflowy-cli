-- Migration: Drop deprecated nodes table
-- Reason: All code has been migrated to use node_content and node_metadata tables
-- The nodes table is redundant and can be safely removed

DROP TABLE IF EXISTS `nodes`;
