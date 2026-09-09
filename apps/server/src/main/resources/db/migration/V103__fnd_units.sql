set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), блок D: единицы хранения и датированные коэффициенты (18 п.14; 13 инв.3; AC-18…AC-24).
-- Ядро не знает ни одной единицы: и единицы, и коэффициенты — данные экземпляра, заводятся через
-- FndUnitService. Коэффициент версионируется общим стандартом блока C (доп.4).

create table fnd_units (
    id             bigserial   primary key,
    code           text        not null,
    name_i18n      jsonb       not null,
    base_unit_code text,
    created_at     timestamptz not null default now(),
    constraint fnd_units_uk_code unique (code),
    constraint fnd_units_fk_base_unit foreign key (base_unit_code) references fnd_units (code),
    -- Код единицы: 1–32 символа латиницей/цифрами и . _ - (доп.13); пробелов нет
    constraint fnd_units_ck_code check (code ~ '^[A-Za-z0-9_.\-]{1,32}$'),
    -- Имя обязательно на узбекском: язык экземпляра (18 п.1)
    constraint fnd_units_ck_name_uz check (name_i18n ? 'uz' and length(btrim(name_i18n ->> 'uz')) > 0)
);
comment on table fnd_units is 'Единицы измерения экземпляра; base_unit_code — базовая единица (13 инв.3)';
comment on column fnd_units.base_unit_code is 'Базовая единица ссылается сама на себя';

create table fnd_unit_coefficients (
    id         bigserial   primary key,
    from_unit  text        not null,
    to_unit    text        not null,
    created_at timestamptz not null default now(),
    constraint fnd_unit_coefficients_uk_pair unique (from_unit, to_unit),
    constraint fnd_unit_coefficients_fk_from foreign key (from_unit) references fnd_units (code),
    constraint fnd_unit_coefficients_fk_to foreign key (to_unit) references fnd_units (code),
    constraint fnd_unit_coefficients_ck_distinct check (from_unit <> to_unit)
);
comment on table fnd_unit_coefficients is
    'Заголовок коэффициента пересчёта from_unit -> to_unit; значение датировано в версиях (доп.4, доп.5)';

create table fnd_unit_coefficient_versions (
    coefficient_id bigint      not null,
    version        integer     not null,
    factor         numeric,
    valid_from     date        not null,
    valid_to       date,
    status         text        not null default 'draft',
    published_at   timestamptz,
    published_by   text,
    lock_version   integer     not null default 0,
    primary key (coefficient_id, version),
    constraint fnd_unit_coefficient_versions_fk_coefficient
        foreign key (coefficient_id) references fnd_unit_coefficients (id),
    -- Множитель строго положительный; у черновика он ещё может быть не задан
    constraint fnd_unit_coefficient_versions_ck_factor_positive check (factor is null or factor > 0)
);
comment on column fnd_unit_coefficient_versions.factor is
    'Множитель numeric без округления: значение в from_unit * factor = значение в to_unit';

-- Стандарт версий блока C: ck_valid_order, ck_version_positive, ck_status, ex_valid и оба триггера
select fnd_versioning_enable('fnd_unit_coefficient_versions', 'coefficient_id');

-- Изменения справочников экземпляра идут в audit_log каркаса (AC-6)
select fnd_audit_enable('fnd_units', 'id');
select fnd_audit_enable('fnd_unit_coefficients', 'id');
select fnd_audit_enable('fnd_unit_coefficient_versions', 'coefficient_id');
