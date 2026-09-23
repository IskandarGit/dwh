package com.greenwhite.dwh.instance.fnd.dwh;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Что читать из {@code raw.rows} второй базы: загрузки, лист и типизированные поля {@code fields} (ключ → тип).
 * Ядро не знает, чьи это поля.
 */
public record FndRawSpec(List<Long> loadIds, String sheet, LinkedHashMap<String, Type> columns) {

    public FndRawSpec {
        if (loadIds == null) {
            throw new IllegalArgumentException("Не заданы загрузки");
        }
        if (sheet == null) {
            throw new IllegalArgumentException("Не задан лист");
        }
        if (columns == null) {
            throw new IllegalArgumentException("Не заданы поля");
        }
        loadIds = List.copyOf(loadIds);
        columns = new LinkedHashMap<>(columns);
    }

    /** Тип поля; поля нет в спецификации — {@link IllegalArgumentException}. */
    public Type type(String field) {
        Type type = columns.get(field);
        if (type == null) {
            throw new IllegalArgumentException("Поля нет в спецификации");
        }
        return type;
    }

    public enum Type { TEXT, NUMBER, DATE }

    public sealed interface Filter permits Contains, Between, Eq {
        String field();
    }

    /** Текст содержит подстроку без учёта регистра. */
    public record Contains(String field, String text) implements Filter { }

    /** Переведённое значение в границах включительно; граница — BigDecimal (NUMBER) или LocalDate (DATE), null — нет границы. */
    public record Between(String field, Object from, Object to) implements Filter { }

    /** Переведённое значение равно; value — String (TEXT), BigDecimal, LocalDate или null («пусто»). */
    public record Eq(String field, Object value) implements Filter { }

    public record Sort(String field, boolean descending) { }

    /** Строка raw: номер загрузки, лист, № строки Excel, значения полей в едином виде (контракт 2.1). */
    public record Row(long loadId, String sheet, Integer sourceRowNo, Map<String, String> values) { }

    /** Группа: значение в едином виде (null — «пусто»), число строк, суммы NUMBER-полей. */
    public record Group(String value, long count, Map<String, BigDecimal> sums) { }

    public record Groups(int groupsTotal, List<Group> groups) { }
}
