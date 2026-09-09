package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.InstanceApplication;
import com.greenwhite.dwh.instance.support.TestDatabases;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * AC-4: SchemaVersionGate — старт прерывается при отставшей или неуспешной миграции любой из БД.
 * Событие в логе проверяется по консольному JSON-выводу: Spring Boot переинициализирует Logback при старте,
 * и appender, подвешенный тестом заранее, теряется.
 */
@ExtendWith(OutputCaptureExtension.class)
class SchemaVersionGateTest {

    private static final String OLTP_OLD = "gate_oltp_old";
    private static final String DWH_FAILED = "gate_dwh_failed";

    @BeforeAll
    static void prepareDatabases() {
        TestDatabases.migrateOnce();
        // OLTP без последней миграции: применены только файлы A1 до V4
        TestDatabases.createDatabase(OLTP_OLD);
        Flyway.configure().dataSource(TestDatabases.database(OLTP_OLD)).locations("classpath:db/oltp").target("4").load().migrate();
        // pg-dwh, где последняя миграция помечена неуспешной
        TestDatabases.createDatabase(DWH_FAILED);
        FndMigrator.migrateDwh(TestDatabases.database(DWH_FAILED));
        JdbcClient.create(TestDatabases.database(DWH_FAILED))
                .sql("update flyway_schema_history set success = false where installed_rank = (select max(installed_rank) from flyway_schema_history)")
                .update();
    }

    @Test
    @DisplayName("AC-4: в OLTP нет последней миграции — SchemaVersionMismatchException, код выхода 3, событие в логе")
    void oltpBehindStopsStartup(CapturedOutput output) {
        Throwable failure = catchThrowable(() -> start(OLTP_OLD, TestDatabases.DWH_DB).close());
        SchemaVersionMismatchException mismatch = rootMismatch(failure);
        assertThat(mismatch.db()).isEqualTo("oltp");
        assertThat(mismatch.expected()).isNotEqualTo("4");
        assertThat(mismatch.actual()).isEqualTo("4");
        assertThat(((ExitCodeGenerator) mismatch).getExitCode()).isEqualTo(3);
        assertThat(output.getOut())
                .contains("\"event\":\"schema_version_mismatch\"")
                .contains("\"db\":\"oltp\"")
                .contains("\"actual\":\"4\"");
    }

    @Test
    @DisplayName("AC-4: в pg-dwh миграция помечена success=false — старт прерван с actual=failed:<версия>")
    void dwhFailedMigrationStopsStartup() {
        Throwable failure = catchThrowable(() -> start(TestDatabases.OLTP_DB, DWH_FAILED).close());
        SchemaVersionMismatchException mismatch = rootMismatch(failure);
        assertThat(mismatch.db()).isEqualTo("dwh");
        assertThat(mismatch.actual()).startsWith("failed:");
    }

    @Test
    @DisplayName("AC-4: обе БД на ожидаемой версии — контекст стартует, Flyway-бина в контексте нет (gate не мигрирует)")
    void matchingVersionsStart() {
        try (ConfigurableApplicationContext ctx = start(TestDatabases.OLTP_DB, TestDatabases.DWH_DB)) {
            assertThat(ctx.getBeansOfType(Flyway.class)).isEmpty();
            assertThat(ctx.getBean(SchemaVersionGate.class)).isNotNull();
        }
    }

    /** Свойства — аргументами командной строки: они выше application.yml (в отличие от default properties). */
    private static ConfigurableApplicationContext start(String oltpDb, String dwhDb) {
        List<String> args = List.of(
                "--server.port=0",
                "--spring.datasource.url=" + TestDatabases.jdbcUrl(oltpDb),
                "--spring.datasource.username=" + TestDatabases.USER,
                "--spring.datasource.password=",
                "--app.dwh.url=" + TestDatabases.jdbcUrl(dwhDb),
                "--app.dwh.username=" + TestDatabases.USER,
                "--app.dwh.password=",
                "--app.dwh.connect-timeout=2s",
                "--platform.oneid.mock=true",
                "--platform.bootstrap.admin-password=TEST-Admin12345",
                "--platform.bootstrap.admin-password-file=" + System.getProperty("java.io.tmpdir") + "/dwh-gate-test-password.txt");
        return new SpringApplicationBuilder(InstanceApplication.class).run(args.toArray(String[]::new));
    }

    private static SchemaVersionMismatchException rootMismatch(Throwable failure) {
        assertThat(failure).as("старт должен быть прерван").isNotNull();
        Throwable t = failure;
        while (t != null) {
            if (t instanceof SchemaVersionMismatchException m) {
                return m;
            }
            t = t.getCause();
        }
        throw new AssertionError("В цепочке причин нет SchemaVersionMismatchException: " + failure);
    }
}
