set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), починка после tester круг 2 (S-5).
-- S-5: параллельный createDraft одного заголовка мог оставить два черновика — проверка «черновик уже есть»
-- была обычным select без блокировки, а первичный ключ (заголовок, version) спасал только когда оба потока
-- посчитали один и тот же max+1. Правило «один черновик на заголовок» (доп.14) теперь держит база:
-- частичный уникальный индекс <таблица>_draft_uidx по колонке заголовка where status = 'draft'.
-- fnd_versioning_enable создаёт его для каждой новой таблицы версий; блок do ниже добавляет его таблицам,
-- объявленным до этой миграции (все строки fnd_versioned_tables — сегодня fnd_unit_coefficient_versions).
-- Только expand: таблицы каркаса не изменяются (AC-3); create or replace function и create index — не деструктивно.

create or replace function fnd_versioning_enable(p_versions regclass, p_header_column text) returns void
language plpgsql as $$
declare
    v_name text := p_versions::text;
begin
    insert into fnd_versioned_tables (table_name, header_column)
    values (v_name, p_header_column)
    on conflict (table_name) do update set header_column = excluded.header_column;

    execute format('alter table %s add constraint %I check (valid_to is null or valid_from <= valid_to)',
                   v_name, v_name || '_ck_valid_order');
    execute format('alter table %s add constraint %I check (version > 0)',
                   v_name, v_name || '_ck_version_positive');
    execute format('alter table %s add constraint %I check (status in (''draft'', ''published'', ''superseded''))',
                   v_name, v_name || '_ck_status');
    -- Интервалы published-версий одного заголовка не пересекаются; valid_to включительно (доп.3)
    execute format('alter table %s add constraint %I exclude using gist '
                   || '(%I with =, daterange(valid_from, valid_to, ''[]'') with &&) where (status = ''published'')',
                   v_name, v_name || '_ex_valid', p_header_column);
    -- Один черновик на заголовок (доп.14, S-5): нарушение переводит FndSqlErrors.translatingVersions в fnd_version_draft_exists
    execute format('create unique index %I on %s (%I) where status = ''draft''',
                   v_name || '_draft_uidx', v_name, p_header_column);

    execute format('create trigger %I before insert or update on %s for each row execute function bump_version(%L)',
                   v_name || '_bump_version', v_name, p_header_column);
    execute format('create trigger %I before update or delete on %s for each row execute function deny_update_published()',
                   v_name || '_deny_update_published', v_name);
end
$$;

-- Таблицы, объявленные до V109
do $$
declare
    r record;
begin
    for r in select table_name, header_column from fnd_versioned_tables loop
        execute format('create unique index if not exists %I on %s (%I) where status = ''draft''',
                       r.table_name || '_draft_uidx', r.table_name, r.header_column);
    end loop;
end
$$;
