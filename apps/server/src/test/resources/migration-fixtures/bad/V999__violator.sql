-- фикстура-нарушитель для AC-2: нет шапки таймаутов, DDL вместе с сидом, деструктивная операция без одобрения
create table fnd_test_violator (id int);
insert into fnd_test_violator values (1);
alter table fnd_test_violator drop column id;
