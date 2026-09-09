package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.springframework.boot.ExitCodeGenerator;

/**
 * Схема одной из БД не соответствует ожидаемой сборкой: старт прерывается, код выхода процесса — 3 (AC-4).
 *
 * @param db       {@code oltp} или {@code dwh}
 * @param expected последняя версия миграций на classpath
 * @param actual   что нашлось в {@code flyway_schema_history} (версия, {@code failed:<v>} или {@code none})
 */
public class SchemaVersionMismatchException extends RuntimeException implements ExitCodeGenerator {

    private final String db;
    private final String expected;
    private final String actual;

    public SchemaVersionMismatchException(String db, String expected, String actual) {
        super("schema_version_mismatch db=" + db + " expected=" + expected + " actual=" + actual);
        this.db = db;
        this.expected = expected;
        this.actual = actual;
    }

    public String db() {
        return db;
    }

    public String expected() {
        return expected;
    }

    public String actual() {
        return actual;
    }

    @Override
    public int getExitCode() {
        return FndPref.EXIT_SCHEMA_MISMATCH;
    }
}
