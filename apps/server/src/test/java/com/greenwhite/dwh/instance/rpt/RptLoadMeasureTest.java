package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.CellQuery;
import com.greenwhite.dwh.instance.rpt.RptModel.CellRows;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Line1;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.Period;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptTestData.RefRow;
import com.greenwhite.dwh.instance.rpt.RptTestData.SourceRow;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.rpt.service.RptViewService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.function.LongSupplier;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Замер «Сводного отчёта» на 20 тыс. TEST-строк источника и 1 000 строк справочника: расчёт и строки ячейки не дольше 2 с (AC-9).
 * 100 тыс. — долг: view 5,4 с (замер 24.09).
 */
class RptLoadMeasureTest extends EmbeddedPostgresTest {

    private static final long SOURCE_TOTAL = 20_000;
    private static final long REF_TOTAL = 1_000;
    private static final int PACKAGE_ROWS = 5;
    private static final int YEAR = 2026;
    private static final int REF_NAMES = 60;
    private static final int DIVISOR = 1000;
    private static final int DIGITS = 1;
    private static final int MEASURE_RUNS = 3;
    private static final long LIMIT_MS = 2_000;
    private static final LocalDate JAN_FROM = LocalDate.of(YEAR, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(YEAR, 1, 31);

    /**
     * Общая часть доливки: номер {@code n} продолжает строки применённого пакета листа {@code :sheet} до {@code :total};
     * load_id, файл и лист — те же, номер строки Excel — со сдвигом маленького пакета.
     */
    private static final String FILL_TEMPLATE = """
            insert into raw.rows (load_id, source_file_id, row_no, sheet, source_row_no, fields)
            select b.load_id, b.source_file_id, b.max_row + n - b.cnt + 1, b.sheet,
                   (b.max_row + n - b.cnt + 1 + b.shift)::integer,
                   %s
              from (select load_id, source_file_id, sheet, max(row_no) as max_row,
                           max(source_row_no - row_no) as shift, count(*) as cnt
                      from raw.rows
                     where sheet = :sheet
                     group by load_id, source_file_id, sheet) b
             cross join lateral generate_series(b.cnt, :total - 1) n
            """;

    private static final List<String> SOURCE_KEYS = List.of(RptTestData.OBJECT, RptTestData.DATE, RptTestData.AMOUNT,
            RptTestData.QTY, RptTestData.CODE, RptTestData.GROUP);
    private static final List<String> REF_KEYS = List.of(RptTestData.OBJECT, RptTestData.REF_CODE, RptTestData.REF_NAME);

    private static final String SOURCE_FIELDS = """
            jsonb_build_object(
                       'okey', lpad(n::text, 9, '0'),
                       'dt', to_char(make_date(2026, (n %% 12 + 1)::integer, (n %% 28 + 1)::integer), 'DD.MM.YYYY'),
                       'amount', ((n %% 1000) * 1.25)::text,
                       'qty', (n %% 50)::text,
                       'code', 'TEST' || (n %% 1000),
                       'grp', 'TEST G' || (n %% 20))""";

    private static final String REF_FIELDS = """
            jsonb_build_object(
                       'okey', lpad(n::text, 9, '0'),
                       'rcode', 'TEST' || n,
                       'rname', 'TEST N' || (n %% 60))""";

    @Autowired
    private RptViewService service;
    @Autowired
    private RptDefinitionService definitions;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private MfFileService files;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private TransactionTemplate tx;

    private RptTestData data;
    private long userId;
    private long sourceId;
    private long refId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        cleanMeta();
        dwhJdbc.sql("delete from raw.rows").update();
        data = new RptTestData(sources, packages, parseJob, applies, files, userId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
    }

    @AfterEach
    void cleanUp() {
        dwhJdbc.sql("delete from raw.rows").update();
        cleanMeta();
    }

    @Test
    @DisplayName("AC-9: на 20 тыс. строк источника (10 × стенд) и 1 тыс. справочника отчёт и строки ячейки — не дольше 2 с")
    void viewAndCellsAnswerWithinLimitOnLargeData() {
        data.applyRef(refId, IntStream.range(0, PACKAGE_ROWS)
                .mapToObj(i -> new RefRow("TEST" + i, "TEST N" + i)).toList(), JAN_FROM, JAN_TO);
        data.applySource(sourceId, IntStream.range(0, PACKAGE_ROWS)
                .mapToObj(i -> new SourceRow(String.format("%02d.01.%d", i + 1, YEAR), i * 1.25, i,
                        "TEST" + i, "TEST G" + i)).toList(), JAN_FROM, JAN_TO);
        fillUpTo(RptTestData.REF_SHEET, REF_FIELDS, REF_KEYS, REF_TOTAL);
        fillUpTo(RptTestData.SOURCE_SHEET, SOURCE_FIELDS, SOURCE_KEYS, SOURCE_TOTAL);
        long id = definition();

        ReportView view = service.view(id, YEAR);
        Line1 first = view.lines().getFirst();
        CellQuery grand = yearQuery(List.of(), 0);
        CellRows firstPage = service.cells(id, monthQuery(first.key(), 0));
        CellQuery lastPage = monthQuery(first.key(), lastPageOffset(firstPage.total()));
        service.cells(id, grand);
        service.cells(id, lastPage);

        assertThat(view.grand().count()).isEqualTo(SOURCE_TOTAL);
        assertThat(view.lines().stream().filter(line -> line.key() != null)).hasSize(REF_NAMES);
        assertThat(service.cells(id, lastPage).items()).isNotEmpty();

        long viewMs = medianMillis(() -> service.view(id, YEAR).grand().count());
        long cellsGrandMs = medianMillis(() -> service.cells(id, grand).total());
        long cellsLastPageMs = medianMillis(() -> service.cells(id, lastPage).total());

        System.out.println("RPT-MEASURE view=" + viewMs + " cells_grand=" + cellsGrandMs
                + " cells_last_page=" + cellsLastPageMs + " ms (median)");
        assertThat(viewMs).as("расчёт отчёта за год, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(cellsGrandMs).as("строки ячейки общего итога, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(cellsLastPageMs).as("строки ячейки строки уровня 1 за январь, последняя страница, мс")
                .isLessThanOrEqualTo(LIMIT_MS);
    }

    // ---------- помощники ----------

    private void cleanMeta() {
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from rpt_reports").update();
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
    }

    /** Доливает лист одним SQL; перед этим сверяет, что поля строк маленького пакета совпадают с доливаемыми. */
    private void fillUpTo(String sheet, String fieldsSql, List<String> fieldKeys, long total) {
        List<String> packageKeys = dwhJdbc.sql("""
                        select distinct k from raw.rows, jsonb_object_keys(fields) k where sheet = :sheet order by k""")
                .param("sheet", sheet).query(String.class).list();
        assertThat(packageKeys).as("поля доливки = поля строк пакета листа " + sheet)
                .containsExactlyInAnyOrderElementsOf(fieldKeys);
        dwhJdbc.sql(FILL_TEMPLATE.formatted(fieldsSql.formatted())).param("sheet", sheet).param("total", total).update();
        long count = dwhJdbc.sql("select count(*) from raw.rows where sheet = :sheet")
                .param("sheet", sheet).query(Long.class).single();
        assertThat(count).isEqualTo(total);
    }

    private long definition() {
        RefPart ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        return definitions.create(new DefinitionInput("TEST замер", sourceId, 1, RptTestData.DATE,
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), DIVISOR, DIGITS, ref,
                new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP), null), userId).id();
    }

    private static CellQuery yearQuery(List<String> path, int offset) {
        return new CellQuery(YEAR, new Period(RptModel.PERIOD_YEAR, null), path, offset);
    }

    private static CellQuery monthQuery(String level1Key, int offset) {
        return new CellQuery(YEAR, new Period(RptModel.PERIOD_MONTH, 1), Arrays.asList(level1Key), offset);
    }

    private static int lastPageOffset(long total) {
        assertThat(total).as("строк в ячейке первой строки уровня 1 за январь").isPositive();
        return (int) ((total - 1) / RptLimits.PAGE_SIZE * RptLimits.PAGE_SIZE);
    }

    /** Медиана {@value #MEASURE_RUNS} вызовов в миллисекундах; результат вызова используется, чтобы его не выбросил JIT. */
    private static long medianMillis(LongSupplier call) {
        long[] times = new long[MEASURE_RUNS];
        long sink = 0;
        for (int run = 0; run < MEASURE_RUNS; run++) {
            long started = System.nanoTime();
            sink += call.getAsLong();
            times[run] = (System.nanoTime() - started) / 1_000_000;
        }
        assertThat(sink).isNotNegative();
        Arrays.sort(times);
        return times[MEASURE_RUNS / 2];
    }
}
