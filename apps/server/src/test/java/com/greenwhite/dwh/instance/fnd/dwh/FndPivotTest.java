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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/** Сводная основы: grouping sets, справочник по ключу, группы по названию, строки без даты, строки ячейки. */
class FndPivotTest extends EmbeddedPostgresTest {

    private static final long DATA_LOAD = 9101;
    private static final long DATA_LOAD_2 = 9102;
    private static final long REF_LOAD = 9201;
    private static final long REF_LOAD_2 = 9202;
    private static final String DATA_SHEET = "TEST";
    private static final String REF_SHEET = "REF";
    private static final int YEAR = 2026;
    private static final int ROWS = 30;
    private static final String NUMBER = "-?[0-9]+(\\.[0-9]+)?";

    private static final FndPivotSpec.Key CODE = new FndPivotSpec.Key("code", "rcode");
    private static final FndPivotSpec.Key CODE_2 = new FndPivotSpec.Key("code2", "rcode2");
    private static final FndPivotSpec.Level REF_NAME = new FndPivotSpec.Level(FndPivotSpec.Origin.REF, "rname");
    private static final FndPivotSpec.Level DATA_GROUP = new FndPivotSpec.Level(FndPivotSpec.Origin.DATA, "grp");

    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private FndRawReader reader;
    @Autowired
    private ObjectMapper json;

    @BeforeEach
    void cleanRaw() {
        dwhJdbc.sql("delete from raw.rows").update();
    }

    @Test
    @DisplayName("AC-5: на каждой ячейке подытог = Σ уровня 2, общий = Σ уровня 1, итог года = Σ месяцев — мера и число строк")
    void convergesOnEveryCell() {
        BigDecimal expected = insertTwoLevelData();

        FndPivotSpec.Pivot pivot = reader.pivot(twoLevels(YEAR, "amount"));

        assertThat(pivot.years()).containsExactly(YEAR);
        FndPivotSpec.Cell total = find(pivot, 0, null, null, null);
        assertThat(total.count()).isEqualTo(ROWS);
        assertThat(total.value()).isEqualByComparingTo(expected);
        assertThat(pivot.cells()).anySatisfy(cell -> assertThat(cell.depth()).isEqualTo(2));
        assertThat(pivot.cells()).filteredOn(cell -> cell.depth() == 0 && cell.month() != null).hasSize(3);
        assertConverges(pivot, 2);
    }

    @Test
    @DisplayName("AC-3: ключ из двух колонок, вторая пустая — 1183.0 находит 1183, пусто = пусто")
    void twoColumnKeyWithEmptySecond() {
        insert(DATA_LOAD, DATA_SHEET, 1, Map.of("dt", "2026-01-15", "amount", "5", "code", "1183.0", "code2", ""));
        insert(REF_LOAD, REF_SHEET, 1, Map.of("rcode", "1183", "rname", "TEST-P"));

        FndPivotSpec spec = new FndPivotSpec(data(), "dt", "amount", ref(), List.of(CODE, CODE_2), REF_NAME, null, YEAR);
        FndPivotSpec.Cell group = find(reader.pivot(spec), 1, "test-p", null, null);

        assertThat(group.name1()).isEqualTo("TEST-P");
        assertThat(group.count()).isEqualTo(1);
        assertThat(group.value()).isEqualByComparingTo("5");
    }

    @Test
    @DisplayName("AC-3: повтор ключа в справочнике — строка источника посчитана один раз, название из последней загрузки")
    void duplicateRefKey() {
        insert(DATA_LOAD, DATA_SHEET, 1, Map.of("dt", "2026-02-01", "amount", "10", "code", "77"));
        insert(REF_LOAD, REF_SHEET, 1, Map.of("rcode", "77", "rname", "TEST-OLD"));
        insert(REF_LOAD_2, REF_SHEET, 1, Map.of("rcode", "77", "rname", "TEST-NEW"));

        FndPivotSpec.Pivot pivot = reader.pivot(oneRefLevel(YEAR));

        assertThat(pivot.refDuplicateKeys()).isEqualTo(1);
        FndPivotSpec.Cell total = find(pivot, 0, null, null, null);
        assertThat(total.count()).isEqualTo(1);
        assertThat(total.value()).isEqualByComparingTo("10");
        FndPivotSpec.Cell group = find(pivot, 1, "test-new", null, null);
        assertThat(group.name1()).isEqualTo("TEST-NEW");
        assertThat(group.count()).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-4: два ключа с одним названием в разном регистре и с пробелом — одна группа, написание первой строки справочника")
    void sameNameOneGroup() {
        insert(DATA_LOAD, DATA_SHEET, 1, Map.of("dt", "2026-03-01", "amount", "1", "code", "2"));
        insert(DATA_LOAD, DATA_SHEET, 2, Map.of("dt", "2026-03-02", "amount", "2", "code", "1"));
        insert(REF_LOAD, REF_SHEET, 1, Map.of("rcode", "1", "rname", "TEST-А"));
        insert(REF_LOAD, REF_SHEET, 2, Map.of("rcode", "2", "rname", "test-а "));

        FndPivotSpec.Pivot pivot = reader.pivot(oneRefLevel(YEAR));

        assertThat(pivot.cells()).filteredOn(cell -> cell.depth() == 1 && cell.month() == null).hasSize(1);
        FndPivotSpec.Cell group = find(pivot, 1, "test-а", null, null);
        assertThat(group.name1()).isEqualTo("TEST-А");
        assertThat(group.count()).isEqualTo(2);
        assertThat(group.value()).isEqualByComparingTo("3");
    }

    @Test
    @DisplayName("AC-3: нет пары в справочнике и пустое название — группа без названия (key1 и name1 null)")
    void noPairAndEmptyNameGoUnnamed() {
        insert(DATA_LOAD, DATA_SHEET, 1, Map.of("dt", "2026-04-01", "amount", "4", "code", "5"));
        insert(DATA_LOAD, DATA_SHEET, 2, Map.of("dt", "2026-04-02", "amount", "6", "code", "1"));
        insert(REF_LOAD, REF_SHEET, 1, Map.of("rcode", "1", "rname", "  "));

        FndPivotSpec.Pivot pivot = reader.pivot(oneRefLevel(YEAR));

        assertThat(pivot.cells()).filteredOn(cell -> cell.depth() == 1 && cell.month() == null).hasSize(1);
        FndPivotSpec.Cell unnamed = find(pivot, 1, null, null, null);
        assertThat(unnamed.name1()).isNull();
        assertThat(unnamed.count()).isEqualTo(2);
        assertThat(unnamed.value()).isEqualByComparingTo("10");
    }

    @Test
    @DisplayName("AC-6: пустая, непереводимая и несуществующая дата — «без даты»; другой год — в years; год null — последний")
    void undatedAndYears() {
        insert(DATA_LOAD, DATA_SHEET, 1, Map.of("dt", "", "amount", "1", "grp", "TEST"));
        insert(DATA_LOAD, DATA_SHEET, 2, Map.of("dt", "abc", "amount", "2", "grp", "TEST"));
        insert(DATA_LOAD, DATA_SHEET, 3, Map.of("dt", "31.04.2026", "amount", "4", "grp", "TEST"));
        insert(DATA_LOAD, DATA_SHEET, 4, Map.of("dt", "2025-12-31", "amount", "8", "grp", "TEST"));
        insert(DATA_LOAD, DATA_SHEET, 5, Map.of("dt", "15.03.2026", "amount", "16", "grp", "TEST"));

        FndPivotSpec.Pivot latest = reader.pivot(oneDataLevel(null, "amount"));

        assertThat(latest.years()).containsExactly(2025, YEAR);
        assertThat(latest.undatedCount()).isEqualTo(3);
        assertThat(latest.undatedValue()).isEqualByComparingTo("7");
        FndPivotSpec.Cell total = find(latest, 0, null, null, null);
        assertThat(total.count()).isEqualTo(1);
        assertThat(total.value()).isEqualByComparingTo("16");
        assertThat(find(latest, 0, null, null, 3).count()).isEqualTo(1);

        FndPivotSpec.Pivot previous = reader.pivot(oneDataLevel(2025, "amount"));
        assertThat(find(previous, 0, null, null, null).value()).isEqualByComparingTo("8");
        assertThat(find(previous, 0, null, null, 12).count()).isEqualTo(1);
    }

    @Test
    @DisplayName("Мера «число строк»: значение ячейки равно числу её строк")
    void countMeasure() {
        insertTwoLevelData();

        FndPivotSpec.Pivot pivot = reader.pivot(twoLevels(YEAR, null));

        assertThat(pivot.cells()).isNotEmpty().allSatisfy(cell ->
                assertThat(cell.value()).isEqualByComparingTo(BigDecimal.valueOf(cell.count())));
        assertThat(pivot.undatedValue()).isEqualByComparingTo(BigDecimal.valueOf(pivot.undatedCount()));
        assertConverges(pivot, 2);
    }

    @Test
    @DisplayName("Один уровень из источника без справочника: нет уровня 2, общий = Σ уровня 1")
    void oneDataLevelWithoutRef() {
        insertTwoLevelData();

        FndPivotSpec.Pivot pivot = reader.pivot(oneDataLevel(YEAR, "amount"));

        assertThat(pivot.cells()).noneSatisfy(cell -> assertThat(cell.depth()).isEqualTo(2));
        assertThat(pivot.cells()).allSatisfy(cell -> {
            assertThat(cell.key2()).isNull();
            assertThat(cell.name2()).isNull();
        });
        assertThat(pivot.refDuplicateKeys()).isZero();
        assertThat(find(pivot, 1, "test-g0", null, null).name1()).isEqualTo("TEST-G0");
        assertConverges(pivot, 1);
    }

    @Test
    @DisplayName("AC-7: строки ячейки — число и мера как в ячейке, Σ меры всех страниц = значению ячейки")
    void cellRowsMatchCells() {
        insertTwoLevelData();
        FndPivotSpec spec = twoLevels(YEAR, "amount");
        FndPivotSpec.Pivot pivot = reader.pivot(spec);
        FndPivotSpec.Cell monthCell = pivot.cells().stream()
                .filter(cell -> cell.depth() == 2 && cell.month() != null && cell.key1() != null).findFirst().orElseThrow();
        FndPivotSpec.Cell yearCell = find(pivot, 2, monthCell.key1(), monthCell.key2(), null);
        FndPivotSpec.Cell subtotal = find(pivot, 1, monthCell.key1(), null, null);
        FndPivotSpec.Cell total = find(pivot, 0, null, null, null);
        FndPivotSpec.Cell unnamed = find(pivot, 1, null, null, null);

        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.MONTH, monthCell.month(),
                List.of(monthCell.key1(), monthCell.key2())), monthCell.count(), monthCell.value());
        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.YEAR, null,
                List.of(yearCell.key1(), yearCell.key2())), yearCell.count(), yearCell.value());
        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.YEAR, null,
                List.of(subtotal.key1())), subtotal.count(), subtotal.value());
        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.YEAR, null, List.of()),
                total.count(), total.value());
        List<String> unnamedPath = new ArrayList<>();
        unnamedPath.add(null);
        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.YEAR, null, unnamedPath),
                unnamed.count(), unnamed.value());
        assertCellRows(spec, new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.UNDATED, null, List.of()),
                pivot.undatedCount(), pivot.undatedValue());
    }

    @Test
    @DisplayName("Защита: пустой список загрузок — пустой результат без базы; месяц без года — отказ")
    void emptyLoadsSkipDatabase() throws Exception {
        DataSource untouched = mock(DataSource.class);
        FndRawReader offline = new FndRawReader(untouched, Duration.ofSeconds(1));
        FndRawSpec empty = new FndRawSpec(List.of(), DATA_SHEET, dataColumns());
        FndPivotSpec spec = new FndPivotSpec(empty, "dt", "amount", null, List.of(), DATA_GROUP, null, YEAR);

        assertThat(offline.pivot(spec)).isEqualTo(new FndPivotSpec.Pivot(List.of(), List.of(), 0, BigDecimal.ZERO, 0));
        FndPivotSpec.CellRows rows = offline.pivotRows(spec,
                new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.YEAR, null, List.of()), 0, 5);
        assertThat(rows.total()).isZero();
        assertThat(rows.value()).isEqualByComparingTo("0");
        assertThat(rows.rows()).isEmpty();
        verify(untouched, never()).getConnection();

        FndPivotSpec withoutYear = new FndPivotSpec(data(), "dt", "amount", null, List.of(), DATA_GROUP, null, null);
        assertThatThrownBy(() -> reader.pivotRows(withoutYear,
                new FndPivotSpec.CellQuery(FndPivotSpec.PeriodKind.MONTH, 1, List.of()), 0, 5))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * Два уровня: название из справочника по коду → группа источника; коды 1–3 в справочнике
     * (1 и 3 с одним названием), 4 — без пары; одна строка с непереводимой мерой, две без даты.
     * Возвращает Σ меры датированных строк, посчитанную здесь, а не базой.
     */
    private BigDecimal insertTwoLevelData() {
        insert(REF_LOAD, REF_SHEET, 1, Map.of("rcode", "1", "rname", "TEST-X"));
        insert(REF_LOAD, REF_SHEET, 2, Map.of("rcode", "2", "rname", "TEST-Y"));
        insert(REF_LOAD_2, REF_SHEET, 1, Map.of("rcode", "3", "rname", "test-x "));
        BigDecimal expected = BigDecimal.ZERO;
        for (int i = 1; i <= ROWS; i++) {
            String amount = i == 7 ? "abc" : i + ".25";
            if (amount.matches(NUMBER)) {
                expected = expected.add(new BigDecimal(amount));
            }
            String date = String.format("%d-%02d-%02d", YEAR, i % 3 + 1, i % 28 + 1);
            long load = i <= ROWS / 2 ? DATA_LOAD : DATA_LOAD_2;
            insert(load, DATA_SHEET, i, Map.of("dt", date, "amount", amount,
                    "code", String.valueOf(i % 4 + 1), "grp", "TEST-G" + i % 2));
        }
        insert(DATA_LOAD_2, DATA_SHEET, ROWS + 1, Map.of("dt", "abc", "amount", "3", "code", "1", "grp", "TEST-G0"));
        insert(DATA_LOAD_2, DATA_SHEET, ROWS + 2, Map.of("amount", "5", "code", "4", "grp", "TEST-G1"));
        return expected;
    }

    private void assertCellRows(FndPivotSpec spec, FndPivotSpec.CellQuery cell, long count, BigDecimal value) {
        FndPivotSpec.CellRows first = reader.pivotRows(spec, cell, 0, 5);
        assertThat(first.total()).isEqualTo(count);
        assertThat(first.value()).isEqualByComparingTo(value);
        List<FndPivotSpec.CellRow> all = new ArrayList<>();
        for (int offset = 0; offset < count; offset += 5) {
            List<FndPivotSpec.CellRow> page = reader.pivotRows(spec, cell, offset, 5).rows();
            assertThat(page).hasSizeLessThanOrEqualTo(5).isNotEmpty();
            all.addAll(page);
        }
        assertThat(all).hasSize(Math.toIntExact(count));
        assertThat(all).allSatisfy(row -> assertThat(row.sourceRowNo()).isNotNull());
        BigDecimal measured = all.stream().map(FndPivotSpec.CellRow::measure)
                .filter(text -> text != null && text.matches(NUMBER))
                .map(BigDecimal::new).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(measured).isEqualByComparingTo(value);
    }

    private static void assertConverges(FndPivotSpec.Pivot pivot, int levels) {
        for (FndPivotSpec.Cell parent : pivot.cells()) {
            if (parent.depth() < levels) {
                List<FndPivotSpec.Cell> children = pivot.cells().stream()
                        .filter(cell -> cell.depth() == parent.depth() + 1 && Objects.equals(cell.month(), parent.month())
                                && (parent.depth() == 0 || Objects.equals(cell.key1(), parent.key1())))
                        .toList();
                assertSums(parent, children);
            }
            if (parent.month() == null) {
                List<FndPivotSpec.Cell> months = pivot.cells().stream()
                        .filter(cell -> cell.depth() == parent.depth() && cell.month() != null
                                && Objects.equals(cell.key1(), parent.key1()) && Objects.equals(cell.key2(), parent.key2()))
                        .toList();
                assertSums(parent, months);
            }
        }
    }

    private static void assertSums(FndPivotSpec.Cell parent, List<FndPivotSpec.Cell> parts) {
        assertThat(parts).as("части ячейки %s", parent).isNotEmpty();
        assertThat(sum(parts, FndPivotSpec.Cell::value)).as("мера ячейки %s", parent).isEqualByComparingTo(parent.value());
        assertThat(parts.stream().mapToLong(FndPivotSpec.Cell::count).sum()).as("число строк ячейки %s", parent)
                .isEqualTo(parent.count());
    }

    private static BigDecimal sum(List<FndPivotSpec.Cell> cells, Function<FndPivotSpec.Cell, BigDecimal> value) {
        return cells.stream().map(value).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static FndPivotSpec.Cell find(FndPivotSpec.Pivot pivot, int depth, String key1, String key2, Integer month) {
        List<FndPivotSpec.Cell> found = pivot.cells().stream()
                .filter(cell -> cell.depth() == depth && Objects.equals(cell.key1(), key1)
                        && Objects.equals(cell.key2(), key2) && Objects.equals(cell.month(), month))
                .toList();
        assertThat(found).as("ячейка depth %d, %s, %s, месяц %s", depth, key1, key2, month).hasSize(1);
        return found.getFirst();
    }

    private static FndPivotSpec twoLevels(Integer year, String measure) {
        return new FndPivotSpec(data(), "dt", measure, ref(), List.of(CODE), REF_NAME, DATA_GROUP, year);
    }

    private static FndPivotSpec oneRefLevel(Integer year) {
        return new FndPivotSpec(data(), "dt", "amount", ref(), List.of(CODE), REF_NAME, null, year);
    }

    private static FndPivotSpec oneDataLevel(Integer year, String measure) {
        return new FndPivotSpec(data(), "dt", measure, null, List.of(), DATA_GROUP, null, year);
    }

    private static FndRawSpec data() {
        return new FndRawSpec(List.of(DATA_LOAD, DATA_LOAD_2), DATA_SHEET, dataColumns());
    }

    private static FndRawSpec ref() {
        LinkedHashMap<String, FndRawSpec.Type> columns = new LinkedHashMap<>();
        columns.put("rcode", FndRawSpec.Type.TEXT);
        columns.put("rcode2", FndRawSpec.Type.TEXT);
        columns.put("rname", FndRawSpec.Type.TEXT);
        columns.put("rsub", FndRawSpec.Type.TEXT);
        return new FndRawSpec(List.of(REF_LOAD, REF_LOAD_2), REF_SHEET, columns);
    }

    private static LinkedHashMap<String, FndRawSpec.Type> dataColumns() {
        LinkedHashMap<String, FndRawSpec.Type> columns = new LinkedHashMap<>();
        columns.put("dt", FndRawSpec.Type.DATE);
        columns.put("amount", FndRawSpec.Type.NUMBER);
        columns.put("code", FndRawSpec.Type.TEXT);
        columns.put("code2", FndRawSpec.Type.TEXT);
        columns.put("grp", FndRawSpec.Type.TEXT);
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
