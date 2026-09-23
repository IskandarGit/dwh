package com.greenwhite.dwh.instance.fnd.dwh;

import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** Фасад чтения raw для обзора данных: страницы, сортировка, фильтры, группы и итог, лимит времени. */
class FndRawReaderTest extends EmbeddedPostgresTest {

    private static final long LOAD = 9001;
    private static final long LOAD_2 = 9002;
    private static final long FOREIGN_LOAD = 9003;
    private static final String SHEET = "TEST";

    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private DataSource dwh;
    @Autowired
    private FndRawReader reader;
    @Autowired
    private ObjectMapper json;

    @BeforeEach
    void cleanRaw() {
        dwhJdbc.sql("delete from raw.rows").update();
    }

    @Test
    @DisplayName("AC-4 обзора: страница по смещению, чужие загрузки и листы не видны")
    void pages() {
        for (int rowNo = 1; rowNo <= 450; rowNo++) {
            insert(LOAD, SHEET, rowNo, Map.of("name", "TEST " + rowNo));
        }
        insert(FOREIGN_LOAD, SHEET, 1, Map.of("name", "TEST чужая"));
        insert(LOAD_2, "OTHER", 1, Map.of("name", "TEST другой лист"));

        assertThat(reader.count(spec(), List.of())).isEqualTo(450);
        List<FndRawSpec.Row> page = reader.page(spec(), List.of(), null, 400, 200);
        assertThat(page).hasSize(50);
        assertThat(page.getFirst().sourceRowNo()).isEqualTo(402);
        assertThat(page).allSatisfy(row -> {
            assertThat(row.loadId()).isEqualTo(LOAD);
            assertThat(row.sheet()).isEqualTo(SHEET);
        });
    }

    @Test
    @DisplayName("AC-4 обзора: сортировка по дате — число Excel, ISO и ДД.ММ.ГГГГ по значению, пустые и непереводимые в конце")
    void sortByDate() {
        insertDates();

        List<FndRawSpec.Row> desc = reader.page(spec(), List.of(), new FndRawSpec.Sort("doc_date", true), 0, 200);
        assertThat(desc).extracting(row -> row.values().get("doc_date"))
                .containsExactly("2024-03-01", "2024-02-15", "2024-01-31", null, "abc");
        List<FndRawSpec.Row> asc = reader.page(spec(), List.of(), new FndRawSpec.Sort("doc_date", false), 0, 200);
        assertThat(asc).extracting(row -> row.values().get("doc_date"))
                .containsExactly("2024-01-31", "2024-02-15", "2024-03-01", null, "abc");
    }

    @Test
    @DisplayName("AC-5 обзора: «содержит» без учёта регистра и со спецсимволами, «между» включительно, «пусто»")
    void filters() {
        insert(LOAD, SHEET, 1, Map.of("name", "xTESTy", "amount", "10"));
        insert(LOAD, SHEET, 2, Map.of("name", "tes", "amount", "20"));
        insert(LOAD, SHEET, 3, Map.of("name", "50% TEST", "amount", "9.99"));
        insert(LOAD, SHEET, 4, Map.of("name", "50 TEST", "amount", "20.01"));
        insert(LOAD, SHEET, 5, Map.of("amount", "15"));

        assertThat(names(List.of(new FndRawSpec.Contains("name", "test")))).containsExactly("xTESTy", "50% TEST", "50 TEST");
        assertThat(names(List.of(new FndRawSpec.Contains("name", "%")))).containsExactly("50% TEST");
        assertThat(amounts(List.of(new FndRawSpec.Between("amount", new BigDecimal("10"), new BigDecimal("20")))))
                .containsExactly("10", "20", "15");
        assertThat(reader.count(spec(), List.of(new FndRawSpec.Eq("name", null)))).isEqualTo(1);
        assertThat(amounts(List.of(new FndRawSpec.Eq("name", null)))).containsExactly("15");
    }

    @Test
    @DisplayName("AC-5 обзора: «между» по дате с одной границей")
    void betweenDates() {
        insertDates();

        List<FndRawSpec.Row> rows = reader.page(spec(),
                List.of(new FndRawSpec.Between("doc_date", LocalDate.of(2024, 2, 1), null)), null, 0, 200);
        assertThat(rows).extracting(row -> row.values().get("doc_date")).containsExactly("2024-02-15", "2024-03-01");
    }

    @Test
    @DisplayName("AC-6 обзора: группы по значению, пусто в конце; итог сходится с суммой групп, в том числе под фильтром")
    void groupsAndTotals() {
        insert(LOAD, SHEET, 1, Map.of("name", "A", "amount", "1.5"));
        insert(LOAD, SHEET, 2, Map.of("name", "A", "amount", "2"));
        insert(LOAD, SHEET, 3, Map.of("name", "A", "amount", "abc"));
        insert(LOAD, SHEET, 4, Map.of("name", "B", "amount", "10"));
        insert(LOAD_2, SHEET, 5, Map.of("name", "B", "amount", "0.25"));
        insert(LOAD, SHEET, 6, Map.of("amount", "7"));

        FndRawSpec.Groups groups = reader.groups(spec(), List.of(), "name", 1000);
        assertThat(groups.groupsTotal()).isEqualTo(3);
        assertThat(groups.groups()).extracting(FndRawSpec.Group::value).containsExactly("A", "B", null);
        assertThat(groups.groups()).extracting(FndRawSpec.Group::count).containsExactly(3L, 2L, 1L);
        assertThat(groups.groups().get(0).sums().get("amount")).isEqualByComparingTo("3.5");
        assertThat(groups.groups().get(1).sums().get("amount")).isEqualByComparingTo("10.25");
        assertThat(groups.groups().get(2).sums().get("amount")).isEqualByComparingTo("7");

        FndRawSpec.Group totals = reader.totals(spec(), List.of());
        assertThat(totals.value()).isNull();
        assertThat(totals.count()).isEqualTo(6);
        assertThat(totals.sums().get("amount").compareTo(sumOf(groups))).isZero();

        List<FndRawSpec.Filter> filter = List.of(new FndRawSpec.Between("amount", new BigDecimal("2"), null));
        FndRawSpec.Groups filtered = reader.groups(spec(), filter, "name", 1000);
        FndRawSpec.Group filteredTotals = reader.totals(spec(), filter);
        assertThat(filtered.groups()).extracting(FndRawSpec.Group::value).containsExactly("A", "B", null);
        assertThat(filteredTotals.count()).isEqualTo(3);
        assertThat(filteredTotals.sums().get("amount").compareTo(sumOf(filtered))).isZero();
        assertThat(filteredTotals.sums().get("amount")).isEqualByComparingTo("19");
    }

    @Test
    @DisplayName("AC-6 обзора: предел групп — отдаётся 1000, всего групп и итог считаются по всем")
    void groupsLimit() {
        for (int rowNo = 1; rowNo <= 1001; rowNo++) {
            insert(LOAD, SHEET, rowNo, Map.of("name", "TEST " + rowNo, "amount", "1"));
        }

        FndRawSpec.Groups groups = reader.groups(spec(), List.of(), "name", 1000);
        assertThat(groups.groups()).hasSize(1000);
        assertThat(groups.groupsTotal()).isEqualTo(1001);
        assertThat(reader.totals(spec(), List.of()).count()).isEqualTo(1001);
    }

    @Test
    @DisplayName("Запрос дольше лимита времени — DwhQueryTimeoutException")
    void timeout() {
        FndRawReader slow = new FndRawReader(dwh, Duration.ofMillis(50));

        assertThatThrownBy(() -> slow.read(j -> j.sql("select pg_sleep(1)").query().singleValue()))
                .isInstanceOf(DwhQueryTimeoutException.class);
    }

    @Test
    @DisplayName("Защита: «содержит» у числа и поле не из спецификации — отказ")
    void rejectsWrongFields() {
        assertThatThrownBy(() -> reader.count(spec(), List.of(new FndRawSpec.Contains("amount", "1"))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reader.count(spec(), List.of(new FndRawSpec.Eq("unknown", "TEST"))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reader.page(spec(), List.of(), new FndRawSpec.Sort("unknown", false), 0, 200))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reader.groups(spec(), List.of(), "unknown", 1000))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("Защита: пустой список загрузок — пустой результат без обращения к базе")
    void emptyLoadsSkipDatabase() throws Exception {
        DataSource untouched = mock(DataSource.class);
        FndRawReader offline = new FndRawReader(untouched, Duration.ofSeconds(1));
        FndRawSpec empty = new FndRawSpec(List.of(), SHEET, columns());

        assertThat(offline.count(empty, List.of())).isZero();
        assertThat(offline.page(empty, List.of(), null, 0, 200)).isEmpty();
        assertThat(offline.groups(empty, List.of(), "name", 1000)).isEqualTo(new FndRawSpec.Groups(0, List.of()));
        FndRawSpec.Group totals = offline.totals(empty, List.of());
        assertThat(totals.count()).isZero();
        assertThat(totals.sums().get("amount")).isEqualByComparingTo("0");
        verify(untouched, never()).getConnection();
    }

    private void insertDates() {
        insert(LOAD, SHEET, 1, Map.of("doc_date", "45322"));
        insert(LOAD, SHEET, 2, Map.of("doc_date", "2024-02-15"));
        insert(LOAD, SHEET, 3, Map.of("doc_date", "01.03.2024"));
        insert(LOAD, SHEET, 4, Map.of("name", "TEST"));
        insert(LOAD, SHEET, 5, Map.of("doc_date", "abc"));
    }

    private List<String> names(List<FndRawSpec.Filter> filters) {
        return reader.page(spec(), filters, null, 0, 200).stream().map(row -> row.values().get("name")).toList();
    }

    private List<String> amounts(List<FndRawSpec.Filter> filters) {
        return reader.page(spec(), filters, null, 0, 200).stream().map(row -> row.values().get("amount")).toList();
    }

    private static BigDecimal sumOf(FndRawSpec.Groups groups) {
        return groups.groups().stream().map(group -> group.sums().get("amount")).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static FndRawSpec spec() {
        return new FndRawSpec(List.of(LOAD, LOAD_2), SHEET, columns());
    }

    private static LinkedHashMap<String, FndRawSpec.Type> columns() {
        LinkedHashMap<String, FndRawSpec.Type> columns = new LinkedHashMap<>();
        columns.put("name", FndRawSpec.Type.TEXT);
        columns.put("amount", FndRawSpec.Type.NUMBER);
        columns.put("doc_date", FndRawSpec.Type.DATE);
        return columns;
    }

    private void insert(long loadId, String sheet, int rowNo, Map<String, Object> fields) {
        dwhJdbc.sql("insert into raw.rows (load_id, row_no, sheet, source_row_no, fields)"
                        + " values (:loadId, :rowNo, :sheet, :sourceRowNo, cast(:json as jsonb))")
                .param("loadId", loadId)
                .param("rowNo", rowNo)
                .param("sheet", sheet)
                .param("sourceRowNo", rowNo + 1)
                .param("json", json.writeValueAsString(new HashMap<>(fields)))
                .update();
    }
}
