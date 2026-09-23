set lock_timeout = '2s';
set statement_timeout = '60s';

create table upl_packages (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid(),       -- идентификатор в API и package_ref загрузки основы
  source_id bigint not null references upl_sources (id),
  format_version integer not null,                          -- версия анкеты, действовавшая на period_from
  period_from date not null,
  period_to date not null,
  file_id uuid not null references mf_files (id),           -- без каскада: исходный файл не удаляется
  file_name text not null,
  file_sha256 text not null,
  file_size_bytes bigint not null,
  status text not null default 'received',
  rows_total integer,
  rows_accepted integer,
  rows_rejected integer,
  errors_total integer,                                     -- число записей об ошибках всего (в таблице ошибок — первые 500)
  reject_code text,                                         -- причина «отклонён системой»
  reject_params jsonb,
  load_id bigint,                                           -- номер загрузки основы (выдаёт FndLoadService), заполняет следующий инкремент
  raw_rows integer,                                         -- строк в raw по итогам сверки, заполняет следующий инкремент
  uploaded_at timestamptz not null default now(),
  uploaded_by_id bigint not null,                           -- md_users.id
  uploaded_by text not null,                                -- имя актора основы, как created_by в upl_sources
  modified_at timestamptz not null default now(),
  foreign key (source_id, format_version) references upl_format_versions (source_id, version),
  constraint upl_packages_uk_public_id unique (public_id),
  constraint upl_packages_ck_status check (status in ('received','rejected','verified','applied')),
  constraint upl_packages_ck_period check (period_from <= period_to),
  constraint upl_packages_ck_sha check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint upl_packages_ck_rows check (rows_total is null or rows_total = rows_accepted + rows_rejected),
  constraint upl_packages_ck_reject check ((status = 'rejected') = (reject_code is not null)),
  constraint upl_packages_ck_applied check (status <> 'applied' or (load_id is not null and raw_rows is not null))
);
create index upl_packages_source_idx on upl_packages (source_id, period_from);

create table upl_package_errors (
  id bigint generated always as identity primary key,
  package_id bigint not null references upl_packages (id) on delete cascade,
  ordinal integer not null,                                 -- порядок «лист анкеты → строка → колонка», 1…500
  sheet text not null,
  row_no integer,                                           -- № строки как в Excel; null — расхождение с анкетой (не ячейка)
  column_name text,                                         -- колонка как в файле; null — «нет листа»
  cell_value text,                                          -- значение как в файле, не длиннее 200 знаков; null — пусто
  code text not null,
  params jsonb not null default '{}'::jsonb,
  constraint upl_package_errors_uq_ordinal unique (package_id, ordinal),
  constraint upl_package_errors_ck_ordinal check (ordinal between 1 and 500)
);

select fnd_audit_enable('upl_packages', 'id');
select fnd_audit_enable('upl_package_errors', 'id');
