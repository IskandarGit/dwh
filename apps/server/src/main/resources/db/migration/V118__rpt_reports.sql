set lock_timeout = '2s';
set statement_timeout = '60s';

-- Описание сводного отчёта: источник, период, мера, справочник, уровни строк. Поля — targetField анкеты, лист — порядковый номер листа анкеты
create table rpt_reports (
  id bigint generated always as identity primary key,
  name text not null,
  source_id bigint not null references upl_sources (id),
  source_sheet integer not null,                  -- ordinal листа анкеты источника
  date_field text not null,                       -- колонка-дата: период = месяц её значения
  measure_kind text not null default 'total',     -- total — сумма колонки меры; count — число строк
  measure_field text,                             -- числовая колонка; при count — null
  divisor integer not null default 1,             -- 1, 1000, 1000000
  decimals integer not null default 2,            -- знаков после запятой на экране
  ref_source_id bigint references upl_sources (id),  -- справочник; null — без справочника
  ref_sheet integer,
  key1_field text, key1_ref_field text,           -- пара «колонка данных ↔ колонка справочника»
  key2_field text, key2_ref_field text,           -- вторая пара, необязательна
  level1_origin text not null,                    -- source — колонка источника, ref — колонка справочника
  level1_field text not null,
  level2_origin text,                             -- null — один уровень
  level2_field text,
  lock_version integer not null default 0,
  created_at timestamptz not null default now(), created_by text not null,
  modified_at timestamptz not null default now(), modified_by text not null,
  constraint rpt_reports_ck_name check (length(btrim(name)) between 1 and 200),
  constraint rpt_reports_ck_measure check ((measure_kind = 'total' and measure_field is not null)
                                        or (measure_kind = 'count' and measure_field is null)),
  constraint rpt_reports_ck_divisor check (divisor in (1, 1000, 1000000)),
  constraint rpt_reports_ck_decimals check (decimals between 0 and 3),
  constraint rpt_reports_ck_ref check ((ref_source_id is null and ref_sheet is null and key1_field is null and key1_ref_field is null
                                        and key2_field is null and key2_ref_field is null)
                                    or (ref_source_id is not null and ref_sheet is not null
                                        and key1_field is not null and key1_ref_field is not null
                                        and (key2_field is null) = (key2_ref_field is null))),
  constraint rpt_reports_ck_level1 check (level1_origin in ('source', 'ref') and (level1_origin = 'source' or ref_source_id is not null)),
  constraint rpt_reports_ck_level2 check ((level2_origin is null and level2_field is null)
                                       or (level2_origin in ('source', 'ref') and level2_field is not null
                                           and (level2_origin = 'source' or ref_source_id is not null)))
);
create unique index rpt_reports_uk_name on rpt_reports (lower(btrim(name)));

select fnd_audit_enable('rpt_reports', 'id');
