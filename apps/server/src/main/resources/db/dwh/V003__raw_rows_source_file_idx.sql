set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), pg-dwh, починка после tester круг 1 (M-14): сверка «строка raw — файл mf_files» (AC-31,
-- FndXdbCheckJob) читает select distinct source_file_id из raw.rows — без индекса это seq scan по всему raw.
-- Частичный индекс: строки без файла (source_file_id is null) в сверке не участвуют.

create index raw_rows_source_file_idx on raw.rows (source_file_id) where source_file_id is not null;
