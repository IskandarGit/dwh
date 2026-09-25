package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
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
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.dhatim.fastexcel.reader.Cell;
import org.dhatim.fastexcel.reader.CellType;
import org.dhatim.fastexcel.reader.ReadableWorkbook;
import org.dhatim.fastexcel.reader.Row;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Сквозная проверка отчёта из двух мер на трёх выдуманных сферах разного строения (AC-9, контракт И15б разделы 10.3–10.8):
 * файлы загружаются и применяются, отчёт описывается запросом, и каждая ячейка обеих мер и отношения, «итог с начала года»,
 * годы и «без даты» сверяются со значениями, которые тест сам считает по байтам xlsx, не вызывая классов расчёта.
 * Отклонённые анкетой строки не считаются (AC-7). Значения — только TEST и числа.
 */
class RptTwoMeasuresEndToEndTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/rpt";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String KEY_HEADER = "Ключ TEST";
    private static final String KEY_FIELD = "okey";
    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final LocalDate VALID_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate PACKAGE_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate PACKAGE_TO = LocalDate.of(2026, 1, 31);
    private static final int PAGE_SIZE = 200;
    private static final int MONTHS = 12;
    private static final int SCALE = 10;
    private static final int RATIO_SCALE = 6;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal TOLERANCE = new BigDecimal("0.000001");
    private static final DateTimeFormatter FILE_DATE =
            DateTimeFormatter.ofPattern("dd.MM.uuuu").withResolverStyle(ResolverStyle.STRICT);
    private static final String ORIGIN_SOURCE = "source";
    private static final String ORIGIN_REF = "ref";
    private static final String MEASURE_TOTAL = "total";
    private static final String NO_COLUMN = "";

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
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

    private MockMvc mvc;
    private long userId;
    private Session admin;

    private record Session(Cookie session, Cookie csrf) {
    }

    /** Колонка анкеты и файла: шапка, поле, тип. Позиция — место в списке. */
    private record Col(String header, String field, DataType type) {
    }

    /** Уровень отчёта: откуда поле и какое. */
    private record Level(String origin, String field) {
    }

    /** Пара ключа связи: поле источника и поле справочника. */
    private record KeyPair(String field, String refField) {
    }

    /** Файл сферы: лист, колонки, строки и номера строк Excel, которые анкета обязана отклонить. */
    private record FileSpec(String sheet, List<Col> cols, List<List<Object>> rows, Set<Integer> mustReject) {
    }

    /**
     * Мера отчёта: файл-источник (номер в списке файлов сферы), ровно одно из {@code dateField}/{@code monthFields},
     * справочник (номер файла или {@code null}), ключи и уровни.
     */
    private record MeasureSpec(String name, int source, String dateField, String measureField, List<String> monthFields,
                               int divisor, int decimals, Integer ref, List<KeyPair> keys, Level level1, Level level2) {
        boolean byMonths() {
            return monthFields != null;
        }
    }

    /** Сфера: файлы и две меры одного отчёта. */
    private record Sphere(String name, List<FileSpec> files, MeasureSpec first, MeasureSpec second) {
        @Override
        public String toString() {
            return name;
        }
    }

    /** Загруженный файл: анкета, байты, отклонённые строки, ordinal листа. */
    private record Loaded(FileSpec spec, long sourceId, byte[] content, Set<Integer> rejected, int ordinal) {
    }

    /** Строка файла: номер строки Excel и значения по полям (текст, число или {@code null}). */
    private record FileRow(int excelRow, Map<String, Object> values) {
    }

    /** Ячейка ожидаемого: сумма меры до делителя, число «строк» (у колонок-месяцев — пар) и сами пары «строка Excel|колонка». */
    private static final class Agg {
        private BigDecimal sum = BigDecimal.ZERO;
        private long count;
        private final Set<Integer> rows = new HashSet<>();
        private final Set<String> pairs = new HashSet<>();

        void add(BigDecimal measure, int excelRow, String column) {
            if (measure != null) {
                sum = sum.add(measure);
            }
            count++;
            rows.add(excelRow);
            pairs.add(pair(excelRow, column));
        }

        void addAll(Agg other) {
            sum = sum.add(other.sum);
            count += other.count;
            rows.addAll(other.rows);
            pairs.addAll(other.pairs);
        }
    }

    /** Линия ожидаемого: двенадцать месяцев. */
    private static final class Bucket {
        private final Agg[] months = new Agg[MONTHS];

        Bucket() {
            for (int i = 0; i < MONTHS; i++) {
                months[i] = new Agg();
            }
        }

        void add(int month, BigDecimal measure, int excelRow, String column) {
            months[month - 1].add(measure, excelRow, column);
        }

        /** Итог с начала года: месяцы 1…N. */
        Agg upTo(int untilMonth) {
            Agg total = new Agg();
            for (int i = 0; i < untilMonth; i++) {
                total.addAll(months[i]);
            }
            return total;
        }

        int lastMonthWithRows() {
            for (int i = MONTHS - 1; i >= 0; i--) {
                if (months[i].count > 0) {
                    return i + 1;
                }
            }
            return 0;
        }

        int firstMonthWithRows() {
            for (int i = 0; i < MONTHS; i++) {
                if (months[i].count > 0) {
                    return i + 1;
                }
            }
            return 0;
        }
    }

    /** Ожидаемое меры в одном году (или без года): общий итог, линии уровня 1 и 2 по нормализованному названию. */
    private static final class Facts {
        private final Bucket grand = new Bucket();
        private final Map<String, Bucket> lines1 = new HashMap<>();
        private final Map<String, Map<String, Bucket>> lines2 = new HashMap<>();

        void add(String group1, String group2, boolean twoLevels, int month, BigDecimal measure, int excelRow,
                 String column) {
            grand.add(month, measure, excelRow, column);
            lines1.computeIfAbsent(group1, g -> new Bucket()).add(month, measure, excelRow, column);
            if (twoLevels) {
                lines2.computeIfAbsent(group1, g -> new HashMap<>())
                        .computeIfAbsent(group2, g -> new Bucket()).add(month, measure, excelRow, column);
            }
        }
    }

    /** Ожидаемое меры: по годам (мера по дате) или одно на все годы (колонки-месяцы), «без даты», подписи колонок-месяцев. */
    private record MeasureFacts(MeasureSpec spec, TreeMap<Integer, Facts> years, Facts noYear, Agg undated,
                                String sheet) {
        Facts in(Integer year) {
            if (spec.byMonths()) {
                return noYear;
            }
            return years.getOrDefault(year, new Facts());
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        DefaultMockMvcBuilder builder = MockMvcBuilders.webAppContextSetup(wac).apply(springSecurity());
        IdempotencyFilter idempotency = wac.getBeanProvider(IdempotencyFilter.class).getIfAvailable();
        if (idempotency != null) {
            builder.addFilters(idempotency);
        }
        mvc = builder.build();

        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from rpt_reports").update();
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();

        String login = "rpt-e2e2-" + rnd();
        users.createUser("TEST " + login, login, login + "@test.local", null, PASSWORD, null, "ru", "UTC", null,
                Map.of(), false, false, List.of(roleId("admin")), userId);
        admin = login(login);
    }

    static Stream<Sphere> spheres() {
        return Stream.of(sphereMonthColumnsOtherSource(), sphereBothMonthColumns(), sphereBothByDate());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("spheres")
    @DisplayName("AC-9: три сферы одной программой — каждая ячейка двух мер и отношения = подсчёту по xlsx")
    void everyCellOfTwoMeasuresMatchesFile(Sphere sphere) throws Exception {
        List<Loaded> loaded = new ArrayList<>();
        for (FileSpec file : sphere.files()) {
            byte[] content = workbook(file);
            long sourceId = publish("test.rpt.e2e2.", file.sheet(), file.cols());
            Set<Integer> rejected = apply(sourceId, content, file.sheet());
            assertThat(rejected).as(sphere.name() + " · " + file.sheet() + " · отклонённые строки")
                    .containsAll(file.mustReject());
            loaded.add(new Loaded(file, sourceId, content, rejected, sheetOrdinal(sourceId, file.sheet())));
        }

        MeasureFacts first = expected(sphere.first(), loaded);
        MeasureFacts second = expected(sphere.second(), loaded);

        long twoMeasures = createReport("TEST две меры " + rnd(), sphere.first(), sphere.second(), loaded);
        checkTwoMeasures(sphere.name() + " · две меры", twoMeasures, first, second, loaded);

        long oneMeasure = createReport("TEST одна мера " + rnd(), sphere.first(), null, loaded);
        checkOneMeasure(sphere.name() + " · одна мера", oneMeasure, first);
    }

    // ---------- сверка отчёта из двух мер ----------

    private void checkTwoMeasures(String what, long reportId, MeasureFacts first, MeasureFacts second,
                                  List<Loaded> loaded) throws Exception {
        List<Integer> expectedYears = expectedYears(first, second);
        Map<String, Object> latest = getJson(BASE + "/reports/" + reportId + "/view");
        assertThat(numbers(latest.get("years"))).as(what + " · годы").containsExactlyElementsOf(expectedYears);

        for (Integer year : yearsToCheck(expectedYears)) {
            String inYear = what + " · " + (year == null ? "без года" : year);
            Map<String, Object> view = view(reportId, year);
            checkYear(inYear, view, year);
            Facts f1 = first.in(year);
            Facts f2 = second.in(year);
            int ytd = ytdMonth(f1);
            assertThat(((Number) view.get("ytdMonth")).intValue()).as(inYear + " · ytdMonth").isEqualTo(ytd);

            List<Map<String, Object>> measures = maps(view.get("measures"));
            assertThat(measures).as(inYear + " · число мер").hasSize(2);
            checkMeasureInfo(inYear + " · мера 1", measures.get(0), first.spec());
            checkMeasureInfo(inYear + " · мера 2", measures.get(1), second.spec());

            checkTwoParts(inYear + " · общий итог", map(view.get("grand")), f1.grand, f2.grand, ytd, first, second);
            List<Map<String, Object>> lines1 = maps(view.get("lines"));
            Set<String> keys1 = union(f1.lines1.keySet(), f2.lines1.keySet());
            assertThat(lines1).as(inYear + " · число строк уровня 1").hasSize(keys1.size());
            for (Map<String, Object> line1 : lines1) {
                String key1 = (String) line1.get("key");
                String path1 = inYear + " · [" + key1 + "]";
                assertThat(keys1).as(path1 + " · нет в файлах").contains(key1);
                checkTwoParts(path1, line1, f1.lines1.get(key1), f2.lines1.get(key1), ytd, first, second);
                List<Map<String, Object>> lines2 = maps(line1.get("lines"));
                if (first.spec().level2() == null) {
                    assertThat(lines2).as(path1 + " · уровень 2 при одном уровне").isEmpty();
                    continue;
                }
                Map<String, Bucket> m1 = f1.lines2.getOrDefault(key1, new HashMap<>());
                Map<String, Bucket> m2 = f2.lines2.getOrDefault(key1, new HashMap<>());
                Set<String> keys2 = union(m1.keySet(), m2.keySet());
                assertThat(lines2).as(path1 + " · число строк уровня 2").hasSize(keys2.size());
                for (Map<String, Object> line2 : lines2) {
                    String key2 = (String) line2.get("key");
                    String path2 = inYear + " · [" + key1 + ", " + key2 + "]";
                    assertThat(keys2).as(path2 + " · нет в файлах").contains(key2);
                    checkTwoParts(path2, line2, m1.get(key2), m2.get(key2), ytd, first, second);
                }
            }

            checkUndated(inYear + " · без даты меры 1", view.get("undated"), first);
            checkUndated(inYear + " · без даты меры 2", view.get("undated2"), second);

            checkSecondMeasureCells(inYear, reportId, year, lines1, f2, ytd, second, loaded);
        }
    }

    private void checkSecondMeasureCells(String inYear, long reportId, Integer year, List<Map<String, Object>> lines1,
                                         Facts f2, int ytd, MeasureFacts second, List<Loaded> loaded) throws Exception {
        Loaded file = loaded.get(second.spec().source());
        Map<String, String> headers = headers(file.spec().cols());
        checkCellRows(inYear + " · мера 2 · общий итог · с начала года", reportId, year, Map.of("kind", "year"),
                List.of(), f2.grand.upTo(ytd), second, file, headers);

        Map<String, Object> line = lines1.stream()
                .filter(l -> {
                    Bucket bucket = f2.lines1.get((String) l.get("key"));
                    return bucket != null && bucket.firstMonthWithRows() > 0;
                })
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(inYear + " · нет строки уровня 1 со строками меры 2"));
        String key1 = (String) line.get("key");
        Bucket bucket = f2.lines1.get(key1);
        int month = bucket.firstMonthWithRows();
        checkCellRows(inYear + " · мера 2 · [" + key1 + "] · месяц " + month, reportId, year,
                Map.of("kind", "month", "month", month), Arrays.asList(key1), bucket.months[month - 1], second, file,
                headers);

        if (!second.spec().byMonths() && second.undated().count > 0) {
            checkCellRows(inYear + " · мера 2 · без даты", reportId, year, Map.of("kind", "undated"), List.of(),
                    second.undated(), second, file, headers);
        }
    }

    private static void checkMeasureInfo(String what, Map<String, Object> info, MeasureSpec spec) {
        assertThat(info.get("name")).as(what + " · название").isEqualTo(spec.name());
        assertThat(((Number) info.get("divisor")).intValue()).as(what + " · делитель").isEqualTo(spec.divisor());
        assertThat(((Number) info.get("decimals")).intValue()).as(what + " · знаки").isEqualTo(spec.decimals());
        assertThat(info.get("byMonthColumns")).as(what + " · колонки-месяцы").isEqualTo(spec.byMonths());
    }

    /** Линия отчёта из двух мер: мера 1 в полях линии, мера 2 в {@code m2}, отношение в {@code ratio}. */
    private static void checkTwoParts(String what, Map<String, Object> line, Bucket b1, Bucket b2, int ytd,
                                      MeasureFacts first, MeasureFacts second) {
        BigDecimal d1 = BigDecimal.valueOf(first.spec().divisor());
        BigDecimal d2 = BigDecimal.valueOf(second.spec().divisor());
        checkPart(what + " · мера 1", list(line.get("cells")), (String) line.get("total"),
                ((Number) line.get("count")).longValue(), b1, ytd, d1);

        Map<String, Object> m2 = map(line.get("m2"));
        if (b2 == null) {
            assertThat(m2).as(what + " · m2 при линии без меры 2").isNull();
        } else {
            assertThat(m2).as(what + " · m2").isNotNull();
            checkPart(what + " · мера 2", list(m2.get("cells")), (String) m2.get("total"),
                    ((Number) m2.get("count")).longValue(), b2, ytd, d2);
        }

        Map<String, Object> ratio = map(line.get("ratio"));
        assertThat(ratio).as(what + " · ratio").isNotNull();
        List<Object> cells = list(ratio.get("cells"));
        assertThat(cells).as(what + " · отношение · число месяцев").hasSize(MONTHS);
        for (int i = 0; i < MONTHS; i++) {
            assertRatio(what + " · отношение · месяц " + (i + 1), (String) cells.get(i),
                    b1 == null ? null : b1.months[i], b2 == null ? null : b2.months[i], d1, d2);
        }
        assertRatio(what + " · отношение · с начала года", (String) ratio.get("total"),
                b1 == null ? null : b1.upTo(ytd), b2 == null ? null : b2.upTo(ytd), d1, d2);
    }

    /** Часть линии одной меры: 12 месяцев, итог за месяцы 1…N и число строк за них; нет линии — всё пусто, число 0. */
    private static void checkPart(String what, List<Object> cells, String total, long count, Bucket bucket, int ytd,
                                  BigDecimal divisor) {
        assertThat(cells).as(what + " · число месяцев").hasSize(MONTHS);
        for (int i = 0; i < MONTHS; i++) {
            Agg month = bucket == null ? null : bucket.months[i];
            String cell = (String) cells.get(i);
            String where = what + " · месяц " + (i + 1);
            if (month == null || month.count == 0) {
                assertThat(cell).as(where + " · в файле строк нет").isNull();
            } else {
                assertValue(where, cell, month.sum, divisor);
            }
        }
        Agg ytdAgg = bucket == null ? new Agg() : bucket.upTo(ytd);
        if (ytdAgg.count == 0) {
            assertThat(total).as(what + " · с начала года · в файле строк нет").isNull();
        } else {
            assertValue(what + " · с начала года", total, ytdAgg.sum, divisor);
        }
        assertThat(count).as(what + " · число строк за месяцы 1…" + ytd).isEqualTo(ytdAgg.count);
    }

    private static void assertRatio(String what, String actual, Agg a1, Agg a2, BigDecimal d1, BigDecimal d2) {
        BigDecimal expected = ratio(a1, a2, d1, d2);
        if (expected == null) {
            assertThat(actual).as(what + " · ожидалось пусто").isNull();
            return;
        }
        assertThat(actual).as(what + " · ожидалось " + expected.toPlainString()).isNotNull();
        assertThat(new BigDecimal(actual).setScale(RATIO_SCALE, RoundingMode.HALF_UP).compareTo(expected))
                .as(what + " · ожидалось " + expected.toPlainString() + " / пришло " + actual)
                .isZero();
    }

    /** Отношение ячейки: (v1 / d1) / (v2 / d2) × 100, 6 знаков; v2 пусто или 0 → пусто; v1 пусто при v2 ≠ 0 → 0. */
    private static BigDecimal ratio(Agg a1, Agg a2, BigDecimal d1, BigDecimal d2) {
        if (a2 == null || a2.count == 0 || a2.sum.signum() == 0) {
            return null;
        }
        if (a1 == null || a1.count == 0) {
            return BigDecimal.ZERO.setScale(RATIO_SCALE, RoundingMode.HALF_UP);
        }
        return a1.sum.multiply(d2).multiply(HUNDRED).divide(d1.multiply(a2.sum), RATIO_SCALE, RoundingMode.HALF_UP);
    }

    private static void checkUndated(String what, Object actual, MeasureFacts facts) {
        Map<String, Object> undated = map(actual);
        if (facts.spec().byMonths()) {
            if (undated != null) {
                assertThat(((Number) undated.get("count")).longValue()).as(what + " · у колонок-месяцев").isZero();
            }
            return;
        }
        assertThat(undated).as(what).isNotNull();
        assertThat(((Number) undated.get("count")).longValue()).as(what + " · число строк")
                .isEqualTo(facts.undated().count);
        if (facts.undated().count > 0) {
            assertValue(what + " · значение", (String) undated.get("value"), facts.undated().sum,
                    BigDecimal.valueOf(facts.spec().divisor()));
        }
    }

    // ---------- сверка отчёта с одной мерой ----------

    private void checkOneMeasure(String what, long reportId, MeasureFacts first) throws Exception {
        List<Integer> expectedYears = first.spec().byMonths() ? List.of() : List.copyOf(first.years().keySet());
        Map<String, Object> latest = getJson(BASE + "/reports/" + reportId + "/view");
        assertThat(numbers(latest.get("years"))).as(what + " · годы").containsExactlyElementsOf(expectedYears);
        BigDecimal divisor = BigDecimal.valueOf(first.spec().divisor());

        for (Integer year : yearsToCheck(expectedYears)) {
            String inYear = what + " · " + (year == null ? "без года" : year);
            Map<String, Object> view = view(reportId, year);
            checkYear(inYear, view, year);
            Facts f1 = first.in(year);
            int ytd = ytdMonth(f1);
            assertThat(((Number) view.get("ytdMonth")).intValue()).as(inYear + " · ytdMonth").isEqualTo(ytd);
            assertThat(maps(view.get("measures"))).as(inYear + " · число мер").hasSize(1);
            checkMeasureInfo(inYear + " · мера 1", maps(view.get("measures")).getFirst(), first.spec());
            assertThat(view.get("undated2")).as(inYear + " · undated2 у одной меры").isNull();

            checkOnePart(inYear + " · общий итог", map(view.get("grand")), f1.grand, ytd, divisor);
            List<Map<String, Object>> lines1 = maps(view.get("lines"));
            assertThat(lines1).as(inYear + " · число строк уровня 1").hasSize(f1.lines1.size());
            for (Map<String, Object> line1 : lines1) {
                String key1 = (String) line1.get("key");
                String path1 = inYear + " · [" + key1 + "]";
                assertThat(f1.lines1).as(path1 + " · нет у меры 1").containsKey(key1);
                checkOnePart(path1, line1, f1.lines1.get(key1), ytd, divisor);
                List<Map<String, Object>> lines2 = maps(line1.get("lines"));
                if (first.spec().level2() == null) {
                    assertThat(lines2).as(path1 + " · уровень 2 при одном уровне").isEmpty();
                    continue;
                }
                Map<String, Bucket> expected2 = f1.lines2.get(key1);
                assertThat(lines2).as(path1 + " · число строк уровня 2").hasSize(expected2.size());
                for (Map<String, Object> line2 : lines2) {
                    String key2 = (String) line2.get("key");
                    String path2 = inYear + " · [" + key1 + ", " + key2 + "]";
                    assertThat(expected2).as(path2 + " · нет у меры 1").containsKey(key2);
                    checkOnePart(path2, line2, expected2.get(key2), ytd, divisor);
                }
            }
            checkUndated(inYear + " · без даты", view.get("undated"), first);
        }
    }

    private static void checkOnePart(String what, Map<String, Object> line, Bucket bucket, int ytd, BigDecimal divisor) {
        checkPart(what, list(line.get("cells")), (String) line.get("total"), ((Number) line.get("count")).longValue(),
                bucket, ytd, divisor);
        assertThat(line.get("m2")).as(what + " · m2 у одной меры").isNull();
        assertThat(line.get("ratio")).as(what + " · ratio у одной меры").isNull();
    }

    // ---------- общие проверки ----------

    private static List<Integer> expectedYears(MeasureFacts first, MeasureFacts second) {
        if (!first.spec().byMonths()) {
            return List.copyOf(first.years().keySet());
        }
        if (!second.spec().byMonths()) {
            return List.copyOf(second.years().keySet());
        }
        return List.of();
    }

    private static List<Integer> yearsToCheck(List<Integer> years) {
        return years.isEmpty() ? Collections.singletonList(null) : years;
    }

    private Map<String, Object> view(long reportId, Integer year) throws Exception {
        String url = BASE + "/reports/" + reportId + "/view";
        return getJson(year == null ? url : url + "?year=" + year);
    }

    private static void checkYear(String what, Map<String, Object> view, Integer year) {
        if (year == null) {
            assertThat(view.get("year")).as(what + " · год ответа").isNull();
        } else {
            assertThat(((Number) view.get("year")).intValue()).as(what + " · год ответа").isEqualTo(year);
        }
    }

    /** N — наибольший месяц, где у меры 1 есть строки; нет — 12. */
    private static int ytdMonth(Facts first) {
        int last = first.grand.lastMonthWithRows();
        return last == 0 ? MONTHS : last;
    }

    private static Set<String> union(Set<String> a, Set<String> b) {
        Set<String> all = new LinkedHashSet<>(a);
        all.addAll(b);
        return all;
    }

    private static void assertValue(String what, String actual, BigDecimal sumBeforeDivisor, BigDecimal divisor) {
        BigDecimal expected = sumBeforeDivisor.divide(divisor, SCALE, RoundingMode.HALF_UP);
        assertThat(actual).as(what + " · ожидалось " + expected.toPlainString()).isNotNull();
        BigDecimal value = new BigDecimal(actual);
        if (value.scale() > SCALE) {
            assertThat(value.subtract(expected).abs())
                    .as(what + " · ожидалось " + expected.toPlainString() + " / пришло " + actual)
                    .isLessThanOrEqualTo(TOLERANCE);
        } else {
            assertThat(value.compareTo(expected))
                    .as(what + " · ожидалось " + expected.toPlainString() + " / пришло " + actual)
                    .isZero();
        }
    }

    /**
     * «Откуда цифра» меры 2: все страницы ячейки; {@code value} и Σ {@code measure} строк = сумме до делителя, каждая строка —
     * принятая строка файла, дающая ячейку; у колонок-месяцев {@code column} — подпись колонки месяца, у меры по дате — пусто.
     */
    private void checkCellRows(String what, long reportId, Integer year, Map<String, Object> period, List<String> path,
                               Agg expected, MeasureFacts facts, Loaded file, Map<String, String> headers)
            throws Exception {
        boolean byMonths = facts.spec().byMonths();
        Set<String> monthHeaders = new HashSet<>();
        if (byMonths) {
            facts.spec().monthFields().stream().filter(f -> f != null).forEach(f -> monthHeaders.add(headers.get(f)));
        }
        Set<String> seen = new HashSet<>();
        BigDecimal sum = BigDecimal.ZERO;
        long total;
        int offset = 0;
        do {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("year", year);
            body.put("period", period);
            body.put("path", path);
            body.put("offset", offset);
            body.put("measure", 2);
            Map<String, Object> page = postJson(BASE + "/reports/" + reportId + "/cells", json(body));
            total = ((Number) page.get("total")).longValue();
            assertThat(new BigDecimal((String) page.get("value")).compareTo(expected.sum))
                    .as(what + " · value · ожидалось " + expected.sum.toPlainString() + " / пришло " + page.get("value"))
                    .isZero();
            List<Map<String, Object>> items = maps(page.get("items"));
            assertThat(items.isEmpty() && offset < total).as(what + " · пустая страница при offset " + offset).isFalse();
            for (Map<String, Object> item : items) {
                int excelRow = ((Number) item.get("excelRow")).intValue();
                String column = (String) item.get("column");
                String where = what + " · строка Excel " + excelRow + " · колонка " + column;
                assertThat(item.get("sheet")).as(where + " · лист").isEqualTo(file.spec().sheet());
                assertThat(file.rejected()).as(where + " · отклонённая строка").doesNotContain(excelRow);
                if (byMonths) {
                    assertThat(column).as(where + " · подпись колонки-месяца").isNotNull().isIn(monthHeaders);
                    assertThat(item.get("date")).as(where + " · дата у колонок-месяцев").isNull();
                } else {
                    assertThat(column).as(where + " · колонка у меры по дате").isNull();
                }
                String key = pair(excelRow, byMonths ? column : NO_COLUMN);
                assertThat(expected.pairs).as(where + " · не даёт эту ячейку").contains(key);
                assertThat(seen.add(key)).as(where + " · повторилась").isTrue();
                if (item.get("measure") != null) {
                    sum = sum.add(new BigDecimal((String) item.get("measure")));
                }
            }
            offset += PAGE_SIZE;
        } while (offset < total);
        assertThat(total).as(what + " · число строк ячейки").isEqualTo(expected.count);
        assertThat(seen).as(what + " · строки ячейки").hasSize((int) expected.count);
        assertThat(sum.compareTo(expected.sum))
                .as(what + " · Σ меры строк · ожидалось " + expected.sum.toPlainString() + " / пришло " + sum.toPlainString())
                .isZero();
    }

    private static String pair(int excelRow, String column) {
        return excelRow + "|" + column;
    }

    // ---------- ожидаемое по байтам xlsx ----------

    /** Ожидаемое меры по её файлам; отклонённые загрузкой строки источника и справочника не входят ни в какие цифры. */
    private static MeasureFacts expected(MeasureSpec spec, List<Loaded> loaded) {
        Loaded source = loaded.get(spec.source());
        Map<List<String>, FileRow> refByKey = new HashMap<>();
        if (spec.ref() != null) {
            Loaded ref = loaded.get(spec.ref());
            for (FileRow refRow : readSheet(ref.content(), ref.spec().sheet(), ref.spec().cols())) {
                if (ref.rejected().contains(refRow.excelRow())) {
                    continue;
                }
                List<String> key = spec.keys().stream().map(k -> keyOf(refRow.values().get(k.refField()))).toList();
                refByKey.putIfAbsent(key, refRow);
            }
        }
        Map<String, String> headers = headers(source.spec().cols());
        boolean twoLevels = spec.level2() != null;
        TreeMap<Integer, Facts> years = new TreeMap<>();
        Facts noYear = new Facts();
        Agg undated = new Agg();
        for (FileRow row : readSheet(source.content(), source.spec().sheet(), source.spec().cols())) {
            if (source.rejected().contains(row.excelRow())) {
                continue;
            }
            FileRow refRow = null;
            if (spec.ref() != null) {
                List<String> key = spec.keys().stream().map(k -> keyOf(row.values().get(k.field()))).toList();
                refRow = refByKey.get(key);
            }
            String group1 = groupOf(levelValue(spec.level1(), row, refRow));
            String group2 = twoLevels ? groupOf(levelValue(spec.level2(), row, refRow)) : null;
            if (spec.byMonths()) {
                for (int m = 1; m <= MONTHS; m++) {
                    String field = spec.monthFields().get(m - 1);
                    if (field == null) {
                        continue;
                    }
                    BigDecimal value = measureOf(row.values().get(field));
                    if (value != null) {
                        noYear.add(group1, group2, twoLevels, m, value, row.excelRow(), headers.get(field));
                    }
                }
                continue;
            }
            BigDecimal measure = measureOf(row.values().get(spec.measureField()));
            LocalDate date = dateOf(row.values().get(spec.dateField()));
            if (date == null) {
                undated.add(measure, row.excelRow(), NO_COLUMN);
                continue;
            }
            years.computeIfAbsent(date.getYear(), y -> new Facts())
                    .add(group1, group2, twoLevels, date.getMonthValue(), measure, row.excelRow(), NO_COLUMN);
        }
        return new MeasureFacts(spec, years, noYear, undated, source.spec().sheet());
    }

    private static Map<String, String> headers(List<Col> cols) {
        Map<String, String> headers = new HashMap<>();
        cols.forEach(c -> headers.put(c.field(), c.header()));
        return headers;
    }

    private static Object levelValue(Level level, FileRow row, FileRow refRow) {
        if (ORIGIN_SOURCE.equals(level.origin())) {
            return row.values().get(level.field());
        }
        return refRow == null ? null : refRow.values().get(level.field());
    }

    private static List<FileRow> readSheet(byte[] content, String sheetName, List<Col> cols) {
        try (ReadableWorkbook book = new ReadableWorkbook(new ByteArrayInputStream(content))) {
            List<Row> rows = book.findSheet(sheetName)
                    .orElseThrow(() -> new IllegalStateException("В файле нет листа: " + sheetName))
                    .read();
            List<FileRow> result = new ArrayList<>();
            for (Row row : rows) {
                if (row.getRowNum() <= 1 || isBlank(row)) {
                    continue;
                }
                Map<String, Object> values = new HashMap<>();
                for (int i = 0; i < cols.size(); i++) {
                    values.put(cols.get(i).field(), cellValue(row, i));
                }
                result.add(new FileRow(row.getRowNum(), values));
            }
            return result;
        } catch (IOException failure) {
            throw new UncheckedIOException("Не удалось прочитать собранный xlsx", failure);
        }
    }

    private static boolean isBlank(Row row) {
        for (int i = 0; i < row.getCellCount(); i++) {
            Optional<Cell> cell = row.getOptionalCell(i);
            if (cell.isPresent() && cell.get().getType() != CellType.EMPTY && !cell.get().getText().isBlank()) {
                return false;
            }
        }
        return true;
    }

    private static Object cellValue(Row row, int index) {
        Optional<Cell> found = row.getOptionalCell(index);
        if (found.isEmpty() || found.get().getType() == CellType.EMPTY || found.get().getText().isBlank()) {
            return null;
        }
        Cell cell = found.get();
        return switch (cell.getType()) {
            case NUMBER -> cell.asNumber();
            case STRING -> cell.getText();
            default -> throw new IllegalStateException("Неожиданный тип ячейки в строке " + row.getRowNum()
                    + ", колонка " + index + ": " + cell.getType());
        };
    }

    /** Ключ связи: пусто = пусто, число — по значению, текст — без пробелов по краям и без учёта регистра. */
    private static String keyOf(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof BigDecimal number) {
            return number.stripTrailingZeros().toPlainString();
        }
        return ((String) value).strip().toLowerCase(Locale.ROOT);
    }

    /** Группа уровня: нормализованное название, пустое — {@code null} («Без названия»). */
    private static String groupOf(Object value) {
        if (value == null) {
            return null;
        }
        String text = value instanceof BigDecimal number ? number.toPlainString() : (String) value;
        String group = text.strip().toLowerCase(Locale.ROOT);
        return group.isEmpty() ? null : group;
    }

    private static LocalDate dateOf(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text)) {
            throw new IllegalStateException("Дата в файле сферы ожидается текстом: " + value);
        }
        try {
            return LocalDate.parse(text.strip(), FILE_DATE);
        } catch (DateTimeParseException notDate) {
            return null;
        }
    }

    private static BigDecimal measureOf(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal number) {
            return number.stripTrailingZeros();
        }
        try {
            return new BigDecimal(((String) value).strip()).stripTrailingZeros();
        } catch (NumberFormatException notNumber) {
            return null;
        }
    }

    // ---------- анкеты, файлы, отчёт ----------

    private long publish(String codePrefix, String sheetName, List<Col> cols) {
        SourceData data = new SourceData(codePrefix + rnd(), "TEST анкета " + rnd(), "TEST org", null,
                Periodicity.MONTH, 5, null, null);
        long sourceId = sources.createSource(data, userId).source().id();
        List<Column> columns = new ArrayList<>();
        for (int i = 0; i < cols.size(); i++) {
            Col col = cols.get(i);
            columns.add(col.type() == DataType.OBJECT_KEY
                    ? new Column(null, 0, i + 1, col.header(), col.field(), col.type(), true,
                            null, null, KEY_MASK, 9, 1, null)
                    : new Column(null, 0, i + 1, col.header(), col.field(), col.type(), false,
                            null, null, null, null, null, null));
        }
        Sheet sheet = new Sheet(null, 0, sheetName, 1, null, List.copyOf(columns));
        int version = sources.createDraft(sourceId, null, userId).version();
        int lockVersion = sources.getVersion(sourceId, version).lockVersion();
        sources.replaceDraft(sourceId, version, lockVersion, new DraftData(null, null, null, null, List.of(sheet)), userId);
        sources.publish(sourceId, version, VALID_FROM, userId);
        return sourceId;
    }

    /** Загружает и применяет файл; возвращает номера строк Excel листа, которые загрузка отклонила. */
    private Set<Integer> apply(long sourceId, byte[] content, String sheetName) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, PACKAGE_FROM, PACKAGE_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        PackageRow parsed = packages.get(row.publicId().toString());
        assertThat(parsed.status()).as("проверка тестового файла").isEqualTo(UplPackageModel.VERIFIED);
        PackageRow applied = applies.apply(parsed.publicId().toString(), userId);
        assertThat(applied.status()).as("применение тестового файла").isEqualTo(UplPackageModel.APPLIED);
        Set<Integer> rejected = new HashSet<>(tx.execute(status -> {
            actors.apply(actors.system());
            return jdbc.sql("select distinct row_no from upl_package_errors"
                            + " where package_id = :packageId and sheet = :sheet and row_no is not null")
                    .param("packageId", applied.id())
                    .param("sheet", sheetName)
                    .query(Integer.class).list();
        }));
        assertThat(rejected.size()).as("отклонённые строки по ошибкам = счётчику пакета")
                .isEqualTo(applied.rowsRejected() == null ? 0 : applied.rowsRejected());
        return rejected;
    }

    private static byte[] workbook(FileSpec file) {
        List<String> header = file.cols().stream().map(Col::header).toList();
        return UplXlsxFixtures.workbook(new SheetSpec(file.sheet(), 1, header, file.rows()));
    }

    private int sheetOrdinal(long sourceId, String sheetName) throws Exception {
        Map<String, Object> layout = getJson(BASE + "/sources/" + sourceId + "/layout");
        for (Map<String, Object> sheet : maps(layout.get("sheets"))) {
            if (sheetName.equals(sheet.get("name"))) {
                return ((Number) sheet.get("ordinal")).intValue();
            }
        }
        throw new IllegalStateException("В раскладке источника нет листа: " + sheetName);
    }

    /** Описывает отчёт: мера 1 — поля описания, мера 2 — {@code second} ({@code null} — отчёт с одной мерой). */
    private long createReport(String name, MeasureSpec first, MeasureSpec second, List<Loaded> loaded) throws Exception {
        Map<String, Object> body = measureBody(first, loaded);
        body.put("name", name);
        body.put("measureName", first.name());
        if (second != null) {
            body.put("second", measureBody(second, loaded));
        }
        MockHttpServletResponse response = send(post(BASE + "/reports").contentType("application/json")
                .content(json(body)));
        String content = response.getContentAsString(StandardCharsets.UTF_8);
        assertThat(response.getStatus()).as(content).isEqualTo(201);
        return ((Number) JsonPath.read(content, "$.id")).longValue();
    }

    private static Map<String, Object> measureBody(MeasureSpec spec, List<Loaded> loaded) {
        Loaded source = loaded.get(spec.source());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", spec.name());
        body.put("sourceId", source.sourceId());
        body.put("sourceSheet", source.ordinal());
        body.put("dateField", spec.dateField());
        body.put("monthFields", spec.monthFields());
        if (spec.byMonths()) {
            body.put("measure", null);
        } else {
            Map<String, Object> measure = new LinkedHashMap<>();
            measure.put("kind", MEASURE_TOTAL);
            measure.put("field", spec.measureField());
            body.put("measure", measure);
        }
        body.put("divisor", spec.divisor());
        body.put("decimals", spec.decimals());
        if (spec.ref() == null) {
            body.put("ref", null);
        } else {
            Loaded ref = loaded.get(spec.ref());
            body.put("ref", Map.of("sourceId", ref.sourceId(), "sheet", ref.ordinal(), "keys",
                    spec.keys().stream().map(k -> Map.of("field", k.field(), "refField", k.refField())).toList()));
        }
        body.put("level1", level(spec.level1()));
        body.put("level2", spec.level2() == null ? null : level(spec.level2()));
        return body;
    }

    private static Map<String, Object> level(Level level) {
        return Map.of("origin", level.origin(), "field", level.field());
    }

    // ---------- сферы ----------

    /**
     * Сфера А: мера 1 — сумма по дате источника 1 (в 2026 только январь–июнь), мера 2 — 12 колонок-месяцев источника 2;
     * обе меры — через один справочник, ключ-текст в файлах в другом регистре и с пробелами по краям.
     */
    private static Sphere sphereMonthColumnsOtherSource() {
        List<Col> source1 = List.of(keyCol(), new Col("Дата TEST", "dt", DataType.DATE),
                new Col("Код TEST", "kod", DataType.TEXT), new Col("Сумма TEST", "summa", DataType.NUMBER));
        List<Col> source2 = new ArrayList<>(List.of(keyCol(), new Col("Код TEST", "kod", DataType.TEXT)));
        source2.addAll(monthCols("TEST м", "ma"));
        List<Col> ref = List.of(keyCol(), new Col("Код TEST", "kod", DataType.TEXT),
                new Col("Группа TEST", "gr", DataType.TEXT), new Col("Подгруппа TEST", "pgr", DataType.TEXT));

        String[][] refData = {
                {"TEST K1 ", "TEST группа 1", "TEST подгруппа 1"},
                {"TEST K2", "TEST группа 1", "TEST подгруппа 2"},
                {"TEST K3", "TEST группа 2", "TEST подгруппа 1"},
                {"TEST K4", "TEST группа 3", "TEST подгруппа 3"},
                {"TEST K5", "TEST группа 4", "TEST подгруппа 4"},
                {"test k2", "TEST группа 9", "TEST подгруппа 9"},
                {"TEST K6", " test группа 2", "TEST подгруппа 5"}};
        List<List<Object>> refRows = new ArrayList<>();
        for (String[] data : refData) {
            refRows.add(Arrays.asList(objectKey(300 + refRows.size()), data[0], data[1], data[2]));
        }
        for (int i = 10; refRows.size() < 30; i++) {
            refRows.add(Arrays.asList(objectKey(300 + refRows.size()), "TEST K" + i, "TEST группа " + i,
                    "TEST подгруппа " + i));
        }

        String[] codes1 = {"test k1", " TEST K2 ", "TEST K3", "TEST K5", "Test K6"};
        List<List<Object>> rows1 = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            String date;
            if (i == 13) {
                date = null;
            } else if (i % 2 == 0) {
                date = fileDate(i % 28 + 1, i / 2 % MONTHS + 1, 2025);
            } else {
                date = fileDate(i % 28 + 1, i / 2 % 6 + 1, 2026);
            }
            double amount = i * 1373 % 90000 / 100.0 + 0.25;
            rows1.add(Arrays.asList(objectKey(i), date, codes1[i % codes1.length], amount));
        }

        String[] codes2 = {"test k1", "TEST K2", "test k3 ", "TEST K4", "TEST K8", "test k6"};
        List<List<Object>> rows2 = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            List<Object> row = new ArrayList<>();
            row.add(objectKey(200 + i));
            row.add(codes2[i % codes2.length]);
            for (int m = 1; m <= MONTHS; m++) {
                row.add((i + m) % 4 == 0 ? null : (double) ((i * 31 + m * 7) % 500) + (m % 2 == 0 ? 0.5 : 0));
            }
            rows2.add(row);
        }

        List<KeyPair> keys = List.of(new KeyPair("kod", "kod"));
        Level level1 = new Level(ORIGIN_REF, "gr");
        Level level2 = new Level(ORIGIN_REF, "pgr");
        MeasureSpec first = new MeasureSpec("TEST мера по дате", 0, "dt", "summa", null, 1000, 1, 2, keys,
                level1, level2);
        MeasureSpec second = new MeasureSpec("TEST мера колонками", 1, null, null, monthFields("ma", MONTHS), 1, 0, 2,
                keys, level1, level2);
        return new Sphere("TEST сфера А — мера 2 колонками-месяцами другого источника, ключ-текст в другом регистре",
                List.of(new FileSpec("TEST источник 1", source1, rows1, Set.of()),
                        new FileSpec("TEST источник 2", List.copyOf(source2), rows2, Set.of()),
                        new FileSpec("TEST справочник", ref, refRows, Set.of())),
                first, second);
    }

    /**
     * Сфера Б: обе меры — колонки-месяцы одного источника (мера 1 — «а» месяцев 1–5, мера 2 — все «б»), один уровень,
     * первая строка данных — итог под шапкой, анкета её отклоняет; у вида D все «б» = 0.
     */
    private static Sphere sphereBothMonthColumns() {
        List<Col> cols = new ArrayList<>(List.of(keyCol(), new Col("Вид TEST", "vid", DataType.TEXT)));
        cols.addAll(monthCols("TEST а", "pa"));
        cols.addAll(monthCols("TEST б", "pb"));

        List<List<Object>> data = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            char kind = "ABCD".charAt(i % 4);
            List<Object> row = new ArrayList<>();
            row.add(900000001 + i);
            row.add("TEST вид " + kind);
            for (int m = 1; m <= MONTHS; m++) {
                row.add((i + m) % 5 == 0 ? null : (double) ((i * 13 + m * 29) % 700) + 0.25);
            }
            for (int m = 1; m <= MONTHS; m++) {
                Object b;
                if (kind == 'D') {
                    b = 0;
                } else {
                    b = (i + m) % 3 == 0 ? null : (i * 17 + m * 11) % 300;
                }
                row.add(b);
            }
            data.add(row);
        }
        List<Object> totalRow = new ArrayList<>();
        totalRow.add("TEST итого");
        totalRow.add(null);
        for (int c = 2; c < cols.size(); c++) {
            double sum = 0;
            for (List<Object> row : data) {
                if (row.get(c) != null) {
                    sum += ((Number) row.get(c)).doubleValue();
                }
            }
            totalRow.add(sum);
        }
        List<List<Object>> rows = new ArrayList<>();
        rows.add(totalRow);
        rows.addAll(data);

        List<String> first5 = new ArrayList<>(monthFields("pa", 5));
        while (first5.size() < MONTHS) {
            first5.add(null);
        }
        Level level1 = new Level(ORIGIN_SOURCE, "vid");
        MeasureSpec first = new MeasureSpec("TEST мера а", 0, null, null, Collections.unmodifiableList(first5), 1000, 2,
                null, List.of(), level1, null);
        MeasureSpec second = new MeasureSpec("TEST мера б", 0, null, null, monthFields("pb", MONTHS), 1, 0, null,
                List.of(), level1, null);
        return new Sphere("TEST сфера Б — обе меры колонками-месяцами одного источника, итог под шапкой",
                List.of(new FileSpec("TEST источник", List.copyOf(cols), rows, Set.of(2))), first, second);
    }

    /**
     * Сфера В: обе меры — по дате своих источников, без справочника; у меры 2 нули, направление без пары у меры 1,
     * строки без даты и с датой 31.02.2026; в 2026 у меры 1 только январь–сентябрь.
     */
    private static Sphere sphereBothByDate() {
        List<Col> cols = List.of(keyCol(), new Col("Направление TEST", "napr", DataType.TEXT),
                new Col("Дата TEST", "dt", DataType.DATE), new Col("Стоимость TEST", "stoim", DataType.NUMBER));

        List<List<Object>> rows1 = new ArrayList<>();
        for (int i = 0; i < 45; i++) {
            String direction = i % 9 == 4 ? null : "TEST направление " + (i % 3 + 1);
            String date;
            if (i == 5) {
                date = null;
            } else if (i % 2 == 0) {
                date = fileDate(i % 28 + 1, i * 7 % MONTHS + 1, 2025);
            } else {
                date = fileDate(i % 28 + 1, i * 7 % 9 + 1, 2026);
            }
            double cost = i * 12345 % 900000 + 0.5;
            rows1.add(Arrays.asList(objectKey(i), direction, date, cost));
        }

        List<List<Object>> rows2 = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            String direction = "TEST направление " + (i % 4 + 1);
            String date = switch (i) {
                case 3 -> null;
                case 17 -> "31.02.2026";
                default -> fileDate(i % 28 + 1, i * 5 % MONTHS + 1, i % 3 == 0 ? 2025 : 2026);
            };
            double cost = i % 5 == 0 ? 0 : i * 777 % 50000 + 0.25;
            rows2.add(Arrays.asList(objectKey(100 + i), direction, date, cost));
        }

        Level level1 = new Level(ORIGIN_SOURCE, "napr");
        MeasureSpec first = new MeasureSpec("TEST мера 1 по дате", 0, "dt", "stoim", null, 1000000, 3, null, List.of(),
                level1, null);
        MeasureSpec second = new MeasureSpec("TEST мера 2 по дате", 1, "dt", "stoim", null, 1000, 1, null, List.of(),
                level1, null);
        return new Sphere("TEST сфера В — мера 2 по дате другого источника, нули и строка без пары",
                List.of(new FileSpec("TEST источник 1", cols, rows1, Set.of()),
                        new FileSpec("TEST источник 2", cols, rows2, Set.of())),
                first, second);
    }

    private static List<Col> monthCols(String headerPrefix, String fieldPrefix) {
        List<Col> cols = new ArrayList<>();
        for (int m = 1; m <= MONTHS; m++) {
            cols.add(new Col(headerPrefix + m, fieldPrefix + m, DataType.NUMBER));
        }
        return cols;
    }

    private static List<String> monthFields(String fieldPrefix, int count) {
        List<String> fields = new ArrayList<>();
        for (int m = 1; m <= count; m++) {
            fields.add(fieldPrefix + m);
        }
        return List.copyOf(fields);
    }

    private static Col keyCol() {
        return new Col(KEY_HEADER, KEY_FIELD, DataType.OBJECT_KEY);
    }

    private static String objectKey(int index) {
        return String.format("9%08d", index + 1);
    }

    private static String fileDate(int day, int month, int year) {
        return String.format("%02d.%02d.%04d", day, month, year);
    }

    // ---------- HTTP ----------

    private Map<String, Object> getJson(String url) throws Exception {
        MockHttpServletResponse response = send(get(url));
        String content = response.getContentAsString(StandardCharsets.UTF_8);
        assertThat(response.getStatus()).as(url + " · " + content).isEqualTo(200);
        return JsonPath.read(content, "$");
    }

    private Map<String, Object> postJson(String url, String body) throws Exception {
        MockHttpServletResponse response = send(post(url).contentType("application/json").content(body));
        String content = response.getContentAsString(StandardCharsets.UTF_8);
        assertThat(response.getStatus()).as(url + " · " + body + " · " + content).isEqualTo(200);
        return JsonPath.read(content, "$");
    }

    private MockHttpServletResponse send(AbstractMockHttpServletRequestBuilder<?> request) throws Exception {
        request.cookie(admin.session(), admin.csrf());
        request.header("X-XSRF-TOKEN", admin.csrf().getValue());
        return mvc.perform(request).andReturn().getResponse();
    }

    private Session login(String login) throws Exception {
        var response = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                        .content(json(Map.of("login", login, "password", PASSWORD, "deviceInfo", "test"))))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        Cookie session = response.getCookie(KauthPref.SESSION_COOKIE_NAME);
        assertThat(session).as("session cookie").isNotNull();
        Cookie csrf = response.getCookie("XSRF-TOKEN");
        if (csrf == null) {
            var handshake = mvc.perform(get("/api/v1/auth/me").cookie(session)).andReturn().getResponse();
            assertThat(handshake.getStatus()).isEqualTo(200);
            csrf = handshake.getCookie("XSRF-TOKEN");
        }
        assertThat(csrf).as("XSRF-TOKEN cookie").isNotNull();
        return new Session(session, csrf);
    }

    private Long roleId(String role) {
        return jdbc.sql("select id from md_roles where pcode = :role").param("role", role)
                .query(Long.class).single();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) {
        return (List<Map<String, Object>>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object value) {
        return (List<Object>) value;
    }

    private static List<Integer> numbers(Object value) {
        return list(value).stream().map(v -> ((Number) v).intValue()).toList();
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }

    private static String rnd() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
