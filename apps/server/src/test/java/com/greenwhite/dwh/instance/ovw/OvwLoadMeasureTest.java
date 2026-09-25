package com.greenwhite.dwh.instance.ovw;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.ovw.OvwModel.FilterItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.SortItem;
import com.greenwhite.dwh.instance.ovw.service.OvwDataService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Замер «Обзора данных» на 100 000 TEST-строк одного листа: «строки» и «группы» не дольше 2 с (AC-8).
 * Замер: только {@code -Dperf=true}, предел — требование стенда.
 */
@EnabledIfSystemProperty(named = "perf", matches = "true")
class OvwLoadMeasureTest extends EmbeddedPostgresTest {

    private static final long ROWS_TOTAL = 100_000;
    private static final int PACKAGE_ROWS = 10;
    private static final int LAST_PAGE_OFFSET = 99_800;
    private static final int MEASURE_RUNS = 3;
    private static final long LIMIT_MS = 2_000;
    private static final LocalDate PERIOD_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate PERIOD_TO = LocalDate.of(2026, 1, 31);

    /** Доливка до {@code :total} строк тем же load_id, листом и файлом, что у строк применённого пакета. */
    private static final String FILL_SQL = """
            insert into raw.rows (load_id, source_file_id, row_no, sheet, source_row_no, fields)
            select b.load_id, b.source_file_id, b.max_row + g, b.sheet, (b.max_row + g + b.shift)::integer,
                   jsonb_build_object(
                       'row_no', (g % 97)::text,
                       'object_key', lpad(g::text, 9, '0'),
                       'org_name', 'TEST ' || (g % 50),
                       'amount', ((g % 1000) * 1.25)::text,
                       'doc_date', '2026-12-31')
              from (select load_id, source_file_id, sheet, max(row_no) as max_row,
                           max(source_row_no - row_no) as shift, count(*) as cnt
                      from raw.rows
                     group by load_id, source_file_id, sheet) b
             cross join lateral generate_series(1, :total - b.cnt) g
            """;

    @Autowired
    private OvwDataService service;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplSourceService sources;
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

    private long userId;
    private long sourceId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        sourceId = UplPackageTestData.publishedSource(sources, userId, PERIOD_FROM);
    }

    @AfterEach
    void cleanUp() {
        dwhJdbc.sql("delete from raw.rows").update();
    }

    @Test
    @DisplayName("AC-8: на 100 тыс. строк «строки» и «группы» отвечают не дольше 2 с")
    void rowsAndGroupsAnswerWithinLimitOn100kRows() {
        appliedPackage(UplPackageTestData.workbook(PACKAGE_ROWS, 0));
        fillRawRowsUpTo(ROWS_TOTAL);

        RowsQuery filtered = new RowsQuery(null,
                List.of(new FilterItem("org_name", "contains", "TEST 1", null, null)),
                new SortItem("amount", "desc"), null);
        RowsQuery lastPage = new RowsQuery(null, List.of(), null, LAST_PAGE_OFFSET);
        GroupsQuery groups = new GroupsQuery(null, List.of(), "org_name");

        service.rows(sourceId, filtered);
        service.groups(sourceId, groups);

        assertThat(service.rows(sourceId, lastPage).total()).isEqualTo(ROWS_TOTAL);

        long rowsFilterMs = worstMillis(() -> service.rows(sourceId, filtered).total());
        long rowsLastPageMs = worstMillis(() -> service.rows(sourceId, lastPage).total());
        long groupsMs = worstMillis(() -> service.groups(sourceId, groups).groups().size());

        System.out.println("OVW-MEASURE rows_filter=" + rowsFilterMs + " rows_last_page=" + rowsLastPageMs
                + " groups=" + groupsMs + " ms (max)");
        assertThat(rowsFilterMs).as("rows с фильтром и сортировкой, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(rowsLastPageMs).as("rows, последняя страница, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(groupsMs).as("groups по тексту, мс").isLessThanOrEqualTo(LIMIT_MS);
    }

    // ---------- помощники ----------

    private void fillRawRowsUpTo(long total) {
        long sheets = dwhJdbc.sql("select count(distinct (load_id, sheet)) from raw.rows").query(Long.class).single();
        assertThat(sheets).as("строки применённого пакета — один лист одной загрузки").isEqualTo(1);
        dwhJdbc.sql(FILL_SQL).param("total", total).update();
        long count = dwhJdbc.sql("select count(*) from raw.rows").query(Long.class).single();
        assertThat(count).isEqualTo(total);
    }

    /** Худшее время из {@value #MEASURE_RUNS} вызовов в миллисекундах; результат вызова используется, чтобы его не выбросил JIT. */
    private static long worstMillis(LongSupplier call) {
        long worst = 0;
        long sink = 0;
        for (int run = 0; run < MEASURE_RUNS; run++) {
            long started = System.nanoTime();
            sink += call.getAsLong();
            worst = Math.max(worst, (System.nanoTime() - started) / 1_000_000);
        }
        assertThat(sink).isNotNegative();
        return worst;
    }

    private void appliedPackage(byte[] content) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, PERIOD_FROM, PERIOD_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        PackageRow parsed = packages.get(row.publicId().toString());
        assertThat(parsed.status()).isEqualTo(UplPackageModel.VERIFIED);
        PackageRow applied = applies.apply(parsed.publicId().toString(), userId);
        assertThat(applied.status()).isEqualTo(UplPackageModel.APPLIED);
    }
}
