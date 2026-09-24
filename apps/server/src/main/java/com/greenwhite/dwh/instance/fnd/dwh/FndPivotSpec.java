package com.greenwhite.dwh.instance.fnd.dwh;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Что свести из {@code raw.rows}: строки источника, справочник по ключу, до двух уровней,
 * месяцы года, мера (контракт отчёта 4.1). Ядро не знает, чьи это поля.
 */
public record FndPivotSpec(FndRawSpec data, String dateField, String measureField,
                           FndRawSpec ref, List<Key> keys, Level level1, Level level2, Integer year) {

    private static final int MAX_KEYS = 2;

    public FndPivotSpec {
        if (data == null) {
            throw new IllegalArgumentException("Не задан источник");
        }
        if (dateField == null) {
            throw new IllegalArgumentException("Не задано поле даты");
        }
        if (level1 == null) {
            throw new IllegalArgumentException("Не задан первый уровень");
        }
        if (data.columns().get(dateField) != FndRawSpec.Type.DATE) {
            throw new IllegalArgumentException("Поле даты не из источника или не дата");
        }
        if (measureField != null && data.columns().get(measureField) != FndRawSpec.Type.NUMBER) {
            throw new IllegalArgumentException("Поле меры не из источника или не число");
        }
        keys = keys == null ? List.of() : List.copyOf(keys);
        requireKeys(data, ref, keys);
        requireLevel(data, ref, level1);
        if (level2 != null) {
            requireLevel(data, ref, level2);
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

    public record Key(String field, String refField) { }

    public enum Origin { DATA, REF }

    public record Level(Origin origin, String field) { }

    /** Ячейка: depth 0 — общий итог, 1 — уровень 1, 2 — уровень 2; month null — итог за год. value — сумма меры (при measureField null — число строк). */
    public record Cell(int depth, String key1, String key2, Integer month, long count, BigDecimal value, String name1, String name2) { }

    public record Pivot(List<Integer> years, List<Cell> cells, long undatedCount, BigDecimal undatedValue, int refDuplicateKeys) { }

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

    public record CellRow(long loadId, String sheet, Integer sourceRowNo, String date, String measure, String level1, String level2) { }

    public record CellRows(long total, BigDecimal value, List<CellRow> rows) { }
}
