package com.greenwhite.dwh.instance.fnd.rules;

import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-38 (18 п.11; 18 тест 2): прикладные модули ({@code upl_|ref_|reg_|vit_}) не заводят своих версий, единиц,
 * журналов и очередей — всё это даёт основа. Правило принимает список схем; таблицы каркаса
 * ({@code kauth_, md_, mf_, ms_, kwh_, search_, audit_}) и основы ({@code fnd_}) в проверку не входят.
 * Фикстура-нарушитель — plain SQL в схеме {@code fnd_test}.
 */
class FndModuleSchemaRulesTest extends EmbeddedPostgresTest {

    private static final Pattern MODULE_TABLE = Pattern.compile("^(upl|ref|reg|vit)_.+");
    private static final Pattern OWN_INFRASTRUCTURE = Pattern.compile(".+_(units|coefficients|log|queue|jobs)$");
    /** Таблицы каркаса и основы — вне правила; перечислены явно, чтобы расширение списка модулей их не задело. */
    private static final Set<String> FOREIGN_PREFIXES = Set.of("kauth_", "md_", "mf_", "ms_", "kwh_", "search_",
            "audit_", "fnd_", "flyway_");

    @Autowired
    private JdbcClient jdbc;

    @AfterEach
    void dropFixtureSchema() {
        jdbc.sql("drop schema if exists fnd_test cascade").update();
    }

    @Test
    @DisplayName("AC-38: public без прикладных модулей — правило зелёное")
    void publicSchemaIsClean() {
        assertThat(violations(List.of("public"))).isEmpty();
    }

    @Test
    @DisplayName("AC-38: фикстура-нарушитель в fnd_test — красный с перечнем таблиц; соблюдающая таблица не в списке")
    void violatorSchemaIsRed() {
        jdbc.sql("create schema fnd_test").update();
        jdbc.sql("create table fnd_test.upl_docs (id bigserial primary key, title text)").update();
        jdbc.sql("create table fnd_test.upl_docs_versions (doc_id bigint, version int, valid_from date, valid_to date)")
                .update();
        jdbc.sql("create table fnd_test.ref_items (id bigserial primary key, valid_from date, valid_to date)").update();
        jdbc.sql("create table fnd_test.reg_units (id bigserial primary key, code text)").update();
        jdbc.sql("create table fnd_test.reg_unit_coefficients (id bigserial primary key)").update();
        jdbc.sql("create table fnd_test.vit_refresh_log (id bigserial primary key)").update();
        jdbc.sql("create table fnd_test.upl_queue (id bigserial primary key)").update();
        jdbc.sql("create table fnd_test.ref_jobs (id bigserial primary key)").update();
        jdbc.sql("create table fnd_test.kauth_tokens_log (id bigserial primary key)").update();

        List<String> violations = violations(List.of("fnd_test"));

        assertThat(violations).extracting(v -> v.substring(0, v.indexOf(':')))
                .containsExactlyInAnyOrder("fnd_test.upl_docs_versions", "fnd_test.ref_items", "fnd_test.reg_units",
                        "fnd_test.reg_unit_coefficients", "fnd_test.vit_refresh_log", "fnd_test.upl_queue",
                        "fnd_test.ref_jobs");
        assertThat(violations(List.of("public", "fnd_test"))).hasSameSizeAs(violations);
    }

    /**
     * Правило: таблица прикладного модуля нарушает, если (а) это {@code *_versions} не по стандарту AC-10
     * (нет в {@code fnd_versioned_tables}), (б) у неё есть {@code valid_from}/{@code valid_to} без ограничения
     * {@code <table>_ex_valid}, (в) это своя таблица единиц/коэффициентов/журнала/очереди/заданий.
     */
    private List<String> violations(List<String> schemas) {
        List<String> found = new ArrayList<>();
        List<Map<String, Object>> tables = jdbc.sql("""
                        select t.table_schema, t.table_name,
                               bool_or(c.column_name = 'valid_from') as has_from,
                               bool_or(c.column_name = 'valid_to') as has_to,
                               exists (select 1 from pg_constraint con join pg_class rel on rel.oid = con.conrelid
                                        join pg_namespace ns on ns.oid = rel.relnamespace
                                       where ns.nspname = t.table_schema and rel.relname = t.table_name
                                         and con.contype = 'x' and con.conname = t.table_name || '_ex_valid') as has_ex,
                               exists (select 1 from fnd_versioned_tables v
                                       where v.table_name in (t.table_name, t.table_schema || '.' || t.table_name))
                                   as registered
                          from information_schema.tables t
                          join information_schema.columns c
                            on c.table_schema = t.table_schema and c.table_name = t.table_name
                         where t.table_schema in (:schemas) and t.table_type = 'BASE TABLE'
                         group by t.table_schema, t.table_name
                         order by 1, 2
                        """).param("schemas", schemas).query().listOfRows();
        for (Map<String, Object> table : tables) {
            String name = (String) table.get("table_name");
            String qualified = table.get("table_schema") + "." + name;
            if (FOREIGN_PREFIXES.stream().anyMatch(name::startsWith) || !MODULE_TABLE.matcher(name).matches()) {
                continue;
            }
            if (name.endsWith("_versions") && !Boolean.TRUE.equals(table.get("registered"))) {
                found.add(qualified + ": таблица версий не по стандарту AC-10 (нет в fnd_versioned_tables)");
            } else if (Boolean.TRUE.equals(table.get("has_from")) && Boolean.TRUE.equals(table.get("has_to"))
                    && !Boolean.TRUE.equals(table.get("has_ex"))) {
                found.add(qualified + ": valid_from/valid_to без ограничения " + name + "_ex_valid");
            } else if (OWN_INFRASTRUCTURE.matcher(name).matches()) {
                found.add(qualified + ": свои единицы/коэффициенты/журнал/очередь/задания — это даёт основа");
            }
        }
        return found;
    }
}
