set lock_timeout = '2s';
set statement_timeout = '60s';
-- Сид основы (fnd): техническая учётка для операций заданий (AC-6).
-- audit_log.changed_by каркаса — bigint, поэтому актор наших заданий должен быть настоящей записью
-- md_users. Учётка неактивна (state = 'P') и без пароля: входить ей нельзя.
-- Регламент AC-2: файл содержит только сид, без CREATE/ALTER/DROP.

insert into md_users (name, login, email, state, language, timezone)
select 'System (DW jobs)', 'system', 'system@localhost', 'P', 'uz', 'UTC'
where not exists (select 1 from md_users where login = 'system');
