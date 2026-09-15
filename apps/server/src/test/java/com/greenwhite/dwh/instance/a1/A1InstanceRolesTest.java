package com.greenwhite.dwh.instance.a1;

import com.greenwhite.dwh.instance.kauth.repository.SsoProviderRepository;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.AfterEach;
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
import static org.assertj.core.api.Assertions.tuple;

/**
 * И1 шаги 1.3–1.4 (a1-on-cms), AC-9/AC-14/AC-16: роли экземпляра из V110,
 * эффективные права analyst и строка OneID.
 */
class A1InstanceRolesTest extends EmbeddedPostgresTest {

    /** Точный набор analyst из V110 п.3 (M-2): набор роли user без tasks.*. */
    static final List<String> ANALYST_PAIRS = List.of(
            "iam.profile:view", "iam.profile:update", "iam.profile:manage_tokens", "iam.profile:manage_channels",
            "platform.files:view", "platform.files:upload",
            "platform.search:view",
            "notify.inbox:view",
            "notify.preferences:view", "notify.preferences:update",
            "platform.announcements:view");

    private static final String TEST_ANALYST_LOGIN = "test-analyst-a1";

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private MdUserService userService;

    @Autowired
    private SsoProviderRepository ssoProviders;

    @AfterEach
    void removeTestAnalyst() {
        // Каскад md_user_roles / md_effective_permissions / md_user_permission_versions (V001)
        jdbc.sql("delete from md_users where login = :login").param("login", TEST_ANALYST_LOGIN).update();
    }

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

        List<Map<String, Object>> rows = jdbc.sql("""
                select pcode, state, order_no from md_roles
                where pcode in ('chief_admin','analyst') order by pcode
                """).query().listOfRows();
        assertThat(rows).extracting(r -> r.get("pcode"), r -> r.get("state"), r -> r.get("order_no"))
                .containsExactly(tuple("analyst", "A", 120), tuple("chief_admin", "A", 110));
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

        List<String> analystPairs = jdbc.sql("""
                select p.form_code || ':' || p.action from md_role_permissions p
                join md_roles r on r.id = p.role_id
                where r.pcode = 'analyst'
                """).query(String.class).list();
        assertThat(analystPairs).containsExactlyInAnyOrderElementsOf(ANALYST_PAIRS);
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
    @DisplayName("AC-14: пользователь, созданный сразу с ролью analyst, имеет ровно одну роль и только права analyst")
    void analystUserHasExactlyOneRoleAndOnlyAnalystEffectivePermissions() {
        Long systemId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        Long analystRoleId = jdbc.sql("select id from md_roles where pcode = 'analyst'").query(Long.class).single();

        var user = userService.createUser("TEST Tahlilchi", TEST_ANALYST_LOGIN, TEST_ANALYST_LOGIN + "@test.local", null,
                "StrongPassword2026!", null, "ru", "UTC", null, Map.of(), false, false, List.of(analystRoleId), systemId);

        // M-4 (решение 15.09, вариант 1): роль user каркас выдаёт только при пустом списке ролей — здесь её быть не должно
        List<Long> roleIds = jdbc.sql("select role_id from md_user_roles where user_id = :id")
                .param("id", user.id()).query(Long.class).list();
        assertThat(roleIds).containsExactly(analystRoleId);

        // M-3: эффективные права материализованы каркасом при создании (scopeService.recalculateFor)
        List<String> effective = jdbc.sql("select form_code || ':' || action from md_effective_permissions where user_id = :id")
                .param("id", user.id()).query(String.class).list();
        assertThat(effective).containsExactlyInAnyOrderElementsOf(ANALYST_PAIRS);
        assertThat(effective).noneMatch(p -> p.startsWith("iam.users:") || p.startsWith("rbac.") || p.startsWith("audit.log:")
                || p.startsWith("platform.settings:") || p.startsWith("tasks."));
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
    @DisplayName("AC-16: oneid не попадает в список включённых провайдеров — кнопки OneID не будет")
    void oneIdNotAmongEnabledProviders() {
        assertThat(ssoProviders.findEnabledProviders())
                .noneMatch(p -> "oneid".equals(p.providerId()));
        assertThat(ssoProviders.findByProviderId("oneid")).isEmpty();
    }

    @Test
    @DisplayName("AC-9: повторный прогон V110 достраивает частичное состояние и ничего не дублирует")
    void v110IsIdempotent() throws IOException {
        String script = new ClassPathResource("db/migration/V110__a1_instance_roles.sql")
                .getContentAsString(StandardCharsets.UTF_8);

        long rolesBefore = count("md_roles");
        long permissionsBefore = count("md_role_permissions");
        long providersBefore = count("md_sso_providers");

        // Частичное состояние (обрыв прошлого применения): роль есть, прав analyst нет
        jdbc.sql("delete from md_role_permissions where role_id = (select id from md_roles where pcode = 'analyst')").update();
        assertThat(count("md_role_permissions")).isEqualTo(permissionsBefore - ANALYST_PAIRS.size());

        try {
            jdbc.sql(script).update();
        } finally {
            // Скрипт выставляет lock_timeout/statement_timeout на соединении пула — вернуть значения по умолчанию
            jdbc.sql("reset lock_timeout").update();
            jdbc.sql("reset statement_timeout").update();
        }

        assertThat(count("md_roles")).isEqualTo(rolesBefore);
        assertThat(count("md_role_permissions")).isEqualTo(permissionsBefore);
        assertThat(count("md_sso_providers")).isEqualTo(providersBefore);

        // Второй повтор — уже ничего не добавляет
        try {
            jdbc.sql(script).update();
        } finally {
            jdbc.sql("reset lock_timeout").update();
            jdbc.sql("reset statement_timeout").update();
        }
        assertThat(count("md_role_permissions")).isEqualTo(permissionsBefore);
    }

    private long count(String table) {
        return jdbc.sql("select count(*) from " + table).query(Long.class).single();
    }
}
