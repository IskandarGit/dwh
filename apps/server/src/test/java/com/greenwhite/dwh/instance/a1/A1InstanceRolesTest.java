package com.greenwhite.dwh.instance.a1;

import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * И1 шаг 1.3 (a1-on-cms), AC-9: роли экземпляра из V110 и строка OneID.
 */
class A1InstanceRolesTest extends EmbeddedPostgresTest {

    @Autowired
    private JdbcClient jdbc;

    @Test
    @DisplayName("AC-9: роли экземпляра chief_admin и analyst заведены с именами из V110")
    void instanceRolesExistWithPcode() {
        List<String> pcodes = jdbc.sql("select pcode from md_roles where pcode in ('chief_admin','analyst') order by pcode")
                .query(String.class).list();
        assertThat(pcodes).containsExactly("analyst", "chief_admin");

        String chiefAdminName = jdbc.sql("select name from md_roles where pcode = 'chief_admin'")
                .query(String.class).single();
        assertThat(chiefAdminName).isEqualTo("Bosh administrator");

        String analystName = jdbc.sql("select name from md_roles where pcode = 'analyst'")
                .query(String.class).single();
        assertThat(analystName).isEqualTo("Tahlilchi");
    }

    @Test
    @DisplayName("AC-9: chief_admin покрывает весь каталог пар форма.действие")
    void chiefAdminCoversWholeCatalog() {
        Long chiefAdminPairs = jdbc.sql("""
                select count(*) from md_role_permissions p
                join md_roles r on r.id = p.role_id
                where r.pcode = 'chief_admin'
                """).query(Long.class).single();
        Long catalogPairs = jdbc.sql("select count(*) from md_form_actions").query(Long.class).single();

        assertThat(catalogPairs).isPositive();
        assertThat(chiefAdminPairs).isEqualTo(catalogPairs);
    }

    @Test
    @DisplayName("AC-9: у analyst нет админских форм и задачника")
    void analystHasNoAdminForms() {
        Long forbidden = jdbc.sql("""
                select count(*) from md_role_permissions p
                join md_roles r on r.id = p.role_id
                where r.pcode = 'analyst'
                  and (p.form_code in ('iam.users', 'rbac.roles', 'rbac.assignments', 'audit.log',
                                       'platform.settings', 'md.custom_fields', 'platform.webhooks')
                       or p.form_code like 'tasks.%')
                """).query(Long.class).single();
        assertThat(forbidden).isZero();

        Long analystPairs = jdbc.sql("""
                select count(*) from md_role_permissions p
                join md_roles r on r.id = p.role_id
                where r.pcode = 'analyst'
                """).query(Long.class).single();
        assertThat(analystPairs).isPositive();
    }

    @Test
    @DisplayName("AC-9: системные роли каркаса не тронуты")
    void systemRolesUntouched() {
        List<String> pcodes = jdbc.sql("""
                select pcode from md_roles
                where pcode in ('admin', 'manager', 'auditor', 'user')
                order by pcode
                """).query(String.class).list();
        assertThat(pcodes).containsExactly("admin", "auditor", "manager", "user");

        Long adminPairs = jdbc.sql("""
                select count(*) from md_role_permissions p
                join md_roles r on r.id = p.role_id
                where r.pcode = 'admin'
                """).query(Long.class).single();
        Long catalogPairs = jdbc.sql("select count(*) from md_form_actions").query(Long.class).single();
        assertThat(adminPairs).isEqualTo(catalogPairs);
    }

    @Test
    @DisplayName("AC-9: строка OneID заведена и выключена")
    void oneIdSeededDisabled() {
        List<Map<String, Object>> rows = jdbc.sql("""
                select is_enabled, auto_provision, client_secret
                from md_sso_providers where provider_id = 'oneid'
                """).query().listOfRows();

        assertThat(rows).hasSize(1);
        Map<String, Object> row = rows.getFirst();
        assertThat(row.get("is_enabled")).isEqualTo(false);
        assertThat(row.get("auto_provision")).isEqualTo(false);
        assertThat(row.get("client_secret")).isNull();
    }

    @Test
    @DisplayName("AC-9: повторный прогон V110 ничего не добавляет")
    void v110IsIdempotent() throws IOException {
        String script = new ClassPathResource("db/migration/V110__a1_instance_roles.sql")
                .getContentAsString(StandardCharsets.UTF_8);

        long rolesBefore = count("md_roles");
        long permissionsBefore = count("md_role_permissions");
        long providersBefore = count("md_sso_providers");

        jdbc.sql(script).update();

        assertThat(count("md_roles")).isEqualTo(rolesBefore);
        assertThat(count("md_role_permissions")).isEqualTo(permissionsBefore);
        assertThat(count("md_sso_providers")).isEqualTo(providersBefore);
    }

    private long count(String table) {
        return jdbc.sql("select count(*) from " + table).query(Long.class).single();
    }
}
