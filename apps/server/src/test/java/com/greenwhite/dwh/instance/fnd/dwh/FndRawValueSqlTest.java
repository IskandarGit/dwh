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
    @DisplayName("контракт обзора 3.1: число с точкой, запятой, экспонентой и пробелами; непереводимое и переполнение — null")
    void numberConversion() {
        assertThat(eval(Type.NUMBER, "1234.5")).isEqualTo("1234.5");
        assertThat(eval(Type.NUMBER, "12,5")).isEqualTo("12.5");
        assertThat(eval(Type.NUMBER, "1.5E-3")).isEqualTo("0.0015");
        assertThat(eval(Type.NUMBER, " -7 ")).isEqualTo("-7");
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
