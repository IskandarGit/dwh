set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), починка после tester круг 1 (10.09.2026): S-3 и S-4 отчёта.
-- Файлы V100–V106 не правятся: стенд уже мигрирован (AC-3 — только expand поверх).
-- destructive: approved
-- reason: (S-3) base_unit_code обязателен — единица без базовой давала toBase «тождество» без коэффициента (AC-18, AC-22);
--         (S-4) индекс на audit_log каркаса переименован с префиксом fnd_, чтобы имя не столкнулось с будущим индексом upstream.
-- approved_by: архитектор (основная сессия), 2026-09-10
-- Строк с пустой base_unit_code быть не должно (registerUnit всегда требует базовую); если они есть —
-- миграция падает намеренно, данные экземпляра чинит владелец экземпляра, не ядро.

alter table fnd_units alter column base_unit_code set not null;
comment on column fnd_units.base_unit_code is 'Базовая единица (обязательна); базовая ссылается сама на себя';

drop index if exists audit_log_table_row_idx;
create index if not exists fnd_audit_log_table_row_idx on audit_log (table_name, row_pk, changed_at desc);
