-- ============================================================================
-- V033: функции обслуживания партиций audit_log (I-02, Finding S-02, CWE-250)
--
-- В соответствии с принципом наименьших привилегий (least privilege), пользователь
-- приложения (smartupcms) не должен обладать правами суперпользователя, правами
-- DDL (CREATE/ALTER/DROP TABLE) или правами владельца таблицы audit_log.
-- Если приложение владеет audit_log, оно может выполнить TRUNCATE audit_log или
-- ALTER TABLE audit_log DISABLE TRIGGER ALL, обходя триггеры неизменяемости (V014).
--
-- Однако AuditPartitionWorker должен ежемесячно создавать новые партиции и
-- отцеплять устаревшие (FR-AUD-2).
--
-- Данные функции выполняются с правами владельца схемы (SECURITY DEFINER)
-- с жестко зафиксированным search_path = public, pg_temp (защита от privilege escalation),
-- проверяют корректность диапазона параметров и позволяют безопасно создавать
-- и отцеплять партиции без выдачи прав DDL пользователю приложения.
-- ============================================================================

create or replace function audit_log_create_partition(p_year int, p_month int)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_date date;
    v_next_date date;
    v_part_name text;
begin
    if p_year < 2020 or p_year > 2100 then
        raise exception 'Invalid year: %', p_year using errcode = 'check_violation';
    end if;
    if p_month < 1 or p_month > 12 then
        raise exception 'Invalid month: %', p_month using errcode = 'check_violation';
    end if;

    v_date := make_date(p_year, p_month, 1);
    v_next_date := (v_date + interval '1 month')::date;
    v_part_name := 'audit_log_' || to_char(v_date, 'YYYY_MM');

    if not exists (select 1 from pg_class where relname = v_part_name) then
        execute format(
            'create table if not exists %I partition of audit_log for values from (%L) to (%L)',
            v_part_name,
            v_date::text || ' 00:00:00+00',
            v_next_date::text || ' 00:00:00+00'
        );
        execute format('revoke update, delete, truncate on %I from public', v_part_name);
        execute format('grant select, insert on %I to public', v_part_name);
    end if;

    return v_part_name;
end;
$$;

comment on function audit_log_create_partition(int, int) is
    'Безопасное создание месячной партиции audit_log без предоставления DDL прав приложению (SECURITY DEFINER)';

create or replace function audit_log_detach_partition(p_year int, p_month int)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_date date;
    v_part_name text;
    v_archived_name text;
begin
    if p_year < 2020 or p_year > 2100 then
        raise exception 'Invalid year: %', p_year using errcode = 'check_violation';
    end if;
    if p_month < 1 or p_month > 12 then
        raise exception 'Invalid month: %', p_month using errcode = 'check_violation';
    end if;

    v_date := make_date(p_year, p_month, 1);
    v_part_name := 'audit_log_' || to_char(v_date, 'YYYY_MM');
    v_archived_name := 'audit_log_archived_' || to_char(v_date, 'YYYY_MM');

    if not exists (select 1 from pg_class where relname = v_part_name) then
        raise exception 'Partition table % does not exist', v_part_name using errcode = 'undefined_table';
    end if;

    execute format('alter table audit_log detach partition %I', v_part_name);
    execute format('alter table %I rename to %I', v_part_name, v_archived_name);
    execute format('revoke update, delete, truncate on %I from public', v_archived_name);
    execute format('grant select on %I to public', v_archived_name);

    return v_archived_name;
end;
$$;

comment on function audit_log_detach_partition(int, int) is
    'Безопасное отцепление устаревшей партиции audit_log без предоставления DDL прав приложению (SECURITY DEFINER)';

-- Разрешаем вызов функций обслуживания партиций
grant execute on function audit_log_create_partition(int, int) to public;
grant execute on function audit_log_detach_partition(int, int) to public;

-- Защита от случайного или намеренного TRUNCATE журнала аудита
revoke truncate on audit_log, audit_log_default from public;