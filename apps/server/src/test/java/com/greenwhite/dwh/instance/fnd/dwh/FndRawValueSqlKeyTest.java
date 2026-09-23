package com.greenwhite.dwh.instance.fnd.dwh;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.Key;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.Level;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.Origin;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawSpec.Type;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

class FndRawValueSqlKeyTest extends EmbeddedPostgresTest {

    @Autowired
    private JdbcClient jdbc;

    private String evalKey(String value) {
        return jdbc.sql("select " + FndRawValueSql.key("cast(:v as text)"))
                .param("v", value)
                .query(String.class)
                .optional()
                .orElse(null);
    }

    private String evalGroupKey(String value) {
        return jdbc.sql("select " + FndRawValueSql.groupKey("cast(:v as text)"))
                .param("v", value)
                .query(String.class)
                .optional()
                .orElse(null);
    }

    private static FndRawSpec data() {
        LinkedHashMap<String, Type> columns = new LinkedHashMap<>();
        columns.put("d", Type.DATE);
        columns.put("m", Type.NUMBER);
        columns.put("c", Type.TEXT);
        return new FndRawSpec(List.of(1L), "TEST", columns);
    }

    private static FndRawSpec ref() {
        LinkedHashMap<String, Type> columns = new LinkedHashMap<>();
        columns.put("rc", Type.TEXT);
        columns.put("rn", Type.TEXT);
        return new FndRawSpec(List.of(2L), "TEST", columns);
    }

    @Test
    @DisplayName("контракт отчёта 4.2: число в ключе — по значению (1183 = 1183.0 = 1183,00, экспонента)")
    void numericKeyByValue() {
        assertThat(evalKey("1183")).isEqualTo("1183");
        assertThat(evalKey("1183.0")).isEqualTo("1183");
        assertThat(evalKey(" 1183 ")).isEqualTo("1183");
        assertThat(evalKey("1183,00")).isEqualTo("1183");
        assertThat(evalKey("1.5E3")).isEqualTo("1500");
    }

    @Test
    @DisplayName("контракт отчёта 4.2: пусто, null и пробелы — пустая строка (пусто = пусто)")
    void emptyKeyIsEmptyString() {
        assertThat(evalKey(null)).isEqualTo("");
        assertThat(evalKey("")).isEqualTo("");
        assertThat(evalKey("  ")).isEqualTo("");
    }

    @Test
    @DisplayName("контракт отчёта 4.2: текстовый ключ — без пробелов по краям, с учётом регистра")
    void textKeyTrimmedCaseSensitive() {
        assertThat(evalKey("A1")).isEqualTo("A1");
        assertThat(evalKey("a1")).isEqualTo("a1");
        assertThat(evalKey("A1")).isNotEqualTo(evalKey("a1"));
        assertThat(evalKey(" x y ")).isEqualTo("x y");
    }

    @Test
    @DisplayName("контракт отчёта 4.2: ячейка длиннее 1000 знаков — пустой ключ, а не ошибка базы")
    void longCellKeyIsEmpty() {
        assertThat(evalKey("7".repeat(1001))).isEqualTo("");
    }

    @Test
    @DisplayName("контракт отчёта 4.4: название группы сравнивается без пробелов по краям и без учёта регистра; пустое — null")
    void groupKeyIgnoresCaseAndEdges() {
        assertThat(evalGroupKey(" Ипак ЙЎЛИ ")).isEqualTo("ипак йўли");
        assertThat(evalGroupKey("ипак йўли")).isEqualTo("ипак йўли");
        assertThat(evalGroupKey(" ")).isNull();
    }

    @Test
    @DisplayName("контракт отчёта 4.1: поле уровня не из колонок — отказ")
    void levelFieldOutsideColumnsRejected() {
        assertThatThrownBy(() -> new FndPivotSpec(data(), "d", "m", null, List.of(),
                new Level(Origin.DATA, "x"), null, 2024))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("контракт отчёта 4.2: справочник без ключей — отказ")
    void refWithoutKeysRejected() {
        assertThatThrownBy(() -> new FndPivotSpec(data(), "d", "m", ref(), List.of(),
                new Level(Origin.REF, "rn"), null, 2024))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("контракт отчёта 4.2: три ключа — отказ")
    void threeKeysRejected() {
        List<Key> keys = List.of(new Key("c", "rc"), new Key("c", "rn"), new Key("m", "rc"));
        assertThatThrownBy(() -> new FndPivotSpec(data(), "d", "m", ref(), keys,
                new Level(Origin.REF, "rn"), null, 2024))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("контракт отчёта 4.1: верная спецификация со справочником принимается")
    void validSpecAccepted() {
        FndPivotSpec spec = new FndPivotSpec(data(), "d", null, ref(), List.of(new Key("c", "rc")),
                new Level(Origin.REF, "rn"), new Level(Origin.DATA, "c"), 2024);
        assertThat(spec.keys()).hasSize(1);
    }
}
