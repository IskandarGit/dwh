package com.greenwhite.dwh.instance.rpt;

/** Коды ошибок сводного отчёта (контракт И15а, раздел 7); текст даёт экран по ключу {@code rpt.err.<код>}. */
public final class RptErrors {

    public static final String RPT_REPORT_NOT_FOUND = "RPT_REPORT_NOT_FOUND";
    public static final String RPT_DEFINITION_INVALID = "RPT_DEFINITION_INVALID";
    public static final String RPT_NAME_TAKEN = "RPT_NAME_TAKEN";
    public static final String RPT_SOURCE_UNKNOWN = "RPT_SOURCE_UNKNOWN";
    public static final String RPT_COLUMN_UNKNOWN = "RPT_COLUMN_UNKNOWN";
    public static final String RPT_COLUMN_TYPE = "RPT_COLUMN_TYPE";
    public static final String RPT_KEYS_INVALID = "RPT_KEYS_INVALID";
    public static final String RPT_LEVEL_INVALID = "RPT_LEVEL_INVALID";
    public static final String RPT_FORMAT_INVALID = "RPT_FORMAT_INVALID";
    public static final String RPT_DEFINITION_STALE = "RPT_DEFINITION_STALE";
    public static final String RPT_CONFLICT = "RPT_CONFLICT";
    public static final String RPT_TOO_MANY_LINES = "RPT_TOO_MANY_LINES";
    public static final String RPT_CELL_INVALID = "RPT_CELL_INVALID";
    public static final String RPT_MODULE_DISABLED = "RPT_MODULE_DISABLED";
    public static final String RPT_QUERY_TIMEOUT = "RPT_QUERY_TIMEOUT";
    /** У меры нет периода или заданы оба; мера задана при колонках-месяцах (контракт И15б, 10.9). */
    public static final String RPT_PERIOD_INVALID = "RPT_PERIOD_INVALID";
    /** Все 12 колонок-месяцев не заданы. */
    public static final String RPT_MONTHS_EMPTY = "RPT_MONTHS_EMPTY";
    /** У меры 2 другое число уровней строк, чем у меры 1. */
    public static final String RPT_LEVELS_MISMATCH = "RPT_LEVELS_MISMATCH";
    /** Название меры пусто или длиннее предела. */
    public static final String RPT_MEASURE_NAME_INVALID = "RPT_MEASURE_NAME_INVALID";

    private RptErrors() {
    }
}
