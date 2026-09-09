package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.support.TestDatabases;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-1 (две БД, два набора миграций) и AC-3 (повторный прогон, схема A1 не изменена).
 * Без Spring-контекста: только мигратор и JDBC на встроенном PostgreSQL.
 */
class FndMigrationsTest {

    static final String SNAPSHOT = "a1-schema-snapshot.json";
    private static final String COLUMNS_SQL = """
            select table_name, column_name, data_type, is_nullable
              from information_schema.columns
             where table_schema = 'public'
             order by table_name, ordinal_position
            """;

    private static JdbcClient oltp;
    private static JdbcClient dwh;

    @BeforeAll
    static void migrate() {
        TestDatabases.migrateOnce();
        oltp = JdbcClient.create(TestDatabases.oltp());
        dwh = JdbcClient.create(TestDatabases.dwh());
    }

    @Test
    @DisplayName("AC-1: в OLTP — таблицы A1 и основы, в pg-dwh — схемы raw/core/mart/cache без таблиц модулей")
    void twoDatabasesTwoMigrationSets() {
        assertThat(oltp.sql("select count(*) from flyway_schema_history").query(Long.class).single()).isPositive();
        assertThat(dwh.sql("select count(*) from flyway_schema_history").query(Long.class).single()).isPositive();

        List<String> oltpTables = oltp.sql("select table_name from information_schema.tables where table_schema='public'")
                .query(String.class).list();
        assertThat(oltpTables).contains("md_users", "kauth_sessions", "audit_log", "security_events");
        // Таблицы основы появляются миграциями блоков B–E; здесь — только те, что уже есть
        // (список расширяется вместе с миграциями fnd; итоговый — в AC-1 после всех блоков)

        List<String> schemas = dwh.sql("select schema_name from information_schema.schemata").query(String.class).list();
        assertThat(schemas).contains("raw", "core", "mart", "cache");
        List<String> dwhTables = dwh.sql("select table_schema || '.' || table_name from information_schema.tables "
                        + "where table_schema in ('raw','core','mart','cache')").query(String.class).list();
        assertThat(dwhTables).contains("cache.items", "cache.generations");
        assertThat(dwhTables).noneMatch(t -> t.matches("^[a-z]+\\.(fnd|upl|ref|reg|vit|md|kauth|ms|mf)_.*"));
    }

    @Test
    @DisplayName("AC-3: второй прогон миграций — 0 применённых, без ошибок")
    void secondRunAppliesNothing() {
        assertThat(FndMigrator.migrateOltp(TestDatabases.oltp())).isZero();
        assertThat(FndMigrator.migrateDwh(TestDatabases.dwh())).isZero();
    }

    @Test
    @DisplayName("AC-3: схема таблиц A1 (снимок до миграций фичи) не изменена — только новые таблицы и колонки")
    void a1SchemaUnchanged() throws IOException {
        List<Map<String, Object>> snapshot = readSnapshot();
        List<Map<String, Object>> current = oltp.sql(COLUMNS_SQL).query().listOfRows();
        List<String> missingOrChanged = new ArrayList<>();
        for (Map<String, Object> row : snapshot) {
            boolean present = current.stream().anyMatch(c -> sameColumn(c, row));
            if (!present) {
                missingOrChanged.add(row.get("table_name") + "." + row.get("column_name")
                        + " " + row.get("data_type") + " nullable=" + row.get("is_nullable"));
            }
        }
        assertThat(missingOrChanged).as("колонки A1, изменённые или удалённые миграциями фичи").isEmpty();
    }

    private static boolean sameColumn(Map<String, Object> a, Map<String, Object> b) {
        return a.get("table_name").equals(b.get("table_name"))
                && a.get("column_name").equals(b.get("column_name"))
                && a.get("data_type").equals(b.get("data_type"))
                && a.get("is_nullable").equals(b.get("is_nullable"));
    }

    /**
     * Снимок схемы A1 — тест-ресурс, снятый один раз с базы, мигрированной только файлами A1 (V1–V5).
     * Пересъёмка: {@code mvn test -Dtest=FndMigrationsTest -Da1.snapshot.generate=true} — пишет файл в
     * {@code src/test/resources}; выполнять только при осознанном изменении схемы A1.
     */
    private static List<Map<String, Object>> readSnapshot() throws IOException {
        ObjectMapper json = new ObjectMapper();
        if (Boolean.getBoolean("a1.snapshot.generate")) {
            TestDatabases.createDatabase("a1_snapshot");
            org.flywaydb.core.Flyway.configure()
                    .dataSource(TestDatabases.database("a1_snapshot"))
                    .locations("classpath:db/oltp")
                    .target("5")
                    .load().migrate();
            List<Map<String, Object>> rows = JdbcClient.create(TestDatabases.database("a1_snapshot"))
                    .sql(COLUMNS_SQL).query().listOfRows();
            Path target = Path.of("src/test/resources", SNAPSHOT);
            Files.writeString(target, json.writerWithDefaultPrettyPrinter().writeValueAsString(rows));
            return rows;
        }
        try (InputStream in = FndMigrationsTest.class.getResourceAsStream("/" + SNAPSHOT)) {
            assertThat(in).as("тест-ресурс %s отсутствует — снять по инструкции в javadoc", SNAPSHOT).isNotNull();
            return json.readValue(in, json.getTypeFactory().constructCollectionType(List.class, Map.class));
        }
    }
}
