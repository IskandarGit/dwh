package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.CellQuery;
import com.greenwhite.dwh.instance.rpt.RptModel.CellRows;
import com.greenwhite.dwh.instance.rpt.RptModel.Definition;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Line;
import com.greenwhite.dwh.instance.rpt.RptModel.Line1;
import com.greenwhite.dwh.instance.rpt.RptModel.Line2;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInfo;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInput;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/** Расчёт сводного отчёта и строки ячейки (контракт И15а, разделы 2.3, 3; AC-3…AC-7). Значения — выдуманные TEST. */
class RptViewServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate JAN_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);
    private static final int DIVISOR = 1000;
    private static final String ALPHA = "test alpha";
    private static final String BETA = "test beta";
    private static final String G1 = "test g1";

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
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from rpt_reports").update();
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        data = new RptTestData(sources, packages, parseJob, applies, files, userId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
        data.applyRef(refId, List.of(
                new RefRow("TEST-1", "TEST Alpha"),
                new RefRow("TEST-2", "TEST beta"),
                new RefRow("TEST-1", "TEST Alpha повтор")), JAN_FROM, JAN_TO);
        data.applySource(sourceId, List.of(
                new SourceRow("15.01.2026", 1500.5, 1, "TEST-1", "TEST g1"),
                new SourceRow("20.01.2026", 2500, 2, "TEST-1", " test G1 "),
                new SourceRow("10.02.2026", 1000, 1, "TEST-1", "TEST g2"),
                new SourceRow("05.03.2026", 700.25, 3, "TEST-2", "TEST g1"),
                new SourceRow("11.03.2026", 300, 1, "TEST-9", "TEST g3"),
                new SourceRow("12.04.2026", 50, 1, "TEST-2", null),
                new SourceRow(null, 400, 1, "TEST-1", "TEST g1"),
                new SourceRow("01.06.2025", 900, 1, "TEST-2", "TEST g1")), JAN_FROM, JAN_TO);
    }

    @Test
    @DisplayName("AC-3, AC-5: два уровня, делитель 1000 — общий итог = Σ уровня 1, подытог = Σ уровня 2, «Итого» = Σ месяцев")
    void twoLevelsConverge() {
        ReportView view = service.view(twoLevels(), null);

        assertThat(view.grand().total()).isEqualTo("6.05075");
        assertThat(view.grand().count()).isEqualTo(6);
        assertThat(addUp(view.lines().stream().map(line -> line.total()).toList()))
                .isEqualByComparingTo(number(view.grand().total()));
        assertMonthsAdd(view.grand().cells(), view.lines().stream().map(Line1::cells).toList());
        assertMonthsMakeTotal(view.grand().cells(), view.grand().total());
        for (Line1 line : view.lines()) {
            assertThat(addUp(line.lines().stream().map(Line2::total).toList()))
                    .as(String.valueOf(line.key())).isEqualByComparingTo(number(line.total()));
            assertMonthsAdd(line.cells(), line.lines().stream().map(Line2::cells).toList());
            assertMonthsMakeTotal(line.cells(), line.total());
            line.lines().forEach(child -> assertMonthsMakeTotal(child.cells(), child.total()));
        }
        Line1 alpha = view.lines().getFirst();
        assertThat(alpha.cells().getFirst()).isEqualTo("4.0005");
        assertThat(alpha.cells().get(1)).isEqualTo("1");
        assertThat(alpha.cells().get(2)).isNull();
    }

    @Test
    @DisplayName("AC-4: группы по названию без учёта регистра, «Без названия» последней; повтор ключа справочника не множит строки")
    void groupsAndOrder() {
        ReportView view = service.view(twoLevels(), 2026);

        assertThat(view.lines()).extracting(Line1::key, Line1::name)
                .containsExactly(tuple(ALPHA, "TEST Alpha"), tuple(BETA, "TEST beta"), tuple(null, null));
        assertThat(view.lines().get(0).lines()).extracting(Line2::key, Line2::count)
                .containsExactly(tuple(G1, 2L), tuple("test g2", 1L));
        assertThat(view.lines().get(1).lines()).extracting(Line2::key, Line2::count)
                .containsExactly(tuple(G1, 1L), tuple(null, 1L));
        assertThat(view.lines().get(2).lines()).extracting(Line2::key).containsExactly("test g3");
        assertThat(view.refDuplicateKeys()).isEqualTo(1);
        assertThat(view.labels().level1()).isEqualTo("Название TEST");
        assertThat(view.labels().level2()).isEqualTo("Группа TEST");
        assertThat(view.labels().measure()).isEqualTo("Сумма TEST");
        assertThat(view.divisor()).isEqualTo(DIVISOR);
    }

    @Test
    @DisplayName("AC-6: строки без даты — отдельно; годы по возрастанию; без года — последний")
    void undatedAndYears() {
        long id = twoLevels();
        ReportView view = service.view(id, null);

        assertThat(view.years()).containsExactly(2025, 2026);
        assertThat(view.year()).isEqualTo(2026);
        assertThat(view.undated()).isNotNull();
        assertThat(view.undated().count()).isEqualTo(1);
        assertThat(view.undated().value()).isEqualTo("0.4");

        ReportView earlier = service.view(id, 2025);
        assertThat(earlier.year()).isEqualTo(2025);
        assertThat(earlier.grand().total()).isEqualTo("0.9");
        assertThat(earlier.lines()).extracting(Line1::key).containsExactly(BETA);
    }

    @Test
    @DisplayName("AC-6: за год без строк — линий нет, у общего итога ячейки пусты")
    void yearWithoutRows() {
        ReportView view = service.view(twoLevels(), 2024);

        assertThat(view.lines()).isEmpty();
        assertThat(view.grand().cells()).hasSize(12).containsOnlyNulls();
        assertThat(view.grand().total()).isNull();
        assertThat(view.grand().count()).isZero();
    }

    @Test
    @DisplayName("AC-7: строки ячейки уровня 2, подытога, общего итога и без даты — число = count линии, мера до делителя")
    void cellRows() {
        long id = twoLevels();
        ReportView view = service.view(id, 2026);
        Line1 alpha = view.lines().getFirst();
        Line2 alphaG1 = alpha.lines().getFirst();

        CellRows month = service.cells(id, new CellQuery(2026, new Period(RptModel.PERIOD_MONTH, 1),
                Arrays.asList(ALPHA, G1), 0));
        assertThat(month.total()).isEqualTo(2);
        assertThat(number(month.value())).isEqualByComparingTo(times(alphaG1.cells().getFirst()));
        assertThat(month.limit()).isEqualTo(RptLimits.PAGE_SIZE);
        assertThat(month.items()).hasSize(2).allSatisfy(item -> {
            assertThat(item.file()).isEqualTo("TEST.xlsx");
            assertThat(item.sheet()).isEqualTo(RptTestData.SOURCE_SHEET);
            assertThat(item.excelRow()).isNotNull();
            assertThat(item.level1()).isEqualTo("TEST Alpha");
        });

        CellRows level2 = yearCell(id, Arrays.asList(ALPHA, G1));
        assertThat(level2.total()).isEqualTo(alphaG1.count());
        assertThat(number(level2.value())).isEqualByComparingTo(times(alphaG1.total()));

        CellRows subtotal = yearCell(id, List.of(ALPHA));
        assertThat(subtotal.total()).isEqualTo(alpha.count());
        assertThat(number(subtotal.value())).isEqualByComparingTo(times(alpha.total()));

        CellRows grand = yearCell(id, List.of());
        assertThat(grand.total()).isEqualTo(view.grand().count());
        assertThat(number(grand.value())).isEqualByComparingTo(times(view.grand().total()));

        CellRows untitled = yearCell(id, Arrays.asList(new String[] {null}));
        assertThat(untitled.total()).isEqualTo(view.lines().getLast().count());

        CellRows undated = service.cells(id, new CellQuery(null, new Period(RptModel.PERIOD_UNDATED, null), List.of(), 0));
        assertThat(undated.total()).isEqualTo(view.undated().count());
        assertThat(number(undated.value())).isEqualByComparingTo(times(view.undated().value()));
        assertThat(undated.items()).singleElement().satisfies(item -> assertThat(item.date()).isNull());
    }

    @Test
    @DisplayName("2.3: из анкеты источника убрана колонка уровня — расчёт 409 RPT_DEFINITION_STALE, описание читается без её подписи")
    void staleDefinition() {
        long id = twoLevels();
        int version = data.republishSourceWithoutGroup(sourceId, LocalDate.of(2026, 7, 1));
        data.applySourceWithoutGroup(sourceId, version, List.of(
                new SourceRow("15.07.2026", 10, 1, "TEST-1", null)), LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31));

        assertThatThrownBy(() -> service.view(id, null)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(409);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_DEFINITION_STALE);
            assertThat(e.getFieldErrors()).extracting(FieldErrorItem::field, FieldErrorItem::code)
                    .containsExactly(tuple("level2.field", RptErrors.RPT_COLUMN_UNKNOWN));
        });
        assertThatThrownBy(() -> yearCell(id, List.of()))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_DEFINITION_STALE));

        Definition definition = definitions.get(id);
        assertThat(definition.labels()).doesNotContainKey("source:" + RptTestData.GROUP)
                .containsKey("source:" + RptTestData.DATE);
    }

    @Test
    @DisplayName("Предел: линий больше MAX_LINES — 422 RPT_TOO_MANY_LINES, отчёт не показывается")
    void tooManyLines() {
        long manySource = data.publishedSource();
        List<SourceRow> rows = IntStream.rangeClosed(0, RptLimits.MAX_LINES)
                .mapToObj(i -> new SourceRow("15.01.2026", 1, 1, "TEST-1", "TEST g" + i))
                .toList();
        data.applySource(manySource, rows, JAN_FROM, JAN_TO);
        long id = definitions.create(input("TEST many", manySource, null,
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP), null,
                new Measure(RptModel.MEASURE_COUNT, null), 1), userId).id();

        assertThatThrownBy(() -> service.view(id, null)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(422);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_TOO_MANY_LINES);
        });
    }

    @Test
    @DisplayName("AC-7: неверный запрос ячейки — 422 RPT_CELL_INVALID у своего поля")
    void invalidCellQuery() {
        long id = twoLevels();

        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_MONTH, 13), List.of(), 0), "period");
        assertCellInvalid(id, new CellQuery(2026, new Period("TEST", null), List.of(), 0), "period");
        assertCellInvalid(id, new CellQuery(null, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0), "year");
        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null),
                List.of(ALPHA, G1, "test x"), 0), "path");
        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), List.of(), 7), "offset");
        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), List.of(),
                RptLimits.PAGE_SIZE), "offset");
    }

    @Test
    @DisplayName("Мера «число строк»: ячейки равны числу строк, подписи меры нет")
    void countMeasure() {
        long id = definitions.create(input("TEST count", sourceId, null,
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP), null,
                new Measure(RptModel.MEASURE_COUNT, null), 1), userId).id();

        ReportView view = service.view(id, 2026);

        assertThat(view.labels().measure()).isNull();
        assertThat(view.labels().level2()).isNull();
        assertThat(view.grand().total()).isEqualTo(String.valueOf(view.grand().count())).isEqualTo("6");
        assertThat(view.lines()).allSatisfy(line -> {
            assertThat(line.total()).isEqualTo(String.valueOf(line.count()));
            assertThat(line.lines()).isEmpty();
        });
        assertThat(view.lines()).extracting(Line1::key).containsExactly(G1, "test g2", "test g3", null);
    }

    @Test
    @DisplayName("Отчёта нет — 404 RPT_REPORT_NOT_FOUND")
    void missingReport() {
        assertThatThrownBy(() -> service.view(-1L, null)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(404);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_REPORT_NOT_FOUND);
        });
    }

    // ---------- И15б: две меры (контракт 10.6–10.8) ----------

    @Test
    @DisplayName("10.7: отчёт И15а — прежние поля те же, новые: ytdMonth = N, одна мера, m2 и ratio пусты")
    void singleMeasureReportGetsNewFieldsOnly() {
        ReportView view = service.view(twoLevels(), 2026);

        assertThat(view.ytdMonth()).isEqualTo(4);
        assertThat(view.measures()).containsExactly(new MeasureInfo("Сумма TEST", DIVISOR, 2, false));
        assertThat(view.undated2()).isNull();
        assertThat(view.grand().m2()).isNull();
        assertThat(view.grand().ratio()).isNull();
        assertThat(view.lines()).isNotEmpty().allSatisfy(line -> {
            assertThat(line.m2()).isNull();
            assertThat(line.ratio()).isNull();
            assertThat(line.lines()).allSatisfy(child -> {
                assertThat(child.m2()).isNull();
                assertThat(child.ratio()).isNull();
            });
        });
    }

    @Test
    @DisplayName("10.6: склейка линий без пары в обе стороны, отношение (v2 = 0, v2 пусто, v1 пусто), N по мере 1")
    void twoMeasuresMergeAndRatio() {
        long second = data.publishedSource();
        data.applySource(second, List.of(
                new SourceRow("10.01.2026", 200, 1, "TEST-1", "TEST G1"),
                new SourceRow("15.02.2026", 50, 1, "TEST-1", "TEST g9"),
                new SourceRow("11.03.2026", 0, 1, "TEST-1", "TEST g3"),
                new SourceRow("20.05.2026", 70, 1, "TEST-1", "TEST g1"),
                new SourceRow(null, 30, 1, "TEST-1", "TEST g1")), JAN_FROM, JAN_TO);
        long id = twoMeasures("TEST merge", byDate("TEST мера 1", sourceId, 1, null, groupLevel(), null),
                byDate("TEST мера 2", second, 1, null, groupLevel(), null));

        ReportView view = service.view(id, null);

        assertThat(view.year()).isEqualTo(2026);
        assertThat(view.ytdMonth()).isEqualTo(4);
        assertThat(view.measures()).containsExactly(new MeasureInfo("TEST мера 1", 1, 0, false),
                new MeasureInfo("TEST мера 2", 1, 0, false));
        assertThat(view.undated2()).isEqualTo(new RptModel.Undated(1, "30"));
        assertThat(view.lines()).extracting(Line1::key)
                .containsExactly(G1, "test g2", "test g3", "test g9", null);

        Line1 g1 = view.lines().get(0);
        assertThat(g1.total()).isEqualTo("4700.75");
        assertThat(g1.m2().cells().get(4)).isEqualTo("70");
        assertThat(g1.m2().total()).isEqualTo("200");
        assertThat(g1.m2().count()).isEqualTo(1);
        assertThat(g1.ratio().cells().getFirst()).isEqualTo("2000.250000");
        assertThat(g1.ratio().total()).isEqualTo("2350.375000");

        Line1 g2 = view.lines().get(1);
        assertThat(g2.m2()).isNull();
        assertThat(g2.ratio().cells()).hasSize(12).containsOnlyNulls();
        assertThat(g2.ratio().total()).isNull();

        Line1 g3 = view.lines().get(2);
        assertThat(g3.m2().cells().get(2)).isEqualTo("0");
        assertThat(g3.ratio().cells().get(2)).isNull();
        assertThat(g3.ratio().total()).isNull();

        Line1 g9 = view.lines().get(3);
        assertThat(g9.name()).isEqualTo("TEST g9");
        assertThat(g9.cells()).hasSize(12).containsOnlyNulls();
        assertThat(g9.total()).isNull();
        assertThat(g9.count()).isZero();
        assertThat(g9.m2().total()).isEqualTo("50");
        assertThat(g9.ratio().cells().get(1)).isEqualTo("0");
        assertThat(g9.ratio().total()).isEqualTo("0");

        assertThat(view.lines().getLast().m2()).isNull();
        assertThat(view.grand().m2().total()).isEqualTo("250");
        assertThat(view.grand().m2().cells().get(4)).isEqualTo("70");
        assertThat(addUp(view.lines().stream().filter(line -> line.m2() != null).map(line -> line.m2().total()).toList()))
                .isEqualByComparingTo(number(view.grand().m2().total()));
        assertThat(addUp(view.grand().m2().cells().subList(0, view.ytdMonth())))
                .isEqualByComparingTo(number(view.grand().m2().total()));

        CellRows total2 = service.cells(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), List.of(G1), 0, 2));
        assertThat(total2.total()).isEqualTo(1);
        assertThat(total2.value()).isEqualTo("200");
        assertThat(total2.items()).singleElement().satisfies(item -> assertThat(item.column()).isNull());
        CellRows may2 = service.cells(id, new CellQuery(2026, new Period(RptModel.PERIOD_MONTH, 5), List.of(G1), 0, 2));
        assertThat(may2.value()).isEqualTo("70");
        CellRows undated2 = service.cells(id, new CellQuery(null, new Period(RptModel.PERIOD_UNDATED, null), List.of(), 0, 2));
        assertThat(undated2.total()).isEqualTo(1);
    }

    @Test
    @DisplayName("10.6 п.4: мера 2 на двух уровнях — подытог = Σ её строк, общий = Σ уровня 1, итог = месяцы 1…N")
    void secondMeasureConverges() {
        long second = data.publishedSource();
        data.applySource(second, List.of(
                new SourceRow("10.01.2026", 100, 1, "TEST-1", "TEST g1"),
                new SourceRow("12.02.2026", 20.5, 1, "TEST-2", "TEST g2"),
                new SourceRow("03.03.2026", 7, 1, "TEST-9", null),
                new SourceRow("09.04.2026", 1.25, 1, "TEST-1", "TEST g1"),
                new SourceRow("20.05.2026", 1000, 1, "TEST-2", "TEST g1")), JAN_FROM, JAN_TO);
        RefPart ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        LevelPart level1 = new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME);
        long id = twoMeasures("TEST converge", byDate("TEST мера 1", sourceId, DIVISOR, ref, level1, groupLevel()),
                byDate("TEST мера 2", second, 1, ref, level1, groupLevel()));

        ReportView view = service.view(id, 2026);

        assertThat(view.ytdMonth()).isEqualTo(4);
        RptModel.M2 grand = view.grand().m2();
        assertThat(grand.total()).isEqualTo("128.75");
        List<Line1> withM2 = view.lines().stream().filter(line -> line.m2() != null).toList();
        assertThat(withM2).isNotEmpty();
        assertThat(addUp(withM2.stream().map(line -> line.m2().total()).toList()))
                .isEqualByComparingTo(number(grand.total()));
        assertMonthsAdd(grand.cells(), withM2.stream().map(line -> line.m2().cells()).toList());
        assertMonthsMakeYtd(grand, view.ytdMonth());
        for (Line1 line : withM2) {
            List<Line2> children = line.lines().stream().filter(child -> child.m2() != null).toList();
            assertThat(addUp(children.stream().map(child -> child.m2().total()).toList()))
                    .as(String.valueOf(line.key())).isEqualByComparingTo(number(line.m2().total()));
            assertMonthsAdd(line.m2().cells(), children.stream().map(child -> child.m2().cells()).toList());
            assertMonthsMakeYtd(line.m2(), view.ytdMonth());
            children.forEach(child -> assertMonthsMakeYtd(child.m2(), view.ytdMonth()));
        }
    }

    @Test
    @DisplayName("10.6 п.1, 10.8: обе меры колонками-месяцами одного источника — года нет, таблица считается, строки с колонкой")
    void bothMeasuresByMonthColumns() {
        long id = twoMeasures("TEST months",
                byMonthColumns("TEST план", RptTestData.months(RptTestData.AMOUNT, RptTestData.QTY)),
                byMonthColumns("TEST факт", RptTestData.months(RptTestData.QTY)));

        ReportView view = service.view(id, null);

        assertThat(view.years()).isEmpty();
        assertThat(view.year()).isNull();
        assertThat(view.lines()).isNotEmpty();
        assertThat(view.ytdMonth()).isEqualTo(2);
        assertThat(view.measures()).extracting(RptModel.MeasureInfo::byMonthColumns).containsExactly(true, true);
        assertThat(view.labels().measure()).isEqualTo("TEST план");
        assertThat(view.undated()).isNull();
        assertThat(view.undated2()).isNull();
        assertThat(view.grand().cells().subList(0, 2)).containsExactly("7350.75", "11");
        assertThat(view.grand().total()).isEqualTo("7361.75");
        assertThat(view.grand().m2().cells().getFirst()).isEqualTo("11");
        assertThat(view.grand().m2().total()).isEqualTo("11");
        assertThat(view.grand().ratio().cells().subList(0, 2)).containsExactly("66825.000000", null);
        assertThat(view.grand().ratio().total()).isEqualTo("66925.000000");

        CellRows second = service.cells(id, new CellQuery(null, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0, 2));
        assertThat(second.total()).isEqualTo(8);
        assertThat(second.value()).isEqualTo("11");
        assertThat(second.items()).hasSize(8).allSatisfy(item -> {
            assertThat(item.column()).isEqualTo("Количество TEST");
            assertThat(item.date()).isNull();
        });
        CellRows first = service.cells(id, new CellQuery(null, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0));
        assertThat(first.total()).isEqualTo(16);
        assertThat(first.value()).isEqualTo("7361.75");
        assertThat(first.items()).extracting(RptModel.CellItem::column)
                .containsOnly("Сумма TEST", "Количество TEST");
        assertCellInvalid(id, new CellQuery(null, new Period(RptModel.PERIOD_UNDATED, null), List.of(), 0, 2), "period");
    }

    @Test
    @DisplayName("10.8: мера 2 у отчёта без неё или неизвестная мера — 422 RPT_CELL_INVALID у measure")
    void invalidCellMeasure() {
        long id = twoLevels();

        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0, 2), "measure");
        assertCellInvalid(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), List.of(), 0, 3), "measure");
    }

    @Test
    @DisplayName("2.3, 10.3: из анкеты источника меры 2 убрана колонка уровня — 409 RPT_DEFINITION_STALE у second.level1.field")
    void staleSecondMeasure() {
        long first = data.publishedSource();
        data.applySource(first, List.of(new SourceRow("15.01.2026", 1, 1, "TEST-1", "TEST g1")), JAN_FROM, JAN_TO);
        long id = twoMeasures("TEST stale", byDate("TEST мера 1", first, 1, null, groupLevel(), null),
                byDate("TEST мера 2", sourceId, 1, null, groupLevel(), null));
        int version = data.republishSourceWithoutGroup(sourceId, LocalDate.of(2026, 7, 1));
        data.applySourceWithoutGroup(sourceId, version, List.of(
                new SourceRow("15.07.2026", 10, 1, "TEST-1", null)), LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31));

        assertThatThrownBy(() -> service.view(id, null)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(409);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_DEFINITION_STALE);
            assertThat(e.getFieldErrors()).extracting(FieldErrorItem::field, FieldErrorItem::code)
                    .containsExactly(tuple("second.level1.field", RptErrors.RPT_COLUMN_UNKNOWN));
        });
    }

    // ---------- помощники ----------

    /** Отчёт: уровень 1 — название справочника, уровень 2 — группа источника, мера — сумма, делитель 1000. */
    private long twoLevels() {
        RefPart ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        return definitions.create(input("TEST two levels", sourceId, ref,
                new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP),
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), DIVISOR), userId).id();
    }

    private static DefinitionInput input(String name, long source, RefPart ref, LevelPart level1, LevelPart level2,
                                         Measure measure, int divisor) {
        return new DefinitionInput(name, source, 1, RptTestData.DATE, measure, divisor, 2, ref, level1, level2, null);
    }

    /** Отчёт из двух мер: мера 1 — поля описания, мера 2 — {@code second}. */
    private long twoMeasures(String name, MeasureInput first, MeasureInput second) {
        return definitions.create(new DefinitionInput(name, first.sourceId(), first.sourceSheet(), first.dateField(),
                first.measure(), first.divisor(), first.decimals(), first.ref(), first.level1(), first.level2(), null,
                first.name(), first.monthFields(), second), userId).id();
    }

    /** Мера по колонке-дате: сумма колонки суммы, 0 знаков. */
    private static MeasureInput byDate(String name, long source, int divisor, RefPart ref, LevelPart level1,
                                       LevelPart level2) {
        return new MeasureInput(name, source, 1, RptTestData.DATE, null,
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), divisor, 0, ref, level1, level2);
    }

    /** Мера колонками-месяцами источника {@code sourceId}, один уровень — группа. */
    private MeasureInput byMonthColumns(String name, List<String> months) {
        return new MeasureInput(name, sourceId, 1, null, months, null, 1, 0, null, groupLevel(), null);
    }

    private static LevelPart groupLevel() {
        return new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP);
    }

    /** Итог меры 2 = Σ её месяцев 1…N; строк за 1…N нет — итог пуст, месяцы 1…N пусты. */
    private static void assertMonthsMakeYtd(RptModel.M2 part, int ytdMonth) {
        BigDecimal total = part.total() == null ? BigDecimal.ZERO : number(part.total());
        assertThat(addUp(part.cells().subList(0, ytdMonth))).isEqualByComparingTo(total);
    }

    private CellRows yearCell(long id, List<String> path) {
        return service.cells(id, new CellQuery(2026, new Period(RptModel.PERIOD_YEAR, null), path, 0));
    }

    private void assertCellInvalid(long id, CellQuery query, String field) {
        assertThatThrownBy(() -> service.cells(id, query)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(422);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_CELL_INVALID);
            assertThat(e.getFieldErrors()).extracting(FieldErrorItem::field).containsExactly(field);
        });
    }

    /** Каждый месяц родителя = Σ того же месяца детей (пустые ячейки — ноль). */
    private static void assertMonthsAdd(List<String> parent, List<List<String>> children) {
        assertThat(parent).hasSize(12);
        for (int month = 0; month < 12; month++) {
            List<String> parts = new ArrayList<>();
            for (List<String> child : children) {
                parts.add(child.get(month));
            }
            assertThat(addUp(parts)).as("месяц " + (month + 1))
                    .isEqualByComparingTo(parent.get(month) == null ? BigDecimal.ZERO : number(parent.get(month)));
        }
    }

    private static void assertMonthsMakeTotal(List<String> months, String total) {
        assertThat(addUp(months)).isEqualByComparingTo(number(total));
    }

    private static BigDecimal addUp(List<String> values) {
        return values.stream().filter(Objects::nonNull).map(BigDecimal::new).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal number(String value) {
        return new BigDecimal(value);
    }

    private static BigDecimal times(String shown) {
        return number(shown).multiply(BigDecimal.valueOf(DIVISOR));
    }
}
