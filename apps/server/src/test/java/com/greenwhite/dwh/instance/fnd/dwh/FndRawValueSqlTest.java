package com.greenwhite.dwh.instance.fnd.dwh;

import static org.assertj.core.api.Assertions.assertThat;

import com.greenwhite.dwh.instance.fnd.dwh.FndRawSpec.Type;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

class FndRawValueSqlTest extends EmbeddedPostgresTest {

    @Autowired
    private JdbcClient jdbc;

    private String eval(Type type, String value) {
        return jdbc.sql("select (" + FndRawValueSql.converted(type, "cast(:v as text)") + ")::text")
                .param("v", value)
                .query(String.class)
                .optional()
                .orElse(null);
    }

    private String evalCanonical(Type type, String value) {
        return jdbc.sql("select " + FndRawValueSql.canonical(type, "cast(:v as text)"))
                .param("v", value)
                .query(String.class)
                .optional()
                .orElse(null);
    }

    @Test
    @DisplayName("контракт обзора 3.1: дата из числа Excel, ДД.ММ.ГГГГ и ГГГГ-ММ-ДД; непереводимое — null")
    void dateConversion() {
        assertThat(eval(Type.DATE, "45322")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "45322.75")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "31.01.2024")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "2024-01-31")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "abc")).isNull();
        assertThat(eval(Type.DATE, "2024-13-01")).isNull();
        assertThat(eval(Type.DATE, "9999999")).isNull();
        assertThat(eval(Type.DATE, null)).isNull();
    }

    @Test
    @DisplayName("контракт обзора 3.1: дата текстом с пробелами, табуляцией и переводом строки по краям переводится")
    void dateWithSurroundingWhitespace() {
        assertThat(eval(Type.DATE, " 31.01.2024")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "31.01.2024 ")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, " 2024-01-31 ")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "\t31.01.2024")).isEqualTo("2024-01-31");
        assertThat(eval(Type.DATE, "2024-01-31\n")).isEqualTo("2024-01-31");
    }

    @Test
    @DisplayName("контракт обзора 3.1: пробельные символы по краям — ASCII переводятся точно, длинный и неразрывный пробел не роняют запрос")
    void unicodeWhitespaceDoesNotFailQuery() {
        for (String ws : new String[] {"\u000B", "\u000C", "\t"}) {
            assertThat(eval(Type.DATE, ws + "2024-01-31" + ws)).isEqualTo("2024-01-31");
            assertThat(eval(Type.DATE, ws + "31.01.2024" + ws)).isEqualTo("2024-01-31");
            assertThat(eval(Type.NUMBER, ws + "12,5" + ws)).isEqualTo("12.5");
            assertThat(eval(Type.DATE, ws + "45322" + ws)).isEqualTo("2024-01-31");
        }
        for (String ws : new String[] {"\u00A0", "\u2003", "\u3000"}) {
            assertThat(eval(Type.DATE, ws + "2024-01-31")).isIn("2024-01-31", null);
            assertThat(eval(Type.DATE, ws + "31.01.2024")).isIn("2024-01-31", null);
            assertThat(eval(Type.NUMBER, ws + "12,5")).isIn("12.5", null);
            assertThat(eval(Type.DATE, ws + "45322")).isIn("2024-01-31", null);
        }
    }

    @Test
    @DisplayName("контракт обзора 3.1: цифры не 0–9 (надстрочные, арабско-индийские, полноширинные) — null, а не ошибка базы")
    void nonAsciiDigitsAreNull() {
        String[] values = {"10\u00B2", "45\u0660\u0660\u0660", "\uFF11\uFF12", "2\u0660\u0662\u0664-01-31"};
        for (String value : values) {
            assertThat(eval(Type.NUMBER, value)).isNull();
            assertThat(eval(Type.DATE, value)).isNull();
        }
    }

    @Test
    @DisplayName("контракт обзора 3.1: несуществующая дата и год 0000 — null, а не ошибка базы")
    void nonExistentDateIsNull() {
        assertThat(eval(Type.DATE, "31.04.2024")).isNull();
        assertThat(eval(Type.DATE, "2024-02-30")).isNull();
        assertThat(eval(Type.DATE, "29.02.2023")).isNull();
        assertThat(eval(Type.DATE, "0000-01-01")).isNull();
        assertThat(eval(Type.DATE, "29.02.2024")).isEqualTo("2024-02-29");
    }

    @Test
    @DisplayName("контракт обзора 3.1: число с точкой, запятой, экспонентой и пробелами; непереводимое и переполнение — null")
    void numberConversion() {
        assertThat(eval(Type.NUMBER, "1234.5")).isEqualTo("1234.5");
        assertThat(eval(Type.NUMBER, "12,5")).isEqualTo("12.5");
        assertThat(eval(Type.NUMBER, "1.5E-3")).isEqualTo("0.0015");
        assertThat(eval(Type.NUMBER, " -7 ")).isEqualTo("-7");
        assertThat(eval(Type.NUMBER, "\t12,5")).isEqualTo("12.5");
        assertThat(eval(Type.NUMBER, "abc")).isNull();
        assertThat(eval(Type.NUMBER, "1E99999")).isNull();
    }

    @Test
    @DisplayName("контракт обзора 3.1: единый вид — непереводимое остаётся текстом как в файле")
    void canonicalValue() {
        assertThat(evalCanonical(Type.NUMBER, "abc")).isEqualTo("abc");
        assertThat(evalCanonical(Type.NUMBER, "12,5")).isEqualTo("12.5");
    }

    @Test
    @DisplayName("контракт обзора 3.1: шаблон «содержит» экранирует спецсимволы LIKE")
    void likePatternEscapes() {
        String pattern = FndRawValueSql.likePattern("50%_a\\b");
        assertThat(pattern).isEqualTo("%50\\%\\_a\\\\b%");
        Boolean matches = jdbc.sql("select 'x50%_a\\b' ilike :p escape '\\'")
                .param("p", pattern).query(Boolean.class).single();
        Boolean notMatches = jdbc.sql("select 'x50ab' ilike :p escape '\\'")
                .param("p", pattern).query(Boolean.class).single();
        assertThat(matches).isTrue();
        assertThat(notMatches).isFalse();
    }
}
