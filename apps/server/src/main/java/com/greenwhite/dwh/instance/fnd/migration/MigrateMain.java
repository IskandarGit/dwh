package com.greenwhite.dwh.instance.fnd.migration;

import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.Map;

/**
 * Шаг «мигрируй» поставки (промпт 02 п.10): применяет миграции OLTP и pg-dwh и завершает процесс.
 * Запуск: {@code java -cp app.jar -Dloader.main=com.greenwhite.dwh.instance.fnd.migration.MigrateMain
 * org.springframework.boot.loader.launch.PropertiesLauncher}. Подключения — только из окружения:
 * {@code DWH_DB_URL/USER/PASSWORD} (OLTP) и {@code DWH_DATA_DB_URL/USER/PASSWORD} (pg-dwh).
 */
public final class MigrateMain {

    private MigrateMain() {
    }

    public static void main(String[] args) {
        Map<String, String> env = System.getenv();
        int oltp = FndMigrator.migrateOltp(dataSource(env, "DWH_DB_URL", "DWH_DB_USER", "DWH_DB_PASSWORD"));
        int dwh = FndMigrator.migrateDwh(dataSource(env, "DWH_DATA_DB_URL", "DWH_DATA_DB_USER", "DWH_DATA_DB_PASSWORD"));
        System.out.println("migrations applied: oltp=" + oltp + " dwh=" + dwh);
    }

    private static DriverManagerDataSource dataSource(Map<String, String> env, String urlKey, String userKey, String passwordKey) {
        String url = env.get(urlKey);
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("Не задана переменная окружения " + urlKey);
        }
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setUrl(url);
        ds.setUsername(env.getOrDefault(userKey, "dwh"));
        ds.setPassword(env.getOrDefault(passwordKey, ""));
        return ds;
    }
}
