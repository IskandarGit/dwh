package com.greenwhite.dwh.instance.fnd.dwh;

/**
 * Перевод текста ячейки raw в значение по типу — одно место на все запросы (контракт обзора, раздел 3).
 * Непереводимое — null, а не ошибка базы.
 *
 * <p>Аргумент {@code text} методов — SQL-выражение текста ячейки (например {@code fields ->> :f0});
 * его склеивают только этот класс и {@code FndRawReader}.
 *
 * <p>В регулярках {@code [0-9]}, а не {@code \d}: {@code \d} базы пропускает любые цифры Юникода,
 * а приведение к числу их не понимает — запрос упал бы.
 */
public final class FndRawValueSql {

    /**
     * Знаков в ячейке числа или даты; длиннее — null. Предел базы — 16 383 цифр дроби;
     * 1000 знаков с экспонентой ≤ 999 дают не больше ~2000 цифр.
     */
    private static final int MAX_CELL_LENGTH = 1000;

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

    /** SQL-выражение значения уровня строк: число — по значению: 12 = 12.0 (как ключ 4.2); иначе как {@link #canonical}. */
    public static String level(FndRawSpec.Type type, String text) {
        if (type == FndRawSpec.Type.NUMBER) {
            return "coalesce(trim_scale(" + numberSql(text) + ")::text, " + text + ")";
        }
        return canonical(type, text);
    }

    /** Шаблон «содержит» для {@code ilike ... escape '\'}: спецсимволы LIKE экранированы. */
    public static String likePattern(String value) {
        String escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return "%" + escaped + "%";
    }

    /**
     * Ключ связи со справочником (контракт отчёта 4.2): число — по значению ({@code 1183} = {@code 1183.0}),
     * иначе текст без пробелов по краям с регистром; пусто и null — пустая строка (пусто = пусто);
     * длинная ячейка — null: ни с чем не совпадает.
     */
    public static String key(String text) {
        return "(case when length(" + text + ") > " + MAX_CELL_LENGTH + " then null else coalesce(trim_scale("
                + numberSql(text) + ")::text, nullif(" + stripped(text) + ", ''), '') end)";
    }

    /**
     * Название группы для сравнения (контракт отчёта 4.4): без пробелов по краям, строчными; пустое — null.
     * Строчные — по Unicode (ICU), не по языковым настройкам базы: на базе с {@code LC_CTYPE = C}
     * {@code lower} не трогает кириллицу.
     */
    public static String groupKey(String text) {
        return "nullif(lower((" + stripped(text) + ") collate \"und-x-icu\"), '')";
    }

    /** Название без пробелов по краям — написание для глаз; пустое — null. */
    public static String trimmed(String text) {
        return "nullif(" + stripped(text) + ", '')";
    }

    private static String numberSql(String t) {
        // Экспонента ограничена 3 цифрами: иначе переполнение numeric роняет весь запрос вместо null
        return shortOnly(t, "(case when " + t + " ~ '^\\s*-?[0-9]+([.,][0-9]+)?([eE][-+]?[0-9]{1,3})?\\s*$'"
                + " then replace(" + stripped(t) + ", ',', '.')::numeric end)");
    }

    private static String dateSql(String t) {
        String s = stripped(t);
        String isoLastDay = "extract(day from make_date(" + part(s, "1, 4") + ", " + part(s, "6, 2") + ", 1) + interval '1 month - 1 day')";
        String ruLastDay = "extract(day from make_date(" + part(s, "7, 4") + ", " + part(s, "4, 2") + ", 1) + interval '1 month - 1 day')";
        return shortOnly(t, "(case when " + t + " ~ '^\\s*[0-9]{1,7}(\\.[0-9]+)?\\s*$' and " + s + "::numeric between 1 and 2958465"
                + " then date '1899-12-30' + floor(" + s + "::numeric)::int"
                + " when " + t + " ~ '^\\s*[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\\s*$'"
                + " then " + existingDate(s, part(s, "9, 2"), isoLastDay, "YYYY-MM-DD")
                + " when " + t + " ~ '^\\s*(0[1-9]|[12][0-9]|3[01])\\.(0[1-9]|1[0-2])\\.[1-9][0-9]{3}\\s*$'"
                + " then " + existingDate(s, part(s, "1, 2"), ruLastDay, "DD.MM.YYYY") + " end)");
    }

    /**
     * Выражение только для текста не длиннее {@link #MAX_CELL_LENGTH}, длиннее — null без разбора.
     * Внешний CASE: порядок вычисления CASE гарантирован, длинная ячейка не доходит до приведения к numeric.
     */
    private static String shortOnly(String t, String expression) {
        return "(case when length(" + t + ") <= " + MAX_CELL_LENGTH + " then " + expression + " end)";
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
