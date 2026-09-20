set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), починка после tester круг 1 (M-4, M-14а).
-- M-4: fnd_load_log.at по умолчанию now() = начало транзакции — несколько log() в одной транзакции
-- получали одинаковый at и порядок журнала (AC-29 «в порядке at») был неопределён. clock_timestamp()
-- даёт время вставки строки.
-- M-14а: bump_version() сравнивал заголовок как `%I::text = $1` — приведение к text отключало индекс
-- первичного ключа, каждый insert версии шёл seq scan. Теперь значение подставляется литералом `%I = %L`:
-- литерал приводится к типу колонки заголовка, индекс PK (<заголовок>, version) используется.
-- Только expand: таблицы каркаса не изменяются (AC-3); create or replace function — не деструктивно.

alter table fnd_load_log alter column at set default clock_timestamp();

create or replace function bump_version() returns trigger
language plpgsql as $$
declare
    v_header_column text := tg_argv[0];
    v_header        text;
    v_expected      integer;
begin
    if tg_op = 'INSERT' then
        v_header := to_jsonb(new) ->> v_header_column;
        execute format('select coalesce(max(version), 0) + 1 from %I where %I = %L',
                       tg_table_name, v_header_column, v_header)
            into v_expected;
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
