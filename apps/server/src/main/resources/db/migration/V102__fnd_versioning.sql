set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), блок C: версионность с датой действия (02 п.17; 18 доп.1; AC-10…AC-17).
-- Один стандарт на все модули DW: колонки, ограничения, триггеры и функция «версия на дату».
-- Модуль объявляет свою таблицу версий вызовом fnd_versioning_enable(<таблица версий>, <колонка заголовка>);
-- сами колонки (version, valid_from, valid_to, status, published_at, published_by, lock_version)
-- и первичный ключ (<заголовок>, version) создаёт миграция модуля — стандарт их только обвязывает.
-- Только expand: таблицы каркаса не изменяются (AC-3).

-- Для exclusion-ограничения «заголовок = ... и интервал && ...» нужен btree_gist:
-- gist сам по себе не умеет оператор = для bigint.
create extension if not exists btree_gist;

create table fnd_versioned_tables (
    table_name    text        primary key,
    header_column text        not null,
    created_at    timestamptz not null default now()
);
comment on table fnd_versioned_tables is
    'Реестр таблиц версий: заполняет fnd_versioning_enable, читают fnd_version_at и фасад FndVersioning';

-- ---------- нумерация версий и оптимистическая блокировка (AC-15, AC-16) ----------
-- INSERT: номер версии идёт без пропусков (max+1). Пропуск номера — отказ fnd_version_gap.
-- Неположительный номер пропускаем дальше: его ловит ограничение <таблица>_ck_version_positive (AC-15).
-- UPDATE: lock_version увеличивается на 1 — сравнение ожидаемого значения делает фасад (AC-16).
create or replace function bump_version() returns trigger
language plpgsql as $$
declare
    v_header_column text := tg_argv[0];
    v_header        text;
    v_expected      integer;
begin
    if tg_op = 'INSERT' then
        v_header := to_jsonb(new) ->> v_header_column;
        execute format('select coalesce(max(version), 0) + 1 from %I where %I::text = $1',
                       tg_table_name, v_header_column)
            into v_expected using v_header;
        if new.version is null then
            new.version := v_expected;
        elsif new.version > 0 and new.version <> v_expected then
            raise exception 'fnd_version_gap'
                using errcode = 'P0001',
                      hint = format('ожидался номер %s, получен %s', v_expected, new.version);
        end if;
        return new;
    end if;
    new.lock_version := old.lock_version + 1;
    return new;
end
$$;

-- ---------- неизменяемость опубликованной версии (AC-13, доп.2) ----------
-- Опубликованной строке разрешены ровно два изменения: закрытие открытого конца
-- (valid_to null -> дата) и перевод published -> superseded; плюс служебный lock_version.
-- Всё остальное, а также DELETE опубликованной или снятой версии — отказ.
create or replace function deny_update_published() returns trigger
language plpgsql as $$
declare
    v_old     jsonb;
    v_new     jsonb;
    v_allowed text[] := array['lock_version'];
    v_changed text[];
begin
    -- Режим обслуживания каркаса (как у audit_log в V014): чистка данных при сопровождении
    -- и в тестах идёт в сессии с set_config('dwh.maintenance','on',true), прикладной код его не ставит.
    if coalesce(current_setting('dwh.maintenance', true), '') = 'on' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;
    if old.status = 'draft' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;
    if tg_op = 'DELETE' then
        raise exception 'fnd_version_published_immutable'
            using errcode = 'P0001', hint = 'опубликованная версия не удаляется, используйте supersede';
    end if;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if old.status = 'published' then
        if old.valid_to is null and new.valid_to is not null then
            v_allowed := array_append(v_allowed, 'valid_to'::text);
        end if;
        if new.status = 'superseded' then
            v_allowed := array_append(v_allowed, 'status'::text);
        end if;
    end if;
    select array_agg(k order by k) into v_changed
      from (select key as k from jsonb_each(v_new) union select key from jsonb_each(v_old)) keys
     where v_old -> k is distinct from v_new -> k
       and not (k = any (v_allowed));
    if v_changed is not null then
        raise exception 'fnd_version_published_immutable'
            using errcode = 'P0001', hint = 'запрещённые колонки: ' || array_to_string(v_changed, ', ');
    end if;
    return new;
end
$$;

-- ---------- действующая версия на дату (AC-11, AC-12, AC-17) ----------
-- Черновики и снятые версии не участвуют: «действующая» — только published.
create or replace function fnd_version_at(p_table regclass, p_header_id bigint, p_date date)
returns integer
language plpgsql stable as $$
declare
    v_header_column text;
    v_version       integer;
begin
    select header_column into v_header_column from fnd_versioned_tables where table_name = p_table::text;
    if v_header_column is null then
        raise exception 'fnd_version_table_unknown'
            using errcode = 'P0001', hint = p_table::text || ' не объявлена через fnd_versioning_enable';
    end if;
    execute format('select version from %s where %I = $1 and status = ''published'''
                   || ' and valid_from <= $2 and (valid_to is null or valid_to >= $2)',
                   p_table::text, v_header_column)
        into v_version using p_header_id, p_date;
    return v_version;
end
$$;

-- ---------- подключение стандарта к таблице версий модуля (AC-10) ----------
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

    execute format('create trigger %I before insert or update on %s for each row execute function bump_version(%L)',
                   v_name || '_bump_version', v_name, p_header_column);
    execute format('create trigger %I before update or delete on %s for each row execute function deny_update_published()',
                   v_name || '_deny_update_published', v_name);
end
$$;
