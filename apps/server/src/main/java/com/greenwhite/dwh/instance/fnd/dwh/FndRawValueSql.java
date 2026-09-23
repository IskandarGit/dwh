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
                + " then replace(" + stripped(t) + ", ',', '.')::numeric end)";
    }

    private static String dateSql(String t) {
        String s = stripped(t);
        String isoLastDay = "extract(day from make_date(" + part(s, "1, 4") + ", " + part(s, "6, 2") + ", 1) + interval '1 month - 1 day')";
        String ruLastDay = "extract(day from make_date(" + part(s, "7, 4") + ", " + part(s, "4, 2") + ", 1) + interval '1 month - 1 day')";
        return "(case when " + t + " ~ '^\\s*\\d{1,7}(\\.\\d+)?\\s*$' and " + s + "::numeric between 1 and 2958465"
                + " then date '1899-12-30' + floor(" + s + "::numeric)::int"
                + " when " + t + " ~ '^\\s*[1-9]\\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\\s*$'"
                + " then " + existingDate(s, part(s, "9, 2"), isoLastDay, "YYYY-MM-DD")
                + " when " + t + " ~ '^\\s*(0[1-9]|[12]\\d|3[01])\\.(0[1-9]|1[0-2])\\.[1-9]\\d{3}\\s*$'"
                + " then " + existingDate(s, part(s, "1, 2"), ruLastDay, "DD.MM.YYYY") + " end)";
    }

    /**
     * Текст без пробельных символов по краям — то, что допускают {@code \s*} регулярок.
     * Обрезка тем же классом {@code \s}, что и проверки формата — иначе символ, который проверка
     * считает пробелом, а обрезка нет, роняет запрос.
     */
    private static String stripped(String t) {
        return "regexp_replace(" + t + ", '^\\s+|\\s+$', '', 'g')";
    }

    /**
     * Дата по формату, если такой день есть в месяце, иначе null (31.04 — не ошибка базы).
     * Вложенный CASE, а не {@code and}: порядок вычисления CASE гарантирован.
     */
    private static String existingDate(String s, String day, String lastDay, String format) {
        return "(case when " + day + " <= " + lastDay + " then to_date(" + s + ", '" + format + "') end)";
    }

    /** Часть текста числом: {@code fromAndLength} — «начало, длина» для substr. */
    private static String part(String s, String fromAndLength) {
        return "substr(" + s + ", " + fromAndLength + ")::int";
    }
}
