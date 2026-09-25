set lock_timeout = '2s';
set statement_timeout = '60s';
-- Отчёты (rpt), И15б «Вторая мера и отношение»: у меры 1 — своё название и период колонками-месяцами, мера 2 — отдельная таблица.
-- destructive: approved
-- reason: rpt_reports_ck_measure заменяется более широкой rpt_reports_ck_period (добавлен вид меры months); данные не меняются,
--         каждая существующая строка (date_field + total/count) проходит новую проверку; date_field становится необязательным.
-- approved_by: архитектор (основная сессия), 2026-09-24

alter table rpt_reports add column measure_name text;           -- null — прежняя подпись (подпись колонки меры или «Число строк»)
alter table rpt_reports add column month_fields text[];         -- 12 элементов, null-элемент — месяца нет; null — период по date_field
alter table rpt_reports alter column date_field drop not null;
alter table rpt_reports drop constraint rpt_reports_ck_measure;
alter table rpt_reports add constraint rpt_reports_ck_period check (
  (date_field is not null and month_fields is null
     and ((measure_kind = 'total' and measure_field is not null) or (measure_kind = 'count' and measure_field is null)))
  or (date_field is null and month_fields is not null and cardinality(month_fields) = 12
     and measure_kind = 'months' and measure_field is null));
alter table rpt_reports add constraint rpt_reports_ck_measure_name check (measure_name is null or length(btrim(measure_name)) between 1 and 100);

-- Мера 2: свой источник, период, мера, справочник и уровни; строки отчёта склеиваются по названиям уровней
create table rpt_report_measures2 (
  report_id bigint primary key references rpt_reports (id) on delete cascade,
  name text not null,
  source_id bigint not null references upl_sources (id),
  source_sheet integer not null,                  -- ordinal листа анкеты источника
  date_field text,                                -- колонка-дата; null — период колонками-месяцами
  month_fields text[],                            -- 12 элементов, null-элемент — месяца нет
  measure_kind text not null,                     -- total — сумма колонки; count — число строк; months — сумма колонок-месяцев
  measure_field text,
  divisor integer not null default 1,
  decimals integer not null default 2,
  ref_source_id bigint references upl_sources (id),
  ref_sheet integer,
  key1_field text, key1_ref_field text,
  key2_field text, key2_ref_field text,
  level1_origin text not null,
  level1_field text not null,
  level2_origin text,
  level2_field text,
  created_at timestamptz not null default now(), created_by text not null,
  modified_at timestamptz not null default now(), modified_by text not null,
  constraint rpt_m2_ck_name check (length(btrim(name)) between 1 and 100),
  constraint rpt_m2_ck_period check (
    (date_field is not null and month_fields is null
       and ((measure_kind = 'total' and measure_field is not null) or (measure_kind = 'count' and measure_field is null)))
    or (date_field is null and month_fields is not null and cardinality(month_fields) = 12
       and measure_kind = 'months' and measure_field is null)),
  constraint rpt_m2_ck_divisor check (divisor in (1, 1000, 1000000)),
  constraint rpt_m2_ck_decimals check (decimals between 0 and 3),
  constraint rpt_m2_ck_ref check ((ref_source_id is null and ref_sheet is null and key1_field is null and key1_ref_field is null
                                   and key2_field is null and key2_ref_field is null)
                               or (ref_source_id is not null and ref_sheet is not null
                                   and key1_field is not null and key1_ref_field is not null
                                   and (key2_field is null) = (key2_ref_field is null))),
  constraint rpt_m2_ck_level1 check (level1_origin in ('source', 'ref') and (level1_origin = 'source' or ref_source_id is not null)),
  constraint rpt_m2_ck_level2 check ((level2_origin is null and level2_field is null)
                                  or (level2_origin in ('source', 'ref') and level2_field is not null
                                      and (level2_origin = 'source' or ref_source_id is not null)))
);

select fnd_audit_enable('rpt_report_measures2', 'report_id');
