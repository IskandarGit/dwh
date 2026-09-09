package com.greenwhite.dwh.instance.support;

import com.greenwhite.dwh.instance.fnd.migration.FndMigrator;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;

/**
 * Один встроенный PostgreSQL на всю сборку и две базы в нём (решение архитектора 06.09, DoD AC-1):
 * {@code postgres} — OLTP, {@code dwh} — pg-dwh. Миграции применяются программно один раз;
 * автомиграция при старте контекста выключена (02 п.10).
 */
public final class TestDatabases {

    public static final String OLTP_DB = "postgres";
    public static final String DWH_DB = "dwh";
    public static final String USER = "postgres";

    private static EmbeddedPostgres postgres;
    private static final Set<String> created = new HashSet<>();
    private static boolean migrated;

    private TestDatabases() {
    }

    public static synchronized EmbeddedPostgres instance() {
        if (postgres == null) {
            try {
                postgres = EmbeddedPostgres.builder().setServerConfig("timezone", "UTC").start();
            } catch (IOException e) {
                throw new UncheckedIOException("Встроенный PostgreSQL не запустился", e);
            }
            createDatabase(DWH_DB);
        }
        return postgres;
    }

    /** Создаёт базу с именем {@code name}, если её ещё нет (для сценариев со свежей схемой). */
    public static synchronized void createDatabase(String name) {
        instance();
        if (created.contains(name)) {
            return;
        }
        try (Connection c = postgres.getPostgresDatabase().getConnection(); Statement st = c.createStatement()) {
            st.execute("create database " + name);
            created.add(name);
        } catch (SQLException e) {
            throw new IllegalStateException("Не удалось создать базу " + name, e);
        }
    }

    /** Применяет миграции обеих БД один раз на сборку. */
    public static synchronized void migrateOnce() {
        instance();
        if (!migrated) {
            FndMigrator.migrateOltp(oltp());
            FndMigrator.migrateDwh(dwh());
            migrated = true;
        }
    }

    public static DataSource oltp() {
        return instance().getDatabase(USER, OLTP_DB);
    }

    public static DataSource dwh() {
        return instance().getDatabase(USER, DWH_DB);
    }

    public static DataSource database(String name) {
        return instance().getDatabase(USER, name);
    }

    public static String jdbcUrl(String database) {
        return instance().getJdbcUrl(USER, database);
    }
}
