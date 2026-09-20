-- фикстура-нарушитель для AC-2: нет шапки таймаутов, DDL вместе с сидом, деструктивная операция без одобрения, drop trigger и delete без одобрения
create table fnd_test_violator (id int);
insert into fnd_test_violator values (1);
alter table fnd_test_violator drop column id;
drop trigger if exists fnd_test_violator_trg on fnd_test_violator;
delete from fnd_test_violator;
