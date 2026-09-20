set lock_timeout = '2s';
set statement_timeout = '60s';
-- Сид основы (fnd): расписание обслуживающих заданий блока E (AC-31).
-- fnd.load_cleanup — удаление строк raw неудачных загрузок; fnd.xdb_check — сверка raw с OLTP.
-- Регламент AC-2: файл содержит только сид, без CREATE/ALTER/DROP.

insert into fnd_job_schedule (code, handler, interval_sec, args)
select 'fnd.load_cleanup', 'fnd.load_cleanup', 3600, '{}'::jsonb
where not exists (select 1 from fnd_job_schedule where code = 'fnd.load_cleanup');

insert into fnd_job_schedule (code, handler, interval_sec, args)
select 'fnd.xdb_check', 'fnd.xdb_check', 86400, '{}'::jsonb
where not exists (select 1 from fnd_job_schedule where code = 'fnd.xdb_check');
