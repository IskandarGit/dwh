-- V031__task_query_performance_indexes.sql
-- Optimizing task querying by user participation and deadline ranges

-- Index on ms_task_members for user-assigned and involve_kind filtering
create index if not exists idx_ms_task_members_user_involve on ms_task_members (user_id, involve_kind);

-- Index on ms_tasks for end_time range and overdue queries
create index if not exists idx_ms_tasks_end_time on ms_tasks (end_time) where (end_time is not null);

-- Index on ms_tasks for reporter / creator queries
create index if not exists idx_ms_tasks_reporter_created on ms_tasks (reporter_id, created_by);
