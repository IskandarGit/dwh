package com.greenwhite.dwh.instance.fnd.migration;

import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.Map;

/**
 * Шаг «мигрируй» поставки (промпт 02 п.10): применяет миграции OLTP и pg-dwh и завершает процесс.
 * Запуск из fat-jar: {@code java -cp app.jar -Dloader.main=com.greenwhite.dwh.instance.fnd.migration.MigrateMain
 * org.springframework.boot.loader.launch.PropertiesLauncher}; из распакованного образа
 * ({@code -Djarmode=tools extract}, раскладка {@code Dockerfile} каркаса) —
 * {@code java -cp app.jar com.greenwhite.dwh.instance.fnd.migration.MigrateMain}.
 * Подключения — только из окружения: {@code DWH_DB_URL/USER/PASSWORD} (OLTP)
 * и {@code DWH_DATA_DB_URL/USER/PASSWORD} (pg-dwh).
 * Область задаёт {@code DWH_MIGRATE_SCOPE}: {@code all} (по умолчанию) — обе базы; {@code dwh} — только pg-dwh,
 * OLTP мигрирует штатный профиль {@code migrate} каркаса.
 */
public final class MigrateMain {

    private static final String SCOPE_KEY = "DWH_MIGRATE_SCOPE";
    private static final String SCOPE_ALL = "all";
    private static final String SCOPE_DWH = "dwh";

    private MigrateMain() {
    }

    public static void main(String[] args) {
        System.out.println(run(System.getenv()));
    }

    static String run(Map<String, String> env) {
        String scope = env.getOrDefault(SCOPE_KEY, SCOPE_ALL);
        if (!SCOPE_ALL.equals(scope) && !SCOPE_DWH.equals(scope)) {
            throw new IllegalStateException(SCOPE_KEY + ": ожидается all или dwh, получено " + scope);
        }
        int oltp = SCOPE_ALL.equals(scope)
                ? FndMigrator.migrateOltp(dataSource(env, "DWH_DB_URL", "DWH_DB_USER", "DWH_DB_PASSWORD"))
                : 0;
        int dwh = FndMigrator.migrateDwh(dataSource(env, "DWH_DATA_DB_URL", "DWH_DATA_DB_USER", "DWH_DATA_DB_PASSWORD"));
        return "migrations applied: scope=" + scope + " oltp=" + oltp + " dwh=" + dwh;
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
