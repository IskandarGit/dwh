package com.greenwhite.dwh.instance.fnd;

/** Константы основы: каталоги миграций, квалификатор второй БД, актор заданий. */
public final class FndPref {

    /** Каталог миграций OLTP (02 п.10, п.18). */
    public static final String OLTP_MIGRATIONS = "db/migration";
    /** Каталог миграций pg-dwh. */
    public static final String DWH_MIGRATIONS = "db/dwh";
    /** Квалификатор бинов второй БД; используется только внутри {@code ..instance.fnd..} (AC-5). */
    public static final String DWH = "dwh";
    /** Актор для операций заданий и сидов (доп.12, доп.15). */
    public static final String SYSTEM_ACTOR = "system";
    /** Код выхода процесса при расхождении схемы (AC-4). */
    public static final int EXIT_SCHEMA_MISMATCH = 3;

    private FndPref() {
    }
}
