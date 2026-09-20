set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), pg-dwh: тип ссылки на файл выравнивается с каркасом.
-- mf_files.id каркаса — uuid, а V001 объявила raw.rows.source_file_id как bigint:
-- сверка «строка raw — файл» (AC-31) сравнивала бы разные типы.
-- FK между базами нет и быть не может (02 п.18), поэтому только тип колонки.
-- destructive: approved
-- reason: колонка заведена в этой же фиче, данных в pg-dwh ещё нет; иначе сверка raw с mf_files невозможна
-- approved_by: архитектор (решение 09.09.2026)

alter table raw.rows alter column source_file_id type uuid using source_file_id::text::uuid;
comment on column raw.rows.source_file_id is 'mf_files.id каркаса в OLTP; FK между базами нет (02 п.18)';
