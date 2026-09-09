package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;

/**
 * Программное применение миграций обеих БД (промпт 02 п.10: «мигрируй → gate → старт»; AC-1, AC-3).
 * Автомиграция при старте приложения выключена ({@code spring.flyway.enabled=false}); этот класс
 * вызывают {@link MigrateMain} (поставка), dev-запуск и тесты.
 */
public final class FndMigrator {

    private static final Logger log = LoggerFactory.getLogger(FndMigrator.class);

    private FndMigrator() {
    }

    /** Миграции OLTP из {@code db/oltp}; возвращает число применённых файлов. */
    public static int migrateOltp(DataSource oltp) {
        return migrate(oltp, FndPref.OLTP_MIGRATIONS, "oltp");
    }

    /** Миграции pg-dwh из {@code db/dwh}; возвращает число применённых файлов. */
    public static int migrateDwh(DataSource dwh) {
        return migrate(dwh, FndPref.DWH_MIGRATIONS, "dwh");
    }

    private static int migrate(DataSource dataSource, String location, String db) {
        Flyway flyway = Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:" + location)
                .baselineOnMigrate(false)
                .validateOnMigrate(true)
                .load();
        MigrateResult result = flyway.migrate();
        log.info("migrations_applied db={} count={} schemaVersion={}", db, result.migrationsExecuted, result.targetSchemaVersion);
        return result.migrationsExecuted;
    }
}
