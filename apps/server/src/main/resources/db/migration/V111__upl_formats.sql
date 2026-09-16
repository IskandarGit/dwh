set lock_timeout = '2s';
set statement_timeout = '60s';

create table upl_sources (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  owner_org text not null,
  owner_contact text,
  periodicity text not null,
  sla_days integer not null default 0,
  source_type text not null default 'file',
  reconciliation_strictness text not null default 'error',
  lock_version integer not null default 0,
  created_at timestamptz not null default now(), created_by text not null,
  modified_at timestamptz not null default now(), modified_by text not null,
  constraint upl_sources_ck_code check (code ~ '^[a-z][a-z0-9._-]{1,62}$'),
  constraint upl_sources_ck_name check (length(btrim(name)) between 1 and 200),
  constraint upl_sources_ck_periodicity check (periodicity in ('month','quarter','year','adhoc')),
  constraint upl_sources_ck_sla check (sla_days between 0 and 366),
  constraint upl_sources_ck_type check (source_type = 'file'),
  constraint upl_sources_ck_strictness check (reconciliation_strictness in ('error','warning'))
);
create unique index upl_sources_code_uidx on upl_sources (lower(code));

create table upl_format_versions (
  source_id bigint not null,
  version integer not null,
  valid_from date not null, valid_to date,
  status text not null default 'draft',
  published_at timestamptz, published_by text,
  lock_version integer not null default 0,
  file_kind text not null default 'xlsx',
  encoding text, delimiter text,
  match_columns_by text not null default 'header',
  primary key (source_id, version),
  constraint upl_format_versions_fk_source foreign key (source_id) references upl_sources (id),
  constraint upl_format_versions_ck_kind check (file_kind in ('xlsx','csv')),
  constraint upl_format_versions_ck_encoding check (encoding is null or encoding in ('utf-8','windows-1251')),
  constraint upl_format_versions_ck_delimiter check (delimiter is null or length(delimiter) = 1),
  constraint upl_format_versions_ck_match check (match_columns_by in ('header','position'))
);
select fnd_versioning_enable('upl_format_versions', 'source_id');

create table upl_format_sheets (
  id bigint generated always as identity primary key,
  source_id bigint not null, version integer not null,
  ordinal integer not null,
  sheet_name text,                 -- null только для csv (проверка публикации)
  header_row integer not null,     -- 1-based
  total_row_marker text,           -- null = итоговых строк нет
  foreign key (source_id, version) references upl_format_versions (source_id, version) on delete cascade,
  constraint upl_format_sheets_ck_ordinal check (ordinal > 0),
  constraint upl_format_sheets_ck_header_row check (header_row > 0),
  constraint upl_format_sheets_uq_ordinal unique (source_id, version, ordinal)
);

create table upl_format_columns (
  id bigint generated always as identity primary key,
  sheet_id bigint not null references upl_format_sheets (id) on delete cascade,
  ordinal integer not null,
  file_position integer,           -- номер колонки в файле (1-based), обязателен при match_columns_by = position
  name_in_file text not null,
  target_field text not null,
  data_type text not null,
  required boolean not null default false,
  source_unit text, base_unit text, -- коды fnd_units, только integer|number
  key_mask text, key_pad_length integer, key_pad_max integer, -- только object_key
  ref_book_code text,              -- только ref_code
  constraint upl_format_columns_ck_ordinal check (ordinal > 0),
  constraint upl_format_columns_ck_position check (file_position is null or file_position > 0),
  constraint upl_format_columns_ck_name check (length(btrim(name_in_file)) between 1 and 200),
  constraint upl_format_columns_ck_target check (target_field ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint upl_format_columns_ck_type check (data_type in ('text','integer','number','date','object_key','ref_code')),
  constraint upl_format_columns_ck_pad check (key_pad_length is null or key_pad_length > 0),
  constraint upl_format_columns_ck_pad_max check (key_pad_max is null or key_pad_max > 0),
  constraint upl_format_columns_uq_ordinal unique (sheet_id, ordinal)
);

-- Листы и колонки опубликованной версии неизменны; правка возможна лишь в сессии обслуживания
-- (dwh.maintenance = on) — тот же порядок, что у журнала загрузок основы (V104).
create or replace function upl_format_children_guard() returns trigger
language plpgsql as $$
declare
    v_row record;
    v_status text;
begin
    if coalesce(current_setting('dwh.maintenance', true), '') = 'on' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;
    if tg_op = 'DELETE' then
        v_row := old;
    else
        v_row := new;
    end if;
    if tg_table_name = 'upl_format_sheets' then
        select fv.status into v_status from upl_format_versions fv
         where fv.source_id = v_row.source_id and fv.version = v_row.version;
    else
        select fv.status into v_status from upl_format_sheets s
          join upl_format_versions fv on fv.source_id = s.source_id and fv.version = s.version
         where s.id = v_row.sheet_id;
    end if;
    if v_status is not null and v_status <> 'draft' then
        raise exception 'upl_format_not_draft' using errcode = 'P0001';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end
$$;

create trigger upl_format_sheets_guard before insert or update or delete on upl_format_sheets
    for each row execute function upl_format_children_guard();
create trigger upl_format_columns_guard before insert or update or delete on upl_format_columns
    for each row execute function upl_format_children_guard();

-- Изменения анкеты идут в audit_log каркаса (AC-6)
select fnd_audit_enable('upl_sources', 'id');
select fnd_audit_enable('upl_format_versions', 'source_id');
select fnd_audit_enable('upl_format_sheets', 'id');
select fnd_audit_enable('upl_format_columns', 'id');
