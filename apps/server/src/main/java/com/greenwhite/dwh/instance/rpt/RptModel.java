package com.greenwhite.dwh.instance.rpt;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/** Формы данных сводного отчёта (контракт И15а, раздел 2.1); имена компонент совпадают с именами JSON; поля со значением null
 * отдаются всегда (глобально non_null, контракт И15а/И15б требует null). */
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

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ReportItem(long id, String name, String sourceName, OffsetDateTime modifiedAt) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Measure(String kind, String field) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record KeyPair(String field, String refField) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RefPart(Long sourceId, Integer sheet, List<KeyPair> keys) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record LevelPart(String origin, String field) { }

    /**
     * Мера отчёта (контракт И15б, 10.3): ровно одно из {@code dateField} и {@code monthFields} (12 элементов, null — месяца нет);
     * {@code measure} — null при колонках-месяцах. У меры 1 {@code name} — её название или null (прежняя подпись).
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record MeasureInput(String name, Long sourceId, Integer sourceSheet, String dateField, List<String> monthFields,
                               Measure measure, Integer divisor, Integer decimals, RefPart ref, LevelPart level1,
                               LevelPart level2) { }

    /** Описание отчёта; {@code measureName}, {@code monthFields}, {@code second} — дополнение И15б, отсутствуют — null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
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

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Definition(long id, String name, long sourceId, int sourceSheet, String dateField, Measure measure,
                             int divisor, int decimals, RefPart ref, LevelPart level1, LevelPart level2,
                             int lockVersion, OffsetDateTime modifiedAt, String modifiedBy, Map<String, String> labels,
                             String measureName, List<String> monthFields, MeasureInput second) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SourceItem(long id, String code, String name) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SheetItem(int ordinal, String name) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ColumnItem(String field, String label, String type) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record SourceLayout(long sourceId, List<SheetItem> sheets, Integer sheet, List<ColumnItem> columns) { }

    /** Линия отчёта; {@code m2} и {@code ratio} — мера 2 и отношение (контракт И15б, 10.7), у отчёта с одной мерой null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Line(List<String> cells, String total, long count, M2 m2, Ratio ratio) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Line2(String key, String name, List<String> cells, String total, long count, M2 m2, Ratio ratio) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Line1(String key, String name, List<String> cells, String total, long count, List<Line2> lines,
                        M2 m2, Ratio ratio) { }

    /** Мера 2 линии: 12 месяцев, итог за месяцы 1…N, число строк за них. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record M2(List<String> cells, String total, long count) { }

    /** Отношение меры 1 к мере 2 в процентах: строка с 6 знаками или null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Ratio(List<String> cells, String total) { }

    /** Мера в ответе отчёта: {@code byMonthColumns} — месяцы из колонок-месяцев, а не из колонки-даты. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record MeasureInfo(String name, int divisor, int decimals, boolean byMonthColumns) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Labels(String level1, String level2, String measure) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Undated(long count, String value) { }

    /**
     * Отчёт: {@code cells}, {@code total}, {@code divisor}, {@code decimals}, {@code undated} — мера 1; {@code ytdMonth} — N,
     * итог = месяцы 1…N; {@code undated2} — строки без даты меры 2 или null.
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record ReportView(long reportId, String name, Integer year, List<Integer> years, int divisor, int decimals,
                             Labels labels, Line grand, List<Line1> lines, Undated undated, int refDuplicateKeys,
                             int ytdMonth, List<MeasureInfo> measures, Undated undated2) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Period(String kind, Integer month) { }

    /** Запрос строк ячейки; {@code measure} — 1 или 2, null — 1. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record CellQuery(Integer year, Period period, List<String> path, Integer offset, Integer measure) {

        /** Запрос строк ячейки меры 1. */
        public CellQuery(Integer year, Period period, List<String> path, Integer offset) {
            this(year, period, path, offset, null);
        }
    }

    /** Строка ячейки; {@code column} — подпись колонки-месяца из анкеты, у меры по дате null. */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record CellItem(String file, String sheet, Integer excelRow, String date, String measure, String level1,
                           String level2, String column) { }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record CellRows(long total, int offset, int limit, String value, List<CellItem> items) { }
}
