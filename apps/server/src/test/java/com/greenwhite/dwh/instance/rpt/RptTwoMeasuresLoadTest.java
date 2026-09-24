package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.CellQuery;
import com.greenwhite.dwh.instance.rpt.RptModel.CellRows;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Line1;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInput;
import com.greenwhite.dwh.instance.rpt.RptModel.Period;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptTestData.RefRow;
import com.greenwhite.dwh.instance.rpt.RptTestData.SourceRow;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.rpt.service.RptViewService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Замер отчёта из двух мер на 10 тыс. TEST-строк у каждой меры (мера 1 — по дате, мера 2 — колонки-месяцы) и 1 000 строк
 * справочника: расчёт и строки ячейки меры 2 не дольше 2 с (AC-9).
 * 20 тыс. за 2 с — долг: view 2,8–3,0 с (замер 24.09), решение Искандара.
 */
class RptTwoMeasuresLoadTest extends EmbeddedPostgresTest {

    private static final long SOURCE_TOTAL = 10_000;
    private static final long REF_TOTAL = 1_000;
    private static final int PACKAGE_ROWS = 5;
    private static final int YEAR = 2026;
    private static final int YTD_MONTH = 9;
    private static final int MONTHS = 12;
    private static final int DIVISOR = 1000;
    private static final int DIGITS = 1;
    private static final int MEASURE_RUNS = 3;
    private static final long LIMIT_MS = 2_000;
    private static final LocalDate JAN_FROM = LocalDate.of(YEAR, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(YEAR, 1, 31);

    /** Лист анкеты источника меры 2 и его файла. */
    private static final String MONTHS_SHEET = "TEST месяцы";
    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final List<String> MONTH_FIELDS = IntStream.rangeClosed(1, MONTHS)
            .mapToObj(month -> "m" + month).toList();

    /**
     * Общая часть доливки: номер {@code n} продолжает строки применённого пакета листа {@code :sheet} до {@code :total};
     * load_id, файл и лист — те же, номер строки Excel — со сдвигом маленького пакета.
     */
    private static final String FILL_TEMPLATE = """
            insert into raw.rows (load_id, source_file_id, row_no, sheet, source_row_no, fields, rejected)
            select b.load_id, b.source_file_id, b.max_row + n - b.cnt + 1, b.sheet,
                   (b.max_row + n - b.cnt + 1 + b.shift)::integer,
                   %s,
                   false
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
    private static final List<String> MONTHS_KEYS = Stream.concat(
            Stream.of(RptTestData.OBJECT, RptTestData.CODE, RptTestData.GROUP), MONTH_FIELDS.stream()).toList();

    /** Мера 1: даты 2026 только месяцы 1–9, чтобы N = 9. */
    private static final String SOURCE_FIELDS = """
            jsonb_build_object(
                       'okey', lpad(n::text, 9, '0'),
                       'dt', to_char(make_date(2026, (n %% 9 + 1)::integer, (n %% 28 + 1)::integer), 'DD.MM.YYYY'),
                       'amount', ((n %% 1000) * 1.25)::text,
                       'qty', (n %% 50)::text,
                       'code', 'TEST' || (n %% 1000),
                       'grp', 'TEST G' || (n %% 20))""";

    private static final String REF_FIELDS = """
            jsonb_build_object(
                       'okey', lpad(n::text, 9, '0'),
                       'rcode', 'TEST' || n,
                       'rname', 'TEST N' || (n %% 60))""";

    /**
     * Мера 2: код и группа — тем же правилом, что у меры 1; в M12 у каждой 5-й строки пусто.
     * Шаблон форматируется дважды (здесь и в доливке), поэтому процент удвоен дважды.
     */
    private static final String MONTHS_FIELDS = """
            jsonb_build_object(
                       'okey', lpad(n::text, 9, '0'),
                       'code', 'TEST' || (n %%%% 1000),
                       'grp', 'TEST G' || (n %%%% 20))
                   || jsonb_build_object(%s)""".formatted(IntStream.rangeClosed(1, MONTHS)
            .mapToObj(month -> month < MONTHS
                    ? "'m%d', ((n %%%% 500) * 1.5)::text".formatted(month)
                    : "'m%d', case when n %%%% 5 = 0 then null else ((n %%%% 500) * 1.5)::text end".formatted(month))
            .collect(Collectors.joining(", ")));

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
    private long monthsSourceId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        cleanMeta();
        dwhJdbc.sql("delete from raw.rows").update();
        data = new RptTestData(sources, packages, parseJob, applies, files, userId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
        monthsSourceId = publishedMonthsSource();
    }

    @AfterEach
    void cleanUp() {
        dwhJdbc.sql("delete from raw.rows").update();
        cleanMeta();
    }

    @Test
    @DisplayName("AC-9: 10 тыс. строк у каждой меры (5 × стенд) — отчёт и «Откуда цифра» меры 2 не дольше 2 с")
    void twoMeasuresAnswerWithinLimitOnLargeData() {
        data.applyRef(refId, IntStream.range(0, PACKAGE_ROWS)
                .mapToObj(i -> new RefRow("TEST" + i, "TEST N" + i)).toList(), JAN_FROM, JAN_TO);
        data.applySource(sourceId, IntStream.range(0, PACKAGE_ROWS)
                .mapToObj(i -> new SourceRow(String.format("%02d.01.%d", i + 1, YEAR), i * 1.25, i,
                        "TEST" + i, "TEST G" + i)).toList(), JAN_FROM, JAN_TO);
        applyMonthsSource();
        fillUpTo(RptTestData.REF_SHEET, REF_FIELDS, REF_KEYS, REF_TOTAL);
        fillUpTo(RptTestData.SOURCE_SHEET, SOURCE_FIELDS, SOURCE_KEYS, SOURCE_TOTAL);
        fillUpTo(MONTHS_SHEET, MONTHS_FIELDS, MONTHS_KEYS, SOURCE_TOTAL);
        long id = definition();

        ReportView view = service.view(id, YEAR);
        Line1 first = view.lines().getFirst();
        CellQuery grand2 = new CellQuery(YEAR, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0, 2);
        CellRows firstPage = service.cells(id, januaryQuery(first.key(), 0));
        CellQuery lastPage2 = januaryQuery(first.key(), lastPageOffset(firstPage.total()));
        service.cells(id, grand2);
        service.cells(id, lastPage2);

        assertThat(view.grand().count()).isEqualTo(SOURCE_TOTAL);
        assertThat(view.ytdMonth()).isEqualTo(YTD_MONTH);
        assertThat(view.grand().m2()).isNotNull();
        assertThat(view.grand().m2().count()).isEqualTo(filledMonthPairs());
        assertThat(service.cells(id, lastPage2).items()).isNotEmpty();

        long viewMs = medianMillis(() -> service.view(id, YEAR).grand().count());
        long cells2GrandMs = medianMillis(() -> service.cells(id, grand2).total());
        long cells2LastPageMs = medianMillis(() -> service.cells(id, lastPage2).total());

        System.out.println("RPT2-MEASURE view=" + viewMs + " cells2_grand=" + cells2GrandMs
                + " cells2_last_page=" + cells2LastPageMs + " ms (median)");
        assertThat(viewMs).as("расчёт отчёта из двух мер за год, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(cells2GrandMs).as("строки ячейки меры 2 общего итога, мс").isLessThanOrEqualTo(LIMIT_MS);
        assertThat(cells2LastPageMs).as("строки ячейки меры 2 строки уровня 1 за январь, последняя страница, мс")
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

    /** Источник меры 2 с опубликованной анкетой: ключ объекта, код, группа, 12 колонок-месяцев. */
    private long publishedMonthsSource() {
        List<Column> columns = new ArrayList<>(List.of(
                new Column(null, 0, 1, "Ключ TEST", RptTestData.OBJECT, DataType.OBJECT_KEY, true,
                        null, null, KEY_MASK, 9, 1, null),
                column(2, "Код TEST", RptTestData.CODE, DataType.TEXT),
                column(3, "Группа TEST", RptTestData.GROUP, DataType.TEXT)));
        for (int month = 1; month <= MONTHS; month++) {
            columns.add(column(3 + month, monthHeader(month), MONTH_FIELDS.get(month - 1), DataType.NUMBER));
        }
        SourceData source = new SourceData("test.rpt.months." + UUID.randomUUID().toString().substring(0, 8),
                "TEST источник месяцев", "TEST org", null, Periodicity.MONTH, 5, null, null);
        long id = sources.createSource(source, userId).source().id();
        int version = sources.createDraft(id, null, userId).version();
        int lockVersion = sources.getVersion(id, version).lockVersion();
        sources.replaceDraft(id, version, lockVersion, new DraftData(null, null, null, null,
                List.of(new Sheet(null, 0, MONTHS_SHEET, 1, null, List.copyOf(columns)))), userId);
        sources.publish(id, version, RptTestData.VALID_FROM, userId);
        return id;
    }

    /** Маленький пакет меры 2 (5 строк) загрузкой и применением; значения — тем же правилом, что доливка. */
    private void applyMonthsSource() {
        List<String> header = new ArrayList<>(List.of("Ключ TEST", "Код TEST", "Группа TEST"));
        IntStream.rangeClosed(1, MONTHS).mapToObj(RptTwoMeasuresLoadTest::monthHeader).forEach(header::add);
        List<List<Object>> cells = new ArrayList<>();
        for (int i = 0; i < PACKAGE_ROWS; i++) {
            List<Object> row = new ArrayList<>(List.of(String.format("9%08d", i + 1), "TEST" + i, "TEST G" + i));
            for (int month = 1; month <= MONTHS; month++) {
                row.add(month == MONTHS && i % 5 == 0 ? null : (i % 500) * 1.5);
            }
            cells.add(row);
        }
        byte[] content = UplXlsxFixtures.workbook(new SheetSpec(MONTHS_SHEET, 1, header, cells));
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(monthsSourceId, 1, JAN_FROM, JAN_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        PackageRow parsed = packages.get(row.publicId().toString());
        assertThat(parsed.status()).as("пакет меры 2 проверен").isEqualTo(UplPackageModel.VERIFIED);
        PackageRow applied = applies.apply(parsed.publicId().toString(), userId);
        assertThat(applied.status()).as("пакет меры 2 применён").isEqualTo(UplPackageModel.APPLIED);
    }

    /** Доливает лист одним SQL; перед этим сверяет, что поля строк маленького пакета совпадают с доливаемыми. */
    private void fillUpTo(String sheet, String fieldsSql, List<String> fieldKeys, long total) {
        List<String> packageKeys = dwhJdbc.sql("""
                        select distinct k from raw.rows, jsonb_object_keys(fields) k where sheet = :sheet order by k""")
                .param("sheet", sheet).query(String.class).list();
        assertThat(packageKeys).as("поля доливки = поля строк пакета листа " + sheet)
                .containsExactlyInAnyOrderElementsOf(fieldKeys);
        dwhJdbc.sql(FILL_TEMPLATE.formatted(fieldsSql.formatted())).param("sheet", sheet).param("total", total).update();
        long count = dwhJdbc.sql("select count(*) from raw.rows where sheet = :sheet and not rejected")
                .param("sheet", sheet).query(Long.class).single();
        assertThat(count).isEqualTo(total);
    }

    /** Число непустых пар «строка — месяц» меры 2 за месяцы 1…N — тем же правилом, что доливка, прямо по raw. */
    private long filledMonthPairs() {
        String filled = MONTH_FIELDS.subList(0, YTD_MONTH).stream()
                .map(field -> "(case when fields ->> '" + field + "' is null then 0 else 1 end)")
                .collect(Collectors.joining(" + "));
        return dwhJdbc.sql("select coalesce(sum(" + filled + "), 0) from raw.rows where sheet = :sheet and not rejected")
                .param("sheet", MONTHS_SHEET).query(Long.class).single();
    }

    private long definition() {
        RefPart ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        LevelPart level1 = new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME);
        LevelPart level2 = new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP);
        MeasureInput second = new MeasureInput("TEST мера 2", monthsSourceId, 1, null, MONTH_FIELDS, null,
                1, 0, ref, level1, level2);
        return definitions.create(new DefinitionInput("TEST замер двух мер", sourceId, 1, RptTestData.DATE,
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), DIVISOR, DIGITS, ref, level1, level2, null,
                "TEST мера 1", null, second), userId).id();
    }

    private static CellQuery januaryQuery(String level1Key, int offset) {
        return new CellQuery(YEAR, new Period(RptModel.PERIOD_MONTH, 1), Arrays.asList(level1Key), offset, 2);
    }

    private static int lastPageOffset(long total) {
        assertThat(total).as("строк меры 2 в ячейке первой строки уровня 1 за январь").isPositive();
        return (int) ((total - 1) / RptLimits.PAGE_SIZE * RptLimits.PAGE_SIZE);
    }

    private static String monthHeader(int month) {
        return "Месяц " + month + " TEST";
    }

    private static Column column(int position, String nameInFile, String targetField, DataType type) {
        return new Column(null, 0, position, nameInFile, targetField, type, false,
                null, null, null, null, null, null);
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
