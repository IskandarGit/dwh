package com.greenwhite.dwh.instance.support;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * База интеграционных тестов: встроенный PostgreSQL с двумя базами ({@link TestDatabases}), миграции применены.
 *
 * <p>[допущение] Промпт 07 п.5 требует Testcontainers, но Docker в среде разработки недоступен
 * (нет прав администратора для установки). Взят {@code embedded-postgres} — тот же настоящий
 * PostgreSQL, запускаемый как процесс. Контракт тестов не меняется; при появлении Docker
 * замена обратима правкой одного класса.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
public abstract class EmbeddedPostgresTest {

    @Autowired
    private JdbcClient cleanupJdbc;
    @Autowired
    private TransactionTemplate cleanupTx;

    /**
     * Очищает пользователей, сессии, права и журналы между тестами. Журналы защищены триггером
     * append-only (миграция V2), поэтому удаление идёт в одной транзакции с флагом обслуживания.
     */
    protected void cleanUsersAndJournals() {
        cleanupTx.executeWithoutResult(tx -> {
            cleanupJdbc.sql("set local dwh.maintenance = 'on'").update();
            for (String table : new String[] {"security_events", "audit_log", "idempotency_keys", "kauth_login_failures", "kauth_sessions",
                    "kauth_auth_flows", "kauth_auth_codes_used", "kauth_link_requests",
                    "kauth_external_identities", "md_effective_permissions", "md_permissions_version",
                    "md_user_roles", "md_users"}) {
                cleanupJdbc.sql("delete from " + table).update();
            }
        });
    }

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        TestDatabases.migrateOnce();
        registry.add("spring.datasource.url", () -> TestDatabases.jdbcUrl(TestDatabases.OLTP_DB));
        registry.add("spring.datasource.username", () -> TestDatabases.USER);
        registry.add("spring.datasource.password", () -> "");
        // Вторая БД (pg-dwh) — в том же встроенном PostgreSQL (DoD AC-1)
        registry.add("app.dwh.url", () -> TestDatabases.jdbcUrl(TestDatabases.DWH_DB));
        registry.add("app.dwh.username", () -> TestDatabases.USER);
        registry.add("app.dwh.password", () -> "");
        registry.add("app.dwh.connect-timeout", () -> "2s");
        // OneID в тестах — mock-провайдер без сети (AC [допущение 10]); включается каждым тестом явно
        registry.add("platform.oneid.mock", () -> true);
        // Сгенерированный пароль bootstrap пишется в файл (AC-1/AC-17) — в тестах во временный каталог
        registry.add("platform.bootstrap.admin-password-file",
                () -> System.getProperty("java.io.tmpdir") + "/dwh-test-bootstrap-password.txt");
    }
}
