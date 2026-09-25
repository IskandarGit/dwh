set lock_timeout = '2s';
set statement_timeout = '60s';
-- Отчёты (rpt), И15б: признак строки, отклонённой анкетой при разборе. В raw.rows пишутся все строки файла; отчёты считают только принятые.
-- Уже загруженные строки получают false (как если бы все приняты) — прежнее поведение.

alter table raw.rows add column rejected boolean not null default false;   -- PostgreSQL 18: без перезаписи таблицы
comment on column raw.rows.rejected is 'строка отклонена анкетой при разборе; в отчёты не входит';
