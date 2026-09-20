set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), блок E: версии загрузок и журнал (11 п.6, п.8; 18 п.4, п.14; AC-25…AC-32).
-- fnd_loads.id — единый номер версии загрузки (load_id): им помечены строки raw в pg-dwh
-- и он же попадает в cache.items.load_versions (AC-30). Своих sequence у модулей нет.
-- Состав колонок fnd_loads закреплён 18 п.14 и проверяется тестом AC-44: канальной специфики
-- (offset, тип канала, имя файла) здесь быть не должно — файл хранит модуль mf каркаса.

create table fnd_loads (
    id             bigserial primary key,
    source_code    text        not null,
    package_ref    uuid        not null,
    period_from    date        not null,
    period_to      date        not null,
    format_version text        not null,
    applied_at     timestamptz,
    applied_by     text,
    rows_total     integer,
    rows_accepted  integer,
    rows_rejected  integer,
    status         text        not null default 'pending',
    superseded_by  bigint,
    constraint fnd_loads_uk_package_ref unique (package_ref),
    -- pending — из протокола применения 11 п.6 (доп.1)
    constraint fnd_loads_ck_status check (status in ('pending', 'applied', 'failed', 'superseded')),
    constraint fnd_loads_ck_rows check (
        rows_total is null
        or (rows_accepted is not null and rows_rejected is not null
            and rows_accepted >= 0 and rows_rejected >= 0
            and rows_accepted + rows_rejected = rows_total)),
    constraint fnd_loads_ck_period check (period_from <= period_to),
    constraint fnd_loads_fk_superseded_by foreign key (superseded_by) references fnd_loads (id)
);
comment on table fnd_loads is 'Версии загрузок: id = load_id, единый номер версии данных источника (11 п.6, п.10)';
comment on column fnd_loads.applied_by is 'Кто применил: id пользователя как текст или system (AC-32)';

create index fnd_loads_source_period_idx on fnd_loads (source_code, period_from, period_to);
create index fnd_loads_status_idx on fnd_loads (status);

create table fnd_load_log (
    id          bigserial primary key,
    package_ref uuid        not null,
    load_id     bigint,
    event       text        not null,
    from_status text,
    to_status   text,
    actor       text        not null,
    note        text,
    file_sha    text,
    at          timestamptz not null default now(),
    constraint fnd_load_log_fk_load foreign key (load_id) references fnd_loads (id),
    constraint fnd_load_log_ck_actor check (length(btrim(actor)) > 0),
    constraint fnd_load_log_ck_file_sha check (file_sha is null or file_sha ~ '^[0-9a-f]{64}$')
);
comment on table fnd_load_log is
    'Журнал пакета: получен → проверен → одобрен → применён; строки только добавляются (11 п.8)';
create index fnd_load_log_package_idx on fnd_load_log (package_ref, at);

-- Журнал только дополняется: правка и удаление возможны лишь в сессии обслуживания
-- (set_config(''dwh.maintenance'', ''on'', true)) — тот же порядок, что у audit_log каркаса.
create or replace function fnd_load_log_append_only() returns trigger
language plpgsql as $$
begin
    if coalesce(current_setting('dwh.maintenance', true), '') = 'on' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;
    raise exception 'fnd_load_log_append_only'
        using errcode = 'P0001', hint = 'журнал загрузок только дополняется';
end
$$;

create trigger fnd_load_log_append_only_trg
    before update or delete on fnd_load_log
    for each row execute function fnd_load_log_append_only();

-- Изменения версий загрузок видны в audit_log каркаса (AC-6, AC-32)
select fnd_audit_enable('fnd_loads', 'id');
