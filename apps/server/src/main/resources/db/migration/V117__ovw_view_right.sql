set lock_timeout = '2s';
set statement_timeout = '60s';

-- Модуль ovw («Обзор данных») в реестре модулей каркаса: администратор включает и выключает его
-- на странице «Реестр модулей», маршрут и пункт меню гейтятся moduleActiveGuard / isModuleActive, как у upl (V113).
insert into md_installed_modules (code, name, description, route, is_system, status, sort_order)
values ('ovw', 'Обзор данных', 'Просмотр применённых строк файлов: фильтр, группировка, итоги', '/ovw/data', false, 'ACTIVE', 80)
on conflict (code) do nothing;

insert into md_forms (code, module, name) values ('ovw.data', 'ovw', 'Обзор данных') on conflict (code) do nothing;

insert into md_form_actions (form_code, action, name) values
  ('ovw.data','view','Просмотр')
on conflict (form_code, action) do nothing;

-- chief_admin и admin — все пары каталога (правило V110); analyst — просмотр (рабочая пара)
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode in ('chief_admin', 'admin')
on conflict do nothing;

insert into md_role_permissions (role_id, form_code, action)
select r.id, 'ovw.data', 'view' from md_roles r where r.pcode = 'analyst'
on conflict do nothing;
