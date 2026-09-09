set lock_timeout = '2s';
set statement_timeout = '60s';
-- Основа (fnd), блок B на каркасе SmartupCMS: аудит fnd-таблиц в audit_log каркаса,
-- очередь заданий модулей DW (AC-6, AC-7; 02 п.6, п.13, п.15; 18 п.4).
-- Нумерация V1xx — наши миграции; файлы V0xx принадлежат каркасу и не меняются (AC-2).
-- Только expand: таблицы и колонки каркаса не изменяются (AC-3).
-- Файлы (AC-8) хранит модуль mf каркаса, настройки — md_settings каркаса: своих таблиц не заводим.

-- ---------- техническая учётка для операций заданий (AC-6) ----------
-- audit_log.changed_by каркаса — bigint, поэтому актор 'system' наших заданий должен быть
-- настоящей записью md_users. Учётка неактивна (state = 'P') и без пароля: входить ей нельзя.
insert into md_users (name, login, email, state, language, timezone)
select 'System (DW jobs)', 'system', 'system@localhost', 'P', 'uz', 'UTC'
where not exists (select 1 from md_users where login = 'system');

-- ---------- аудит fnd-таблиц: реестр и триггер (02 п.6, п.13; AC-6) ----------
create table fnd_audit_tables (
    table_name   text        primary key,
    key_column   text        not null,
    enabled      boolean     not null default true,
    created_at   timestamptz not null default now()
);
comment on table fnd_audit_tables is
    'Таблицы модулей DW под триггером аудита; включение — fnd_audit_enable(regclass, key_column)';

create index audit_log_table_row_idx on audit_log (table_name, row_pk, changed_at desc);

-- Актор берётся из set_config('app.user_id', ..., true): id пользователя или id учётки system.
-- Отсутствие актора — отказ audit_actor_missing, строка не изменена (AC-6).
create or replace function fnd_audit_trigger() returns trigger
language plpgsql as $$
declare
    v_actor   text := nullif(trim(coalesce(current_setting('app.user_id', true), '')), '');
    v_user_id bigint;
    v_key     text;
    v_old     jsonb;
    v_new     jsonb;
    v_changed text[];
    v_event   char(1);
begin
    if v_actor is null then
        raise exception 'audit_actor_missing'
            using errcode = 'P0001',
                  hint = 'set_config(''app.user_id'', <id пользователя>, true) перед изменением';
    end if;
    if v_actor !~ '^[0-9]{1,18}$' then
        raise exception 'audit_actor_missing'
            using errcode = 'P0001', hint = 'app.user_id должен быть числовым id из md_users';
    end if;
    select id into v_user_id from md_users where id = v_actor::bigint;
    if v_user_id is null then
        raise exception 'audit_actor_missing'
            using errcode = 'P0001', hint = 'пользователь app.user_id не найден в md_users';
    end if;

    if tg_op = 'INSERT' then
        v_event := 'I';
        v_new := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
        v_event := 'U';
        v_old := to_jsonb(old);
        v_new := to_jsonb(new);
        if v_old = v_new then
            return new;
        end if;
        select array_agg(k order by k) into v_changed
          from (select key as k from jsonb_each(v_new) union select key from jsonb_each(v_old)) keys
         where v_old -> k is distinct from v_new -> k;
    else
        v_event := 'D';
        v_old := to_jsonb(old);
    end if;

    v_key := coalesce(v_new ->> tg_argv[0], v_old ->> tg_argv[0]);
    insert into audit_log (table_name, row_pk, event, changed_by, changed_columns, old_row, new_row)
    values (tg_table_name, v_key, v_event, v_user_id, v_changed, v_old, v_new);

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end
$$;

-- Включение аудита таблицы: строка в fnd_audit_tables + триггер.
-- Вызывается миграциями модулей DW на свои таблицы.
create or replace function fnd_audit_enable(p_table regclass, p_key_column text) returns void
language plpgsql as $$
declare
    v_name text := p_table::text;
begin
    insert into fnd_audit_tables (table_name, key_column) values (v_name, p_key_column)
    on conflict (table_name) do update set key_column = excluded.key_column, enabled = true;
    execute format('drop trigger if exists %I on %s', v_name || '_audit_trg', v_name);
    execute format(
        'create trigger %I after insert or update or delete on %s for each row execute function fnd_audit_trigger(%L)',
        v_name || '_audit_trg', v_name, p_key_column);
end
$$;

-- ---------- очередь заданий модулей DW (02 п.15; AC-7) ----------
-- Префикс ms_ занят модулем задач каркаса, поэтому таблицы очереди — fnd_job_*.
-- Выключатель jobs_enabled живёт в md_settings каркаса (user_id is null).
create table fnd_job_schedule (
    code           text        primary key,
    handler        text        not null,
    interval_sec   integer     not null,
    args           jsonb       not null default '{}'::jsonb,
    enabled        boolean     not null default true,
    last_enqueued  timestamptz,
    constraint fnd_job_schedule_ck_interval check (interval_sec > 0)
);

create table fnd_job_queue (
    id             bigserial   primary key,
    handler        text        not null,
    args           jsonb       not null default '{}'::jsonb,
    run_at         timestamptz not null default now(),
    created_at     timestamptz not null default now(),
    attempts       integer     not null default 0,
    schedule_code  text        references fnd_job_schedule (code)
);
create index fnd_job_queue_run_at_idx on fnd_job_queue (run_at);

create table fnd_job_runs (
    id           bigserial   primary key,
    queue_id     bigint      not null,
    handler      text        not null,
    args         jsonb       not null,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    status       text        not null,
    error        text,
    constraint fnd_job_runs_ck_status check (status in ('running', 'done', 'failed'))
);
create index fnd_job_runs_queue_idx on fnd_job_runs (queue_id);
