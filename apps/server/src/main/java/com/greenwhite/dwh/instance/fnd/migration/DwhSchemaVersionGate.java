package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.math.BigInteger;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;


/**
 * Проверка при старте второй базы {@code pg-dwh}: последняя миграция сборки применена и успешна
 * (промпт 02 п.10; AC-4). Схему OLTP проверяет gate каркаса
 * ({@code com.greenwhite.dwh.instance.config.db.SchemaVersionGate}) — здесь она не дублируется.
 * Gate только читает {@code flyway_schema_history} и никогда не мигрирует: применение — отдельный шаг
 * ({@link MigrateMain}) до запуска приложения. Расхождение — {@link SchemaVersionMismatchException},
 * процесс завершается кодом 3.
 */
@Component
public class DwhSchemaVersionGate implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(DwhSchemaVersionGate.class);
    static final String EVENT = "schema_version_mismatch";
    private static final String HISTORY_SQL = """
            select version, success
              from flyway_schema_history
             where version is not null
             order by installed_rank desc
            """;

    private final DataSource dwh;

    public DwhSchemaVersionGate(@Qualifier(FndPref.DWH) DataSource dwh) {
        this.dwh = dwh;
    }

    @Override
    public void afterPropertiesSet() {
        check("dwh", dwh, MigrationCatalog.onClasspath(FndPref.DWH_MIGRATIONS));
        log.info("schema_version_ok db=dwh");
    }

    /** Одна БД: ожидаемая версия найдена, ни одна строка истории не помечена {@code success=false}. */
    void check(String db, DataSource dataSource, MigrationCatalog catalog) {
        String expected = catalog.latestVersion();
        String actual = readActual(db, dataSource, expected);
        if (!expected.equals(actual)) {
            log.error("{} db={} expected={} actual={}", EVENT, db, expected, actual);
            throw new SchemaVersionMismatchException(db, expected, actual);
        }
    }

    private String readActual(String db, DataSource dataSource, String expected) {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(HISTORY_SQL);
             ResultSet rs = ps.executeQuery()) {
            String latest = null;
            boolean expectedFound = false;
            while (rs.next()) {
                // Flyway хранит версию как в имени файла (001); сравнение — численное
                String version = new BigInteger(rs.getString(1)).toString();
                if (!rs.getBoolean(2)) {
                    return "failed:" + version;
                }
                if (latest == null) {
                    latest = version;
                }
                if (expected.equals(version)) {
                    expectedFound = true;
                }
            }
            if (latest == null) {
                return "none";
            }
            return expectedFound ? expected : latest;
        } catch (SQLException e) {
            if ("42P01".equals(e.getSQLState())) {
                return "none"; // таблицы истории нет — миграции не применялись
            }
            throw new IllegalStateException("Не удалось прочитать flyway_schema_history в " + db, e);
        }
    }
}
