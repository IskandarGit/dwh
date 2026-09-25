package com.greenwhite.dwh.instance.fnd.dwh;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Что свести из {@code raw.rows}: строки источника, справочник по ключу, до двух уровней,
 * месяцы — из колонки-даты или из колонок-месяцев, мера (контракт отчёта 4.1, 10.4). Ядро не знает, чьи это поля.
 * {@code year} читается только при {@link DatePeriod}; {@code untilMonth} — итог за год = месяцы 1..untilMonth, null — все.
 */
public record FndPivotSpec(FndRawSpec data, Period period, String measureField,
                           FndRawSpec ref, List<Key> keys, Level level1, Level level2, Integer year, Integer untilMonth) {

    private static final int MAX_KEYS = 2;
    private static final int MONTHS = 12;

    /** Месяц строки из колонки-даты: итог за год {@code untilMonth} не ограничен. */
    public FndPivotSpec(FndRawSpec data, String dateField, String measureField,
                        FndRawSpec ref, List<Key> keys, Level level1, Level level2, Integer year) {
        this(data, new DatePeriod(dateField), measureField, ref, keys, level1, level2, year, null);
    }

    public FndPivotSpec {
        if (data == null) {
            throw new IllegalArgumentException("Не задан источник");
        }
        if (period == null) {
            throw new IllegalArgumentException("Не задан период");
        }
        if (level1 == null) {
            throw new IllegalArgumentException("Не задан первый уровень");
        }
        requirePeriod(data, period, measureField);
        if (untilMonth != null && (untilMonth < 1 || untilMonth > MONTHS)) {
            throw new IllegalArgumentException("Месяц итога за год — от 1 до 12");
        }
        keys = keys == null ? List.of() : List.copyOf(keys);
        requireKeys(data, ref, keys);
        requireLevel(data, ref, level1);
        if (level2 != null) {
            requireLevel(data, ref, level2);
        }
    }

    /** Поле даты при {@link DatePeriod}, иначе null. */
    public String dateField() {
        return period instanceof DatePeriod date ? date.field() : null;
    }

    private static void requirePeriod(FndRawSpec data, Period period, String measureField) {
        switch (period) {
            case DatePeriod date -> {
                if (date.field() == null) {
                    throw new IllegalArgumentException("Не задано поле даты");
                }
                if (data.columns().get(date.field()) != FndRawSpec.Type.DATE) {
                    throw new IllegalArgumentException("Поле даты не из источника или не дата");
                }
                if (measureField != null && data.columns().get(measureField) != FndRawSpec.Type.NUMBER) {
                    throw new IllegalArgumentException("Поле меры не из источника или не число");
                }
            }
            case MonthsPeriod months -> {
                if (measureField != null) {
                    throw new IllegalArgumentException("При колонках-месяцах поле меры не задаётся");
                }
                for (String field : months.fields()) {
                    if (field != null && data.columns().get(field) != FndRawSpec.Type.NUMBER) {
                        throw new IllegalArgumentException("Колонка-месяц не из источника или не число");
                    }
                }
            }
        }
    }

    private static void requireKeys(FndRawSpec data, FndRawSpec ref, List<Key> keys) {
        if (ref == null) {
            if (!keys.isEmpty()) {
                throw new IllegalArgumentException("Ключи заданы без справочника");
            }
            return;
        }
        if (keys.isEmpty() || keys.size() > MAX_KEYS) {
            throw new IllegalArgumentException("Справочнику нужны один или два ключа");
        }
        for (Key key : keys) {
            if (key == null || !data.columns().containsKey(key.field()) || !ref.columns().containsKey(key.refField())) {
                throw new IllegalArgumentException("Поле ключа не из источника или справочника");
            }
        }
    }

    private static void requireLevel(FndRawSpec data, FndRawSpec ref, Level level) {
        if (level.origin() == null) {
            throw new IllegalArgumentException("Не задано, откуда поле уровня");
        }
        boolean known = switch (level.origin()) {
            case DATA -> data.columns().containsKey(level.field());
            case REF -> ref != null && ref.columns().containsKey(level.field());
        };
        if (!known) {
            throw new IllegalArgumentException("Поле уровня не из источника или справочника");
        }
    }

    /** Откуда месяц строки. */
    public sealed interface Period permits DatePeriod, MonthsPeriod { }

    /** Месяц и год — из поля DATE; мера — {@code measureField}. */
    public record DatePeriod(String field) implements Period { }

    /**
     * Двенадцать полей NUMBER — значения месяцев 1..12; null — месяца нет. Строка источника даёт пары
     * «месяц, значение»; года нет.
     */
    public record MonthsPeriod(List<String> fields) implements Period {

        public MonthsPeriod {
            if (fields == null || fields.size() != MONTHS) {
                throw new IllegalArgumentException("Колонок-месяцев должно быть 12");
            }
            if (fields.stream().allMatch(Objects::isNull)) {
                throw new IllegalArgumentException("Не задана ни одна колонка-месяц");
            }
            fields = Collections.unmodifiableList(new ArrayList<>(fields));
        }
    }

    public record Key(String field, String refField) { }

    public enum Origin { DATA, REF }

    public record Level(Origin origin, String field) { }

    /** Ячейка: depth 0 — общий итог, 1 — уровень 1, 2 — уровень 2; month null — итог за год. value — сумма меры (при measureField null — число строк). */
    public record Cell(int depth, String key1, String key2, Integer month, long count, BigDecimal value, String name1, String name2) { }

    /** {@code monthsWithRows} — месяцы, где у меры есть строки, по возрастанию. */
    public record Pivot(List<Integer> years, List<Cell> cells, long undatedCount, BigDecimal undatedValue, int refDuplicateKeys,
                        List<Integer> monthsWithRows) { }

    public enum PeriodKind { MONTH, YEAR, UNDATED }

    /** path: [] — общий итог, [k1] — строка уровня 1, [k1, k2] — уровня 2; элементы — key групп (null — «Без названия»). */
    public record CellQuery(PeriodKind kind, Integer month, List<String> path) {

        public CellQuery {
            if (path == null) {
                throw new IllegalArgumentException("Не задан путь ячейки");
            }
            path = Collections.unmodifiableList(new ArrayList<>(path));
        }
    }

    /** {@code column} — поле колонки-месяца, из которой значение; у колонки-даты null. */
    public record CellRow(long loadId, String sheet, Integer sourceRowNo, String date, String measure, String level1, String level2,
                          String column) { }

    public record CellRows(long total, BigDecimal value, List<CellRow> rows) { }
}
