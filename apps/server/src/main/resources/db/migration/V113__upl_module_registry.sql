set lock_timeout = '2s';
set statement_timeout = '60s';

-- Модуль upl («Источники и форматы») в реестре модулей каркаса (V028): администратор включает и выключает его
-- на странице «Реестр модулей», маршруты и пункт меню гейтятся moduleActiveGuard / isModuleActive, как у notes.
insert into md_installed_modules (code, name, description, route, is_system, status, sort_order)
values ('upl', 'Источники и форматы', 'Анкеты файлов: источники, версии формата, листы и колонки', '/upl/sources', false, 'ACTIVE', 70)
on conflict (code) do nothing;
