package com.greenwhite.dwh.instance.fnd.dwh;

/**
 * Перевод текста ячейки raw в значение по типу — одно место на все запросы (контракт обзора, раздел 3).
 * Непереводимое — null, а не ошибка базы.
 *
 * <p>Аргумент {@code text} методов — SQL-выражение текста ячейки (например {@code fields ->> :f0});
 * его склеивают только этот класс и {@code FndRawReader}.
 */
public final class FndRawValueSql {

    private FndRawValueSql() {
    }

    /** SQL-выражение значения по типу: TEXT — текст, NUMBER — numeric, DATE — date; непереводимое — null. */
    public static String converted(FndRawSpec.Type type, String text) {
        return switch (type) {
            case TEXT -> text;
            case NUMBER -> numberSql(text);
            case DATE -> dateSql(text);
        };
    }

    /** SQL-выражение значения в едином виде для ответа; непереводимое — текстом как в файле (контракт 3.3). */
    public static String canonical(FndRawSpec.Type type, String text) {
        if (type == FndRawSpec.Type.TEXT) {
            return text;
        }
        return "coalesce((" + converted(type, text) + ")::text, " + text + ")";
    }

    /** Шаблон «содержит» для {@code ilike ... escape '\'}: спецсимволы LIKE экранированы. */
    public static String likePattern(String value) {
        String escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }

    private static String numberSql(String t) {
        // Экспонента ограничена 3 цифрами: иначе переполнение numeric роняет весь запрос вместо null
        return "(case when " + t + " ~ '^\\s*-?\\d+([.,]\\d+)?([eE][-+]?\\d{1,3})?\\s*$'"
                + " then replace(trim(" + t + "), ',', '.')::numeric end)";
    }

    private static String dateSql(String t) {
        return "(case when " + t + " ~ '^\\s*\\d{1,7}(\\.\\d+)?\\s*$' and trim(" + t + ")::numeric between 1 and 2958465"
                + " then date '1899-12-30' + floor(trim(" + t + ")::numeric)::int"
                + " when " + t + " ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$' then to_date(" + t + ", 'YYYY-MM-DD')"
                + " when " + t + " ~ '^(0[1-9]|[12]\\d|3[01])\\.(0[1-9]|1[0-2])\\.\\d{4}$' then to_date(" + t + ", 'DD.MM.YYYY') end)";
    }
}
