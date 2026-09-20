-- ============================================================================
-- V032: Пользовательские меню и внешние отчеты (md_navigation_items)
-- ============================================================================

create table if not exists md_navigation_items (
    id bigserial primary key,
    code varchar(64) not null unique,
    title varchar(128) not null,
    title_key varchar(128),
    section_id varchar(64) not null default 'custom',
    parent_id bigint references md_navigation_items(id) on delete cascade,
    icon varchar(64) not null default 'bar_chart',
    target_type varchar(32) not null default 'EMBEDDED_IFRAME' check (target_type in ('INTERNAL_ROUTE', 'EXTERNAL_LINK', 'EMBEDDED_IFRAME')),
    url text not null,
    open_in_iframe boolean not null default true,
    required_permission varchar(128),
    sort_order integer not null default 100,
    state varchar(1) not null default 'A' check (state in ('A', 'P')),
    created_by bigint references md_users(id),
    modified_by bigint references md_users(id),
    created_at timestamptz not null default clock_timestamp(),
    modified_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_md_navigation_items_section on md_navigation_items(section_id, sort_order);
create index if not exists idx_md_navigation_items_state on md_navigation_items(state, sort_order);
create index if not exists idx_md_navigation_items_parent on md_navigation_items(parent_id);

-- Каталог форм и прав RBAC
insert into md_forms (code, module, name) values
('platform.navigation', 'md', 'Управление навигацией и меню')
on conflict (code) do nothing;

insert into md_form_actions (form_code, action, name) values
('platform.navigation', 'view', 'Просмотр меню и отчетов'),
('platform.navigation', 'manage', 'Управление пунктами меню и отчетами')
on conflict (form_code, action) do nothing;

-- Права администратора
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode = 'admin' and fa.form_code = 'platform.navigation'
on conflict do nothing;

-- Права аудитора (только просмотр)
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, 'view'
from md_roles r
cross join (values ('platform.navigation')) as t(form_code)
join md_form_actions fa on fa.form_code = t.form_code and fa.action = 'view'
where r.pcode = 'auditor'
on conflict do nothing;

-- Демонстрационный отчет BI (Apache Superset)
insert into md_navigation_items (code, title, section_id, icon, target_type, url, open_in_iframe, sort_order, state) values
('superset-sales', 'Аналитический дашборд', 'custom', 'analytics', 'EMBEDDED_IFRAME', 'https://superset.apache.org', true, 10, 'A')
on conflict (code) do nothing;
