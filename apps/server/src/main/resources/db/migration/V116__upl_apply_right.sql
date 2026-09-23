set lock_timeout = '2s';
set statement_timeout = '60s';
insert into md_form_actions (form_code, action, name) values
  ('upl.packages','apply','Применение')
on conflict (form_code, action) do nothing;

-- chief_admin и admin — все пары каталога (правило V110); analyst «Применение» не получает
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode in ('chief_admin', 'admin')
on conflict do nothing;
