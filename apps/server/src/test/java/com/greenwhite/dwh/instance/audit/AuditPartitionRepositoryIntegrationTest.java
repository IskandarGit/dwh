package com.greenwhite.dwh.instance.audit;

import com.greenwhite.dwh.instance.audit.repository.AuditPartitionRepository;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.YearMonth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * FR-AUD-2: срок хранения оперативного журнала на настоящей PostgreSQL.
 *
 * Логику окна проверяют моки, но сам DDL — {@code detach partition} и
 * {@code rename to} — на моках не проверяется никак, а ошибка здесь стоит
 * дороже прочих: партиция уходит из журнала вместе с записями.
 */
@Testcontainers
class AuditPartitionRepositoryIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_partition_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;
    static AuditPartitionRepository repository;

    @BeforeAll
    static void setup() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);
        repository = new AuditPartitionRepository(jdbc);
    }

    @Test
    @DisplayName("Отцепление уносит партицию из журнала, но сохраняет её строки в базе")
    void detachKeepsRowsButRemovesThemFromTheLog() {
        YearMonth month = YearMonth.of(2026, 8);
        assertThat(repository.exists(month)).isTrue();

        jdbc.sql("""
                        insert into audit_log (table_name, row_pk, event, changed_at, changed_columns)
                        values ('probe_table', '1', 'I', timestamptz '2026-08-15 10:00:00+00', array['x'])
                        """)
                .update();
        assertThat(countInLog("probe_table")).isEqualTo(1);

        String archived = repository.detachAndArchive(month);

        assertThat(archived).isEqualTo("audit_log_archived_2026_08");
        assertThat(countInLog("probe_table"))
                .as("после отцепления записи уходят из оперативного журнала").isZero();
        assertThat(countInTable(archived, "probe_table"))
                .as("но остаются в базе: удаление аудита — решение эксплуатации").isEqualTo(1);
    }

    @Test
    @DisplayName("Список отцепляемых партиций не включает аварийный приёмник")
    void defaultPartitionIsNeverListedForDetach() {
        var old = repository.attachedPartitionsBefore(YearMonth.of(2027, 1));

        assertThat(old).isNotEmpty();
        assertThat(old).allSatisfy(month ->
                assertThat(month).isBefore(YearMonth.of(2027, 1)));
        assertThat(repository.attachedPartitionsBefore(YearMonth.of(2020, 1)))
                .as("до появления партиций отцеплять нечего").isEmpty();
    }

    private static long countInLog(String tableName) {
        return jdbc.sql("select count(*) from audit_log where table_name = :t")
                .param("t", tableName)
                .query(Long.class).single();
    }

    private static long countInTable(String table, String tableName) {
        return jdbc.sql("select count(*) from " + table + " where table_name = :t")
                .param("t", tableName)
                .query(Long.class).single();
    }

    // ------------------------------------------------------------------
    // FR-AUD-1: журнал только дополняется
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Строку журнала нельзя изменить и нельзя удалить")
    void auditLogRowsAreImmutable() {
        jdbc.sql("""
                        insert into audit_log (table_name, row_pk, event, changed_at)
                        values ('immutability_probe', '1', 'I', now())
                        """)
                .update();

        assertThatThrownBy(() -> jdbc.sql(
                        "update audit_log set row_pk = '2' where table_name = 'immutability_probe'").update())
                .hasMessageContaining("audit_log неизменяем");

        assertThatThrownBy(() -> jdbc.sql(
                        "delete from audit_log where table_name = 'immutability_probe'").update())
                .hasMessageContaining("audit_log неизменяем");

        assertThat(countInLog("immutability_probe"))
                .as("запись на месте: обе попытки отклонены").isEqualTo(1);
    }

    @Test
    @DisplayName("Запрет не мешает отцеплению партиций: срок хранения продолжает работать")
    void immutabilityDoesNotBlockRetention() {
        YearMonth month = YearMonth.of(2026, 9);
        jdbc.sql("""
                        insert into audit_log (table_name, row_pk, event, changed_at)
                        values ('retention_probe', '1', 'I', timestamptz '2026-09-10 10:00:00+00')
                        """)
                .update();

        String archived = repository.detachAndArchive(month);

        assertThat(countInTable(archived, "retention_probe")).isEqualTo(1);
    }

    @Test
    @DisplayName("Создание новой партиции через функцию успешно привязывает её к audit_log")
    void createPartitionSuccessfullyCreatesAndAllowsInserts() {
        YearMonth futureMonth = YearMonth.of(2028, 5);
        assertThat(repository.exists(futureMonth)).isFalse();

        repository.create(futureMonth);
        assertThat(repository.exists(futureMonth)).isTrue();

        // Проверяем, что в созданную партицию можно писать
        jdbc.sql("""
                        insert into audit_log (table_name, row_pk, event, changed_at)
                        values ('future_probe', '42', 'I', timestamptz '2028-05-15 12:00:00+00')
                        """)
                .update();

        assertThat(countInLog("future_probe")).isEqualTo(1);
    }

    @Test
    @DisplayName("Некорректный год или месяц отклоняются с исключением")
    void invalidYearOrMonthThrowsException() {
        assertThatThrownBy(() -> repository.create(YearMonth.of(1999, 1)))
                .hasMessageContaining("Invalid year");
    }
}
