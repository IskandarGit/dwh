set lock_timeout = '2s';
set statement_timeout = '60s';

insert into md_installed_modules (code, name, description, route, is_system, status, sort_order)
values ('rpt', 'Отчёты', 'Сводные отчёты по загруженным файлам: строки по колонкам, колонки по месяцам', '/rpt/reports', false, 'ACTIVE', 90)
on conflict (code) do nothing;

insert into md_forms (code, module, name) values ('rpt.reports', 'rpt', 'Отчёты') on conflict (code) do nothing;

insert into md_form_actions (form_code, action, name) values
  ('rpt.reports','view','Просмотр'),
  ('rpt.reports','edit','Описание отчётов')
on conflict (form_code, action) do nothing;

-- chief_admin и admin — все пары каталога (правило V110); analyst — только просмотр
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r cross join md_form_actions fa
where r.pcode in ('chief_admin', 'admin')
on conflict do nothing;

insert into md_role_permissions (role_id, form_code, action)
select r.id, 'rpt.reports', 'view' from md_roles r where r.pcode = 'analyst'
on conflict do nothing;
