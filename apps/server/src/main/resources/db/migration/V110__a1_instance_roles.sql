set lock_timeout = '2s';
set statement_timeout = '60s';
-- Сид И1 (a1-on-cms): преднастроенные роли экземпляра и провайдер OneID.
-- pcode не NULL — каркас не даёт удалить такую роль (MdRoleService), это и есть «преднастроенные не удаляются» (I-P4).
-- [допущение] имена ролей — узбекская латиница (интерфейс этапа 1 только uz).
-- Регламент AC-2: файл содержит только сид, без DDL; всё идемпотентно через on conflict do nothing.

-- 1. Роли экземпляра
insert into md_roles (name, pcode, state, order_no, created_at, modified_at) values
('Bosh administrator', 'chief_admin', 'A', 110, now(), now()),
('Tahlilchi', 'analyst', 'A', 120, now(), now())
on conflict (pcode) do nothing;

-- 2. chief_admin — все пары каталога (шаблон admin из V002)
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode = 'chief_admin'
on conflict do nothing;

-- 3. analyst — набор роли user (V003 п.5) без tasks.* [допущение: задачник не в этапе 1]
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
join md_form_actions fa on (fa.form_code, fa.action) in (
    ('iam.profile', 'view'), ('iam.profile', 'update'),
    ('iam.profile', 'manage_tokens'), ('iam.profile', 'manage_channels'),
    ('platform.files', 'view'), ('platform.files', 'upload'),
    ('platform.search', 'view'),
    ('notify.inbox', 'view'),
    ('notify.preferences', 'view'), ('notify.preferences', 'update'),
    ('platform.announcements', 'view')
)
where r.pcode = 'analyst'
on conflict do nothing;

-- 4. OneID (id.egov.uz) — заведён, но выключен: обмен кода в каркасе не реализован (V018), долг этапа 2 «адаптер OneID».
-- URL — заглушки; требует сверки с действующей документацией НАИС.
insert into md_sso_providers (provider_id, name, icon, client_id, client_secret, authorization_url, token_url, userinfo_url, scopes, is_enabled, auto_provision)
values ('oneid', 'OneID (id.egov.uz)', 'lock', 'TEST', null,
        'https://id.egov.uz/', 'https://id.egov.uz/', 'https://id.egov.uz/',
        'openid', false, false)
on conflict (provider_id) do nothing;
