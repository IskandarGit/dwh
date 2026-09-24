package com.greenwhite.dwh.instance.rpt;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/** Формы данных сводного отчёта (контракт И15а, раздел 2.1); имена компонент совпадают с именами JSON. */
public final class RptModel {

    /** Колонка источника отчёта. */
    public static final String ORIGIN_SOURCE = "source";
    /** Колонка справочника. */
    public static final String ORIGIN_REF = "ref";
    /** Мера — сумма числовой колонки. */
    public static final String MEASURE_TOTAL = "total";
    /** Мера — число строк. */
    public static final String MEASURE_COUNT = "count";
    /** Мера — сумма колонок-месяцев; только в базе ({@code measure_kind}), в API {@code measure = null}. */
    public static final String MEASURE_MONTHS = "months";
    /** Ячейка месяца. */
    public static final String PERIOD_MONTH = "month";
    /** Ячейка «Итого» за год. */
    public static final String PERIOD_YEAR = "year";
    /** Строки без даты. */
    public static final String PERIOD_UNDATED = "undated";

    private RptModel() {
    }

    public record ReportItem(long id, String name, String sourceName, OffsetDateTime modifiedAt) { }

    public record Measure(String kind, String field) { }

    public record KeyPair(String field, String refField) { }

    public record RefPart(Long sourceId, Integer sheet, List<KeyPair> keys) { }

    public record LevelPart(String origin, String field) { }

    /**
     * Мера отчёта (контракт И15б, 10.3): ровно одно из {@code dateField} и {@code monthFields} (12 элементов, null — месяца нет);
     * {@code measure} — null при колонках-месяцах. У меры 1 {@code name} — её название или null (прежняя подпись).
     */
    public record MeasureInput(String name, Long sourceId, Integer sourceSheet, String dateField, List<String> monthFields,
                               Measure measure, Integer divisor, Integer decimals, RefPart ref, LevelPart level1,
                               LevelPart level2) { }

    /** Описание отчёта; {@code measureName}, {@code monthFields}, {@code second} — дополнение И15б, отсутствуют — null. */
    public record DefinitionInput(String name, Long sourceId, Integer sourceSheet, String dateField, Measure measure,
                                  Integer divisor, Integer decimals, RefPart ref, LevelPart level1, LevelPart level2,
                                  Integer lockVersion, String measureName, List<String> monthFields, MeasureInput second) {

        /** Прежнее описание И15а: одна мера по колонке-дате, без названия меры. */
        public DefinitionInput(String name, Long sourceId, Integer sourceSheet, String dateField, Measure measure,
                               Integer divisor, Integer decimals, RefPart ref, LevelPart level1, LevelPart level2,
                               Integer lockVersion) {
            this(name, sourceId, sourceSheet, dateField, measure, divisor, decimals, ref, level1, level2, lockVersion,
                    null, null, null);
        }

        /** Мера 1 в том же виде, что мера 2; её название — {@code measureName}. */
        public MeasureInput first() {
            return new MeasureInput(measureName, sourceId, sourceSheet, dateField, monthFields, measure, divisor, decimals,
                    ref, level1, level2);
        }
    }

    public record Definition(long id, String name, long sourceId, int sourceSheet, String dateField, Measure measure,
                             int divisor, int decimals, RefPart ref, LevelPart level1, LevelPart level2,
                             int lockVersion, OffsetDateTime modifiedAt, String modifiedBy, Map<String, String> labels,
                             String measureName, List<String> monthFields, MeasureInput second) { }

    public record SourceItem(long id, String code, String name) { }

    public record SheetItem(int ordinal, String name) { }

    public record ColumnItem(String field, String label, String type) { }

    public record SourceLayout(long sourceId, List<SheetItem> sheets, Integer sheet, List<ColumnItem> columns) { }

    public record Line(List<String> cells, String total, long count) { }

    public record Line2(String key, String name, List<String> cells, String total, long count) { }

    public record Line1(String key, String name, List<String> cells, String total, long count, List<Line2> lines) { }

    public record Labels(String level1, String level2, String measure) { }

    public record Undated(long count, String value) { }

    public record ReportView(long reportId, String name, Integer year, List<Integer> years, int divisor, int decimals,
                             Labels labels, Line grand, List<Line1> lines, Undated undated, int refDuplicateKeys) { }

    public record Period(String kind, Integer month) { }

    public record CellQuery(Integer year, Period period, List<String> path, Integer offset) { }

    public record CellItem(String file, String sheet, Integer excelRow, String date, String measure, String level1,
                           String level2) { }

    public record CellRows(long total, int offset, int limit, String value, List<CellItem> items) { }
}
