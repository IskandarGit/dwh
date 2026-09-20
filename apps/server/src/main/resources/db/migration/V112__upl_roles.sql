set lock_timeout = '2s';
set statement_timeout = '60s';
insert into md_forms (code, module, name) values ('upl.sources', 'upl', 'Manbalar va formatlar') on conflict (code) do nothing;
insert into md_form_actions (form_code, action, name) values
  ('upl.sources','view','Ko''rish'), ('upl.sources','create','Yaratish'),
  ('upl.sources','edit','Tahrirlash'), ('upl.sources','publish','E''lon qilish')
on conflict (form_code, action) do nothing;

-- chief_admin — все пары каталога (правило V110)
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode in ('chief_admin', 'admin')
on conflict do nothing;

-- analyst — только просмотр источников
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
join md_form_actions fa on (fa.form_code, fa.action) in (
    ('upl.sources', 'view')
)
where r.pcode = 'analyst'
on conflict do nothing;
