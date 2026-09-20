-- ============================================================================
-- V028: Реестр модулей платформы (md_installed_modules) и эталонный модуль заметок (ms_notes)
-- ============================================================================

-- 1. Реестр установленных модулей
create table if not exists md_installed_modules (
    code varchar(64) primary key,
    name varchar(128) not null,
    description text,
    version varchar(32) not null default '1.0.0',
    icon varchar(64) not null default 'box',
    route varchar(128),
    is_system boolean not null default false,
    status varchar(32) not null default 'ACTIVE',
    sort_order integer not null default 100,
    attributes jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp(),
    modified_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_md_installed_modules_status on md_installed_modules(status, sort_order);

-- Заполнение реестра модулями платформы
insert into md_installed_modules (code, name, description, version, icon, route, is_system, status, sort_order) values
('iam', 'Пользователи и безопасность', 'Управление учетными записями, ролями, правами и сессиями', '1.0.0', 'users', '/iam/users', true, 'ACTIVE', 10),
('tasks', 'Задачи и проекты', 'Управление задачами, проектами, статусами и комментариями', '1.0.0', 'check-square', '/tasks', true, 'ACTIVE', 20),
('files', 'Файловое хранилище', 'Хранение, квотирование и версионирование файлов', '1.0.0', 'folder', '/files', true, 'ACTIVE', 30),
('audit', 'Журнал аудита', 'Неизменяемый журнал действий и событий безопасности', '1.0.0', 'shield', '/audit', true, 'ACTIVE', 40),
('search', 'Глобальный поиск', 'Мгновенный полнотекстовый поиск на базе Typesense', '1.0.0', 'search', '/search', true, 'ACTIVE', 50),
('notes', 'Заметки и документация', 'Персональные и командные заметки, документация с поддержкой Markdown', '1.0.0', 'file-text', '/notes', false, 'ACTIVE', 60)
on conflict (code) do nothing;

-- 2. Таблица эталонного модуля заметок (ms_notes)
create table if not exists ms_notes (
    id bigserial primary key,
    title varchar(255) not null,
    content_md text not null default '',
    color varchar(32) not null default 'default',
    is_pinned boolean not null default false,
    attributes jsonb not null default '{}'::jsonb,
    created_by bigint not null references md_users(id),
    modified_by bigint not null references md_users(id),
    created_at timestamptz not null default clock_timestamp(),
    modified_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_ms_notes_owner on ms_notes(created_by, is_pinned desc, id desc);

-- 3. Каталог форм и прав RBAC
insert into md_forms (code, module, name) values
('platform.modules', 'md', 'Реестр модулей платформы'),
('notes', 'ms', 'Заметки')
on conflict (code) do nothing;

insert into md_form_actions (form_code, action, name) values
('platform.modules', 'view', 'Просмотр реестра модулей'),
('platform.modules', 'manage', 'Включение и отключение модулей'),
('notes', 'view', 'Просмотр заметок'),
('notes', 'create', 'Создание заметок'),
('notes', 'update', 'Редактирование заметок'),
('notes', 'delete', 'Удаление заметок')
on conflict (form_code, action) do nothing;

-- admin: полное покрытие
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode = 'admin' and fa.form_code in ('platform.modules', 'notes')
on conflict do nothing;

-- auditor: только просмотр
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, 'view'
from md_roles r
cross join (values ('platform.modules'), ('notes')) as t(form_code)
join md_form_actions fa on fa.form_code = t.form_code and fa.action = 'view'
where r.pcode = 'auditor'
on conflict do nothing;

-- manager и user: полный доступ к заметкам
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode in ('manager', 'user') and fa.form_code = 'notes'
on conflict do nothing;
