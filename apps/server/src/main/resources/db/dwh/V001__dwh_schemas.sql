set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), pg-dwh: слои хранилища (промпт 11 п.6–7, п.10–11; 02 п.18; 18 п.14).
-- В pg-dwh нет аудита и FK на OLTP; таблиц с префиксами прикладных модулей здесь быть не должно.

create schema if not exists raw;
create schema if not exists core;
create schema if not exists mart;
create schema if not exists cache;

comment on schema raw  is 'Строки файлов как прочитаны; изменяются только записью новой загрузки (load_id = fnd_loads.id в OLTP)';
comment on schema core is 'Приведённые данные';
comment on schema mart is 'Витрины';
comment on schema cache is 'Кеш витрин по поколениям (11 п.10–11)';

-- raw: одна общая таблица строк на все источники [допущение архитектора, AC доп.10]:
-- раскладка скрыта за FndRawWriter, модули её не видят.
create table raw.rows (
    load_id         bigint       not null,
    source_file_id  bigint,
    row_no          bigint       not null,
    sheet           text,
    source_row_no   integer,
    fields          jsonb        not null,
    loaded_at       timestamptz  not null default now(),
    primary key (load_id, row_no)
);
comment on table raw.rows is 'Строки как в файле, без типизации; load_id — единый номер версии загрузки (fnd_loads.id)';

-- cache: поколения и элементы (11 п.10–11)
create table cache.generations (
    generation_id   bigserial    primary key,
    state           text         not null,
    load_versions   jsonb        not null,
    switched_at     timestamptz,
    created_at      timestamptz  not null default now(),
    constraint cache_generations_ck_state check (state in ('building', 'current', 'retired'))
);
create unique index cache_generations_uk_current on cache.generations (state) where state = 'current';
comment on column cache.generations.load_versions is 'Карта source_code -> fnd_loads.id, вошедшие в поколение';

create table cache.items (
    generation_id   bigint       not null references cache.generations (generation_id),
    item_key        text         not null,
    load_versions   jsonb        not null,
    payload         jsonb        not null,
    built_at        timestamptz  not null default now(),
    primary key (generation_id, item_key)
);
