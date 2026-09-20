-- V030__search_notes_and_phonetics.sql
-- Enable phonetic soundex and trigram matching extensions for fuzzy and transliterated search
create extension if not exists fuzzystrmatch;
create extension if not exists pg_trgm;

-- Trigram indexes for fast fallback fuzzy / substring search across entities
create index if not exists idx_ms_notes_title_trgm on ms_notes using gin (title gin_trgm_ops);
create index if not exists idx_ms_notes_content_trgm on ms_notes using gin (content_md gin_trgm_ops);
create index if not exists idx_ms_tasks_title_trgm on ms_tasks using gin (title gin_trgm_ops);
create index if not exists idx_ms_projects_name_trgm on ms_task_projects using gin (name gin_trgm_ops);
create index if not exists idx_md_users_name_trgm on md_users using gin (name gin_trgm_ops);
