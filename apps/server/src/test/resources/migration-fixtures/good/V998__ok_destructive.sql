set lock_timeout = '2s';
set statement_timeout = '60s';
-- destructive: approved
-- reason: фикстура AC-2 — деструктивная операция с тремя строками одобрения
-- approved_by: architect
drop table if exists fnd_test_gone;
