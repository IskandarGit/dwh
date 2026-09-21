-- V034__task_revision_and_drop_duplicate_indexes.sql
-- 1. Add monotonic revision column to ms_tasks for optimistic concurrency control (A-03)
ALTER TABLE ms_tasks ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0);

-- 2. Drop confirmed duplicate B-tree indexes created in V016 (P-02)
-- Retaining ms_tasks_status_idx and ms_tasks_project_idx from V001
DROP INDEX IF EXISTS idx_ms_tasks_status_id;
DROP INDEX IF EXISTS idx_ms_tasks_project_id;
