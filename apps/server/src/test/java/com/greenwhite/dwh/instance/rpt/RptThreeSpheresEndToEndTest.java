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
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Сквозная проверка сводного отчёта на трёх выдуманных сферах разного строения (AC-8, контракт И15а разделы 2–3):
 * файлы загружаются и применяются, отчёт описывается запросом, и каждая ячейка расчёта и строки каждой проверенной
 * ячейки сверяются со значениями, которые тест сам считает по байтам xlsx, не вызывая классов расчёта.
 * Значения — только TEST и числа.
 */
class RptThreeSpheresEndToEndTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/rpt";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String SOURCE_SHEET = "TEST источник";
    private static final String REF_SHEET = "TEST справочник";
    private static final String KEY_HEADER = "Ключ TEST";
    private static final String KEY_FIELD = "okey";
    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final LocalDate VALID_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate PACKAGE_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate PACKAGE_TO = LocalDate.of(2026, 1, 31);
    private static final int PAGE_SIZE = 200;
    private static final int MONTHS = 12;
    private static final int SCALE = 10;
    private static final BigDecimal TOLERANCE = new BigDecimal("0.000001");
    private static final Pattern NUMBER_TEXT = Pattern.compile("-?[0-9]+(\\.[0-9]+)?");
    private static final DateTimeFormatter FILE_DATE =
            DateTimeFormatter.ofPattern("dd.MM.uuuu").withResolverStyle(ResolverStyle.STRICT);
    private static final String ORIGIN_SOURCE = "source";
    private static final String ORIGIN_REF = "ref";
    private static final String MEASURE_TOTAL = "total";
    private static final String MEASURE_COUNT = "count";

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

    /** Колонка анкеты и файла: шапка, поле, тип. Позиция — место в списке, ключ объекта — всегда первая. */
    private record Col(String header, String field, DataType type) {
    }

    /** Уровень отчёта: откуда поле и какое. */
    private record Level(String origin, String field) {
    }

    /** Пара ключа связи: поле источника и поле справочника. */
    private record KeyPair(String field, String refField) {
    }

    /** Описание отчёта сферы. */
    private record ReportSpec(String name, String measureKind, String measureField, int divisor, int decimals,
                              List<KeyPair> keys, Level level1, Level level2) {
    }

    /** Сфера: колонки и строки источника, справочника (или {@code null}) и отчёты по ним. */
    private record Sphere(String name, List<Col> sourceCols, List<List<Object>> sourceRows,
                          List<Col> refCols, List<List<Object>> refRows, List<ReportSpec> reports) {
        @Override
        public String toString() {
            return name;
        }
    }

    /** Строка файла: номер строки Excel и значения по полям (текст, число или {@code null}). */
    private record FileRow(int excelRow, Map<String, Object> values) {
    }

    /** Ячейка ожидаемого: сумма меры до делителя, число строк и номера строк Excel. */
    private static final class Agg {
        private BigDecimal sum = BigDecimal.ZERO;
        private long count;
        private final Set<Integer> rows = new HashSet<>();

        void add(BigDecimal measure, int excelRow) {
            if (measure != null) {
                sum = sum.add(measure);
            }
            count++;
            rows.add(excelRow);
        }
    }

    /** Линия ожидаемого: двенадцать месяцев и «Итого». */
    private static final class Bucket {
        private final Agg[] months = new Agg[MONTHS];
        private final Agg year = new Agg();

        Bucket() {
            for (int i = 0; i < MONTHS; i++) {
                months[i] = new Agg();
            }
        }

        void add(int month, BigDecimal measure, int excelRow) {
            months[month - 1].add(measure, excelRow);
            year.add(measure, excelRow);
        }

        int firstMonthWithRows() {
            for (int i = 0; i < MONTHS; i++) {
                if (months[i].count > 0) {
                    return i + 1;
                }
            }
            throw new IllegalStateException("В линии ожидаемого нет ни одного месяца со строками");
        }
    }

    /** Ожидаемое за один год: общий итог, линии уровня 1 и уровня 2 по нормализованному названию. */
    private static final class YearFacts {
        private final Bucket grand = new Bucket();
        private final Map<String, Bucket> lines1 = new HashMap<>();
        private final Map<String, Map<String, Bucket>> lines2 = new HashMap<>();
    }

    private record Expected(TreeMap<Integer, YearFacts> years, Agg undated) {
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

        String login = "rpt-e2e-" + rnd();
        users.createUser("TEST " + login, login, login + "@test.local", null, PASSWORD, null, "ru", "UTC", null,
                Map.of(), false, false, List.of(roleId("admin")), userId);
        admin = login(login);
    }

    static Stream<Sphere> spheres() {
        return Stream.of(sphereTwoColumnKey(), sphereOneColumnKey(), sphereWithoutRef());
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("spheres")
    @DisplayName("AC-8: три сферы одной программой — каждая ячейка отчёта = сумме по самому xlsx")
    void everyCellMatchesFile(Sphere sphere) throws Exception {
        byte[] sourceFile = workbook(SOURCE_SHEET, sphere.sourceCols(), sphere.sourceRows());
        long sourceId = publish("test.rpt.e2e.src.", SOURCE_SHEET, sphere.sourceCols());
        Set<Integer> sourceRejected = apply(sourceId, sourceFile, SOURCE_SHEET);
        int sourceOrdinal = sheetOrdinal(sourceId, SOURCE_SHEET);

        byte[] refFile = null;
        Long refId = null;
        Integer refOrdinal = null;
        Set<Integer> refRejected = Set.of();
        if (sphere.refCols() != null) {
            refFile = workbook(REF_SHEET, sphere.refCols(), sphere.refRows());
            refId = publish("test.rpt.e2e.ref.", REF_SHEET, sphere.refCols());
            refRejected = apply(refId, refFile, REF_SHEET);
            refOrdinal = sheetOrdinal(refId, REF_SHEET);
        }

        for (ReportSpec report : sphere.reports()) {
            long reportId = createReport(report, sourceId, sourceOrdinal, refId, refOrdinal);
            Expected expected = expected(sphere, report, sourceFile, refFile, sourceRejected, refRejected);
            checkView(sphere.name() + " · " + report.name(), report, reportId, expected);
        }
    }

    // ---------- сверка расчёта ----------

    private void checkView(String what, ReportSpec report, long reportId, Expected expected) throws Exception {
        Map<String, Object> latest = getJson(BASE + "/reports/" + reportId + "/view");
        List<Integer> years = numbers(latest.get("years"));
        assertThat(years).as(what + " · годы").containsExactlyElementsOf(expected.years().keySet());
        BigDecimal divisor = BigDecimal.valueOf(report.divisor());
        boolean count = MEASURE_COUNT.equals(report.measureKind());

        for (Map.Entry<Integer, YearFacts> entry : expected.years().entrySet()) {
            int year = entry.getKey();
            YearFacts facts = entry.getValue();
            String inYear = what + " · " + year;
            Map<String, Object> view = getJson(BASE + "/reports/" + reportId + "/view?year=" + year);
            assertThat(((Number) view.get("year")).intValue()).as(inYear + " · год ответа").isEqualTo(year);

            checkLine(inYear + " · общий итог", map(view.get("grand")), facts.grand, divisor);
            List<Map<String, Object>> lines1 = maps(view.get("lines"));
            assertThat(lines1).as(inYear + " · число строк уровня 1").hasSize(facts.lines1.size());
            for (Map<String, Object> line1 : lines1) {
                String key1 = (String) line1.get("key");
                String path1 = inYear + " · [" + key1 + "]";
                assertThat(facts.lines1).as(path1 + " · нет в файле").containsKey(key1);
                checkLine(path1, line1, facts.lines1.get(key1), divisor);
                List<Map<String, Object>> lines2 = maps(line1.get("lines"));
                if (report.level2() == null) {
                    assertThat(lines2).as(path1 + " · уровень 2 при одном уровне").isEmpty();
                    continue;
                }
                Map<String, Bucket> expected2 = facts.lines2.get(key1);
                assertThat(lines2).as(path1 + " · число строк уровня 2").hasSize(expected2.size());
                for (Map<String, Object> line2 : lines2) {
                    String key2 = (String) line2.get("key");
                    String path2 = inYear + " · [" + key1 + ", " + key2 + "]";
                    assertThat(expected2).as(path2 + " · нет в файле").containsKey(key2);
                    checkLine(path2, line2, expected2.get(key2), divisor);
                }
            }

            Map<String, Object> undated = map(view.get("undated"));
            assertThat(undated).as(inYear + " · без даты").isNotNull();
            assertThat(((Number) undated.get("count")).longValue()).as(inYear + " · без даты · число строк")
                    .isEqualTo(expected.undated().count);
            assertValue(inYear + " · без даты · значение", (String) undated.get("value"),
                    expected.undated().sum, divisor);

            checkCellRows(inYear + " · общий итог · год", reportId, year, Map.of("kind", "year"), List.of(),
                    facts.grand.year, count);
            Map<String, Object> firstLine1 = lines1.getFirst();
            String key1 = (String) firstLine1.get("key");
            Bucket bucket1 = facts.lines1.get(key1);
            int month = bucket1.firstMonthWithRows();
            checkCellRows(inYear + " · [" + key1 + "] · месяц " + month, reportId, year,
                    Map.of("kind", "month", "month", month), Arrays.asList(key1), bucket1.months[month - 1], count);
            if (report.level2() != null) {
                String key2 = (String) maps(firstLine1.get("lines")).getFirst().get("key");
                checkCellRows(inYear + " · [" + key1 + ", " + key2 + "] · Итого", reportId, year,
                        Map.of("kind", "year"), Arrays.asList(key1, key2),
                        facts.lines2.get(key1).get(key2).year, count);
            }
            if (expected.undated().count > 0) {
                checkCellRows(inYear + " · без даты", reportId, year, Map.of("kind", "undated"), List.of(),
                        expected.undated(), count);
            }
        }
    }

    private static void checkLine(String what, Map<String, Object> line, Bucket bucket, BigDecimal divisor) {
        List<Object> cells = list(line.get("cells"));
        assertThat(cells).as(what + " · число месяцев").hasSize(MONTHS);
        for (int i = 0; i < MONTHS; i++) {
            Agg month = bucket.months[i];
            String cell = (String) cells.get(i);
            String where = what + " · месяц " + (i + 1);
            if (month.count == 0) {
                assertThat(cell).as(where + " · в файле строк нет").isNull();
            } else {
                assertValue(where, cell, month.sum, divisor);
            }
        }
        assertValue(what + " · Итого", (String) line.get("total"), bucket.year.sum, divisor);
        assertThat(((Number) line.get("count")).longValue()).as(what + " · число строк").isEqualTo(bucket.year.count);
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

    private void checkCellRows(String what, long reportId, int year, Map<String, Object> period, List<String> path,
                               Agg expected, boolean count) throws Exception {
        Set<Integer> seen = new HashSet<>();
        BigDecimal sum = BigDecimal.ZERO;
        long total;
        int offset = 0;
        do {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("year", year);
            body.put("period", period);
            body.put("path", path);
            body.put("offset", offset);
            Map<String, Object> page = postJson(BASE + "/reports/" + reportId + "/cells", json(body));
            total = ((Number) page.get("total")).longValue();
            assertThat(new BigDecimal((String) page.get("value")).compareTo(expected.sum))
                    .as(what + " · value · ожидалось " + expected.sum.toPlainString() + " / пришло " + page.get("value"))
                    .isZero();
            List<Map<String, Object>> items = maps(page.get("items"));
            assertThat(items.isEmpty() && offset < total).as(what + " · пустая страница при offset " + offset).isFalse();
            for (Map<String, Object> item : items) {
                int excelRow = ((Number) item.get("excelRow")).intValue();
                assertThat(item.get("sheet")).as(what + " · лист строки " + excelRow).isEqualTo(SOURCE_SHEET);
                assertThat(expected.rows).as(what + " · строка Excel " + excelRow + " не даёт эту ячейку")
                        .contains(excelRow);
                assertThat(seen.add(excelRow)).as(what + " · строка Excel " + excelRow + " повторилась").isTrue();
                if (count) {
                    sum = sum.add(BigDecimal.ONE);
                } else if (item.get("measure") != null) {
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

    // ---------- ожидаемое по байтам xlsx ----------

    /**
     * Ожидаемое по файлу; строки, которые загрузка отклонила ({@code sourceRejected}, {@code refRejected} — номера строк Excel),
     * не входят ни в какие цифры, а строка справочника с ошибкой не даёт названия (контракт 10.5 п.1).
     */
    private static Expected expected(Sphere sphere, ReportSpec report, byte[] sourceFile, byte[] refFile,
                                     Set<Integer> sourceRejected, Set<Integer> refRejected) {
        Map<List<String>, FileRow> refByKey = new HashMap<>();
        if (refFile != null) {
            for (FileRow refRow : readSheet(refFile, REF_SHEET, sphere.refCols())) {
                if (refRejected.contains(refRow.excelRow())) {
                    continue;
                }
                List<String> key = report.keys().stream().map(k -> keyOf(refRow.values().get(k.refField()))).toList();
                refByKey.putIfAbsent(key, refRow);
            }
        }
        TreeMap<Integer, YearFacts> years = new TreeMap<>();
        Agg undated = new Agg();
        String dateField = dateField(sphere.sourceCols());
        for (FileRow row : readSheet(sourceFile, SOURCE_SHEET, sphere.sourceCols())) {
            if (sourceRejected.contains(row.excelRow())) {
                continue;
            }
            BigDecimal measure = MEASURE_COUNT.equals(report.measureKind())
                    ? BigDecimal.ONE : measureOf(row.values().get(report.measureField()));
            LocalDate date = dateOf(row.values().get(dateField));
            if (date == null) {
                undated.add(measure, row.excelRow());
                continue;
            }
            FileRow refRow = null;
            if (refFile != null) {
                List<String> key = report.keys().stream().map(k -> keyOf(row.values().get(k.field()))).toList();
                refRow = refByKey.get(key);
            }
            String group1 = groupOf(levelValue(report.level1(), row, refRow));
            YearFacts facts = years.computeIfAbsent(date.getYear(), y -> new YearFacts());
            int month = date.getMonthValue();
            facts.grand.add(month, measure, row.excelRow());
            facts.lines1.computeIfAbsent(group1, g -> new Bucket()).add(month, measure, row.excelRow());
            if (report.level2() != null) {
                String group2 = groupOf(levelValue(report.level2(), row, refRow));
                facts.lines2.computeIfAbsent(group1, g -> new HashMap<>())
                        .computeIfAbsent(group2, g -> new Bucket()).add(month, measure, row.excelRow());
            }
        }
        return new Expected(years, undated);
    }

    private static Object levelValue(Level level, FileRow row, FileRow refRow) {
        if (ORIGIN_SOURCE.equals(level.origin())) {
            return row.values().get(level.field());
        }
        return refRow == null ? null : refRow.values().get(level.field());
    }

    private static String dateField(List<Col> cols) {
        return cols.stream().filter(c -> c.type() == DataType.DATE).map(Col::field).findFirst()
                .orElseThrow(() -> new IllegalStateException("В сфере нет колонки даты"));
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

    /** Ключ связи: пусто = пусто, число — по значению, текст — без пробелов по краям. */
    private static String keyOf(Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof BigDecimal number) {
            return number.stripTrailingZeros().toPlainString();
        }
        String text = trimSpaces((String) value);
        if (NUMBER_TEXT.matcher(text).matches()) {
            return new BigDecimal(text).stripTrailingZeros().toPlainString();
        }
        return text;
    }

    /** Группа уровня: нормализованное название, пустое — {@code null} («Без названия»). */
    private static String groupOf(Object value) {
        if (value == null) {
            return null;
        }
        String text = value instanceof BigDecimal number ? number.toPlainString() : (String) value;
        String group = trimSpaces(text).toLowerCase(Locale.ROOT);
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
            return LocalDate.parse(trimSpaces(text), FILE_DATE);
        } catch (DateTimeParseException notDate) {
            return null;
        }
    }

    private static BigDecimal measureOf(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal number) {
            return number;
        }
        try {
            return new BigDecimal(trimSpaces((String) value));
        } catch (NumberFormatException notNumber) {
            return null;
        }
    }

    private static String trimSpaces(String text) {
        int start = 0;
        int end = text.length();
        while (start < end && text.charAt(start) == ' ') {
            start++;
        }
        while (end > start && text.charAt(end - 1) == ' ') {
            end--;
        }
        return text.substring(start, end);
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

    private static byte[] workbook(String sheetName, List<Col> cols, List<List<Object>> rows) {
        List<String> header = cols.stream().map(Col::header).toList();
        return UplXlsxFixtures.workbook(new SheetSpec(sheetName, 1, header, rows));
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

    private long createReport(ReportSpec report, long sourceId, int sourceOrdinal, Long refId, Integer refOrdinal)
            throws Exception {
        Map<String, Object> measure = new LinkedHashMap<>();
        measure.put("kind", report.measureKind());
        measure.put("field", report.measureField());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", report.name());
        body.put("sourceId", sourceId);
        body.put("sourceSheet", sourceOrdinal);
        body.put("dateField", "dt");
        body.put("measure", measure);
        body.put("divisor", report.divisor());
        body.put("decimals", report.decimals());
        body.put("ref", refId == null ? null : Map.of("sourceId", refId, "sheet", refOrdinal, "keys",
                report.keys().stream().map(k -> Map.of("field", k.field(), "refField", k.refField())).toList()));
        body.put("level1", level(report.level1()));
        body.put("level2", report.level2() == null ? null : level(report.level2()));

        MockHttpServletResponse response = send(post(BASE + "/reports").contentType("application/json")
                .content(json(body)));
        String content = response.getContentAsString(StandardCharsets.UTF_8);
        assertThat(response.getStatus()).as(content).isEqualTo(201);
        return ((Number) JsonPath.read(content, "$.id")).longValue();
    }

    private static Map<String, Object> level(Level level) {
        return Map.of("origin", level.origin(), "field", level.field());
    }

    // ---------- сферы ----------

    private static Sphere sphereTwoColumnKey() {
        List<Col> source = List.of(keyCol(), new Col("Дата TEST", "dt", DataType.DATE),
                new Col("Код 1 TEST", "codea", DataType.TEXT), new Col("Код 2 TEST", "codeb", DataType.TEXT),
                new Col("Сумма TEST", "summa", DataType.NUMBER));
        List<Col> ref = List.of(keyCol(), new Col("Код 1 TEST", "codea", DataType.TEXT),
                new Col("Код 2 TEST", "codeb", DataType.TEXT),
                new Col("Верхний уровень TEST", "namea", DataType.TEXT),
                new Col("Нижний уровень TEST", "nameb", DataType.TEXT));
        String[][] refData = {
                {"1183.0", "A", "TEST Север", "TEST участок 1"},
                {"1183", null, "TEST Юг", "TEST участок 2"},
                {"TEST-K2", "B", "test север ", "TEST участок 3"},
                {"TEST-K3", "B", "TEST Север", "TEST участок 1"},
                {"TEST-K4", null, "TEST Запад", "TEST участок 4"},
                {"TEST-K2", "B", "TEST Восток", "TEST участок 5"},
                {"TEST-K5", "C", "TEST Юг", "TEST участок 6"}};
        List<List<Object>> refRows = new ArrayList<>();
        for (int i = 0; i < refData.length; i++) {
            refRows.add(Arrays.asList(objectKey(i), refData[i][0], refData[i][1], refData[i][2], refData[i][3]));
        }
        String[][] pairs = {{"1183", "A"}, {"1183", null}, {"TEST-K2", "B"}, {"TEST-K3", "B"}, {"TEST-K4", null},
                {"TEST-K5", "C"}, {"TEST-K9", "B"}, {"TEST-K4", "B"}};
        List<List<Object>> sourceRows = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            String date = switch (i) {
                case 7, 23 -> null;
                case 40 -> "31.02.2026";
                default -> fileDate(i % 28 + 1, i * 5 % MONTHS + 1, i % 3 == 0 ? 2025 : 2026);
            };
            double amount = i * 37 % 500 + (i % 2 == 0 ? 0.25 : 0.5);
            String[] pair = pairs[i % pairs.length];
            sourceRows.add(Arrays.asList(objectKey(i), date, pair[0], pair[1], amount));
        }
        ReportSpec report = new ReportSpec("TEST отчёт сфера 1", MEASURE_TOTAL, "summa", 1000, 1,
                List.of(new KeyPair("codea", "codea"), new KeyPair("codeb", "codeb")),
                new Level(ORIGIN_REF, "namea"), new Level(ORIGIN_REF, "nameb"));
        return new Sphere("TEST сфера 1 — ключ из двух колонок", source, sourceRows, ref, refRows, List.of(report));
    }

    private static Sphere sphereOneColumnKey() {
        List<Col> source = List.of(keyCol(), new Col("Дата TEST", "dt", DataType.DATE),
                new Col("Код TEST", "kod", DataType.INTEGER), new Col("Вид TEST", "vid", DataType.TEXT),
                new Col("Количество TEST", "kolvo", DataType.INTEGER));
        List<Col> ref = List.of(keyCol(), new Col("Код TEST", "kod", DataType.INTEGER),
                new Col("Группа TEST", "gruppa", DataType.TEXT));
        String[] groups = {"TEST группа A", "TEST группа B", "TEST группа A", "TEST группа C", "TEST группа C"};
        List<List<Object>> refRows = new ArrayList<>();
        for (int i = 0; i < groups.length; i++) {
            refRows.add(Arrays.asList(objectKey(i), i + 1, groups[i]));
        }
        List<List<Object>> sourceRows = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            String date = i == 10 || i == 33 ? null : fileDate(i % 27 + 1, i * 7 % MONTHS + 1, i % 2 == 0 ? 2025 : 2026);
            String kind = i % 11 == 0 ? null : "TEST вид " + "XYZ".charAt(i % 3);
            sourceRows.add(Arrays.asList(objectKey(i), date, i % 6 + 1, kind, i * 7 % 20 + 1));
        }
        ReportSpec report = new ReportSpec("TEST отчёт сфера 2", MEASURE_TOTAL, "kolvo", 1, 0,
                List.of(new KeyPair("kod", "kod")), new Level(ORIGIN_REF, "gruppa"), new Level(ORIGIN_SOURCE, "vid"));
        return new Sphere("TEST сфера 2 — ключ из одной колонки", source, sourceRows, ref, refRows, List.of(report));
    }

    private static Sphere sphereWithoutRef() {
        List<Col> source = List.of(keyCol(), new Col("Направление TEST", "napr", DataType.TEXT),
                new Col("Страна TEST", "strana", DataType.TEXT), new Col("Дата TEST", "dt", DataType.DATE),
                new Col("Стоимость TEST", "stoim", DataType.NUMBER));
        List<List<Object>> sourceRows = new ArrayList<>();
        for (int i = 0; i < 45; i++) {
            String direction = i % 9 == 4 ? null : "TEST направление " + (i % 2 + 1);
            String country = "TEST страна " + "ABCD".charAt(i % 4);
            String date = i == 5 || i == 30 ? null : fileDate(i % 28 + 1, i * 11 % MONTHS + 1, i % 4 < 2 ? 2025 : 2026);
            double cost = i * 12345 % 900000 + 0.5;
            sourceRows.add(Arrays.asList(objectKey(i), direction, country, date, cost));
        }
        ReportSpec total = new ReportSpec("TEST отчёт сфера 3", MEASURE_TOTAL, "stoim", 1000000, 3,
                List.of(), new Level(ORIGIN_SOURCE, "napr"), new Level(ORIGIN_SOURCE, "strana"));
        ReportSpec count = new ReportSpec("TEST отчёт сфера 3 число строк", MEASURE_COUNT, null, 1, 0,
                List.of(), new Level(ORIGIN_SOURCE, "napr"), null);
        return new Sphere("TEST сфера 3 — без справочника", source, sourceRows, null, null, List.of(total, count));
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
