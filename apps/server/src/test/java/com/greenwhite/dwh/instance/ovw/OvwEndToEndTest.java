package com.greenwhite.dwh.instance.ovw;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Format;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatColumn;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatSheet;
import com.greenwhite.dwh.instance.upl.UplFixtureSources;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
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
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
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
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Сквозная проверка обзора данных на конфигурациях экземпляров из фикстур: файл загружен, разобран
 * и применён запросами загрузки, затем запросы обзора дают те же строки, адреса и суммы, что сам xlsx.
 * Ожидаемые суммы тест считает прямо по байтам файла. Имён конкретной конфигурации в коде нет —
 * листы, колонки и поля берутся из {@link DepartmentFixture}.
 */
class OvwEndToEndTest extends EmbeddedPostgresTest {

    private static final String UPL = "/api/v1/upl/packages";
    private static final String OVW = "/api/v1/ovw/sources";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String FILE_NAME = "TEST.xlsx";
    private static final int DATA_ROWS = 30;
    private static final int BLANK_AFTER = 12;
    private static final List<String> GROUPS = List.of("TEST A", "TEST B", "TEST C");
    private static final String DRILL_GROUP = "TEST B";
    private static final BigDecimal NUMBER_STEP = new BigDecimal("1.25");

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private FndJobRunner jobs;
    @Autowired
    private FndActors actors;
    @Autowired
    private FndUnitService units;
    @Autowired
    private TransactionTemplate tx;

    private MockMvc mvc;
    private String adminLogin;
    private long systemUserId;

    private record Session(Cookie session, Cookie csrf) {
    }

    /** Собранный файл и где в нём лежит каждая строка данных: номер строки Excel → значение группировки. */
    private record Sample(byte[] content, Map<Integer, String> groupByRow) {
    }

    /** Что тест прочитал из байтов xlsx: группа каждой строки, число строк и суммы числовых колонок по группам. */
    private record XlsxFacts(Map<Integer, String> groupByRow, Map<String, Integer> counts,
                             Map<String, Map<String, BigDecimal>> sums) {

        BigDecimal sum(String group, String field) {
            return sums.getOrDefault(group, Map.of()).getOrDefault(field, BigDecimal.ZERO);
        }

        BigDecimal total(String field) {
            return sums.values().stream()
                    .map(byField -> byField.getOrDefault(field, BigDecimal.ZERO))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }
    }

    @BeforeEach
    void setUp() {
        DefaultMockMvcBuilder builder = MockMvcBuilders.webAppContextSetup(wac).apply(springSecurity());
        IdempotencyFilter idempotency = wac.getBeanProvider(IdempotencyFilter.class).getIfAvailable();
        if (idempotency != null) {
            builder.addFilters(idempotency);
        }
        mvc = builder.build();

        systemUserId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
            jdbc.sql("delete from fnd_job_queue").update();
            jdbc.sql("delete from fnd_job_runs").update();
        });

        adminLogin = "ovw-e2e-admin-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        createUser(adminLogin, roleId("admin"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("AC-9/AC-7: файл фикстуры применён — обзор даёт те же строки, адреса и суммы, что сам xlsx")
    void appliedFileIsSeenInOverviewAsInXlsx(DepartmentFixture fixture) throws Exception {
        UplFixtureSources.registerUnits(units, actors, fixture);
        Format format = xlsxFormat(fixture);
        FormatSheet sheet = format.sheets().getFirst();
        FormatColumn groupColumn = groupColumn(sheet);
        List<FormatColumn> summable = summableColumns(sheet);
        long sourceId = UplFixtureSources.publish(sources, format, systemUserId);
        Session admin = login(adminLogin);

        Sample sample = sample(sheet, groupColumn);
        XlsxFacts facts = readXlsx(sample.content(), sheet, groupColumn, summable);
        assertThat(facts.groupByRow()).as("файл, прочитанный по байтам, совпадает с собранным")
                .isEqualTo(sample.groupByRow());

        String packageId = uploadAndParse(admin, sourceId, format, sample.content());
        applyPackage(admin, packageId);

        assertSourceListed(admin, sourceId);
        int ordinal = sheetOrdinal(admin, sourceId, sheet);
        assertLayout(admin, sourceId, ordinal, sheet);
        assertRows(admin, sourceId, ordinal, sheet, groupColumn, facts);
        Map<String, Long> groupCounts = assertGroups(admin, sourceId, ordinal, groupColumn, summable, facts);
        assertDrillDown(admin, sourceId, ordinal, groupColumn, facts, groupCounts.get(DRILL_GROUP));
    }

    // ---------- проверки обзора ----------

    private void assertSourceListed(Session session, long sourceId) throws Exception {
        var list = ok(send(session, get(OVW)));
        List<Number> ids = read(list, "$[*].id");
        assertThat(ids.stream().map(Number::longValue).toList()).contains(sourceId);
    }

    private int sheetOrdinal(Session session, long sourceId, FormatSheet sheet) throws Exception {
        var layout = ok(send(session, get(ovw(sourceId, "/layout"))));
        List<Map<String, Object>> sheets = read(layout, "$.sheets");
        return sheets.stream()
                .filter(item -> sheet.sheetName().equals(item.get("name")))
                .map(item -> ((Number) item.get("ordinal")).intValue())
                .findFirst()
                .orElseThrow(() -> new AssertionError("В раскладке нет листа анкеты: " + sheets));
    }

    private void assertLayout(Session session, long sourceId, int ordinal, FormatSheet sheet) throws Exception {
        var layout = ok(send(session, get(ovw(sourceId, "/layout")).param("sheet", String.valueOf(ordinal))));
        assertThat(((Number) read(layout, "$.sheet")).intValue()).isEqualTo(ordinal);
        assertThat(((Number) read(layout, "$.rowsTotal")).longValue()).isEqualTo(DATA_ROWS);
        List<String> fields = read(layout, "$.columns[*].field");
        assertThat(fields).containsExactlyElementsOf(sheet.columns().stream().map(FormatColumn::field).toList());
    }

    private void assertRows(Session session, long sourceId, int ordinal, FormatSheet sheet,
                            FormatColumn groupColumn, XlsxFacts facts) throws Exception {
        var rows = ok(send(session, jsonPost(ovw(sourceId, "/rows"), rowsBody(ordinal, List.of()))));
        assertThat(((Number) read(rows, "$.total")).longValue()).isEqualTo(DATA_ROWS);
        List<Map<String, Object>> items = read(rows, "$.items");
        assertThat(items).hasSize(DATA_ROWS);
        assertThat(items).allSatisfy(item -> {
            assertThat(item).containsEntry("file", FILE_NAME);
            assertThat(item).containsEntry("sheet", sheet.sheetName());
            int excelRow = ((Number) item.get("excelRow")).intValue();
            assertThat(facts.groupByRow()).as("строка Excel %d есть в файле", excelRow).containsKey(excelRow);
            assertThat(values(item)).as("значение группировки в строке Excel %d", excelRow)
                    .containsEntry(groupColumn.field(), facts.groupByRow().get(excelRow));
        });
        assertThat(items.stream().map(item -> ((Number) item.get("excelRow")).intValue()).collect(Collectors.toSet()))
                .isEqualTo(facts.groupByRow().keySet());
    }

    private Map<String, Long> assertGroups(Session session, long sourceId, int ordinal, FormatColumn groupColumn,
                                           List<FormatColumn> summable, XlsxFacts facts) throws Exception {
        String body = json(Map.of("sheet", ordinal, "filters", List.of(), "groupBy", groupColumn.field()));
        var result = ok(send(session, jsonPost(ovw(sourceId, "/groups"), body)));
        assertThat(((Number) read(result, "$.groupsTotal")).intValue()).isEqualTo(GROUPS.size());
        assertThat(((Number) read(result, "$.groupsShown")).intValue()).isEqualTo(GROUPS.size());
        List<Map<String, Object>> groups = read(result, "$.groups");
        assertThat(groups.stream().map(group -> group.get("value")).toList()).containsExactlyElementsOf(GROUPS);

        Map<String, Long> counts = new HashMap<>();
        Map<String, BigDecimal> groupSums = new HashMap<>();
        for (Map<String, Object> group : groups) {
            String value = (String) group.get("value");
            long count = ((Number) group.get("count")).longValue();
            assertThat(count).as("строк в группе %s", value).isEqualTo(facts.counts().get(value).longValue());
            counts.put(value, count);
            Map<String, Object> sums = sums(group);
            for (FormatColumn column : summable) {
                BigDecimal actual = decimal(sums, column.field());
                assertThat(actual.compareTo(facts.sum(value, column.field())))
                        .as("сумма %s в группе %s: ожидалось %s, пришло %s",
                                column.field(), value, facts.sum(value, column.field()), actual)
                        .isZero();
                groupSums.merge(column.field(), actual, BigDecimal::add);
            }
        }

        long totalCount = ((Number) read(result, "$.total.count")).longValue();
        assertThat(totalCount).isEqualTo(DATA_ROWS)
                .isEqualTo(counts.values().stream().mapToLong(Long::longValue).sum());
        Map<String, Object> totalSums = read(result, "$.total.sums");
        for (FormatColumn column : summable) {
            BigDecimal total = decimal(totalSums, column.field());
            BigDecimal ofGroups = groupSums.getOrDefault(column.field(), BigDecimal.ZERO);
            assertThat(total.compareTo(ofGroups))
                    .as("итог %s: пришло %s, сумма групп %s", column.field(), total, ofGroups).isZero();
            assertThat(total.compareTo(facts.total(column.field())))
                    .as("итог %s: ожидалось по xlsx %s, пришло %s", column.field(), facts.total(column.field()), total)
                    .isZero();
        }
        return counts;
    }

    private void assertDrillDown(Session session, long sourceId, int ordinal, FormatColumn groupColumn,
                                 XlsxFacts facts, long groupCount) throws Exception {
        Map<String, Object> filter = Map.of("field", groupColumn.field(), "op", "eq", "value", DRILL_GROUP);
        var rows = ok(send(session, jsonPost(ovw(sourceId, "/rows"), rowsBody(ordinal, List.of(filter)))));
        assertThat(((Number) read(rows, "$.total")).longValue()).isEqualTo(groupCount);
        Set<Integer> expectedRows = facts.groupByRow().entrySet().stream()
                .filter(entry -> DRILL_GROUP.equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .collect(Collectors.toSet());
        List<Map<String, Object>> items = read(rows, "$.items");
        assertThat(items).hasSize((int) groupCount);
        assertThat(items).allSatisfy(item ->
                assertThat(expectedRows).contains(((Number) item.get("excelRow")).intValue()));
    }

    // ---------- чтение xlsx по байтам ----------

    private static XlsxFacts readXlsx(byte[] content, FormatSheet sheet, FormatColumn groupColumn,
                                      List<FormatColumn> summable) {
        try (ReadableWorkbook book = new ReadableWorkbook(new ByteArrayInputStream(content))) {
            List<Row> rows = book.findSheet(sheet.sheetName())
                    .orElseThrow(() -> new IllegalStateException("В файле нет листа анкеты: " + sheet.sheetName()))
                    .read();
            Map<String, Integer> indexByName = headerIndex(rows, sheet);
            int groupIndex = columnIndex(indexByName, groupColumn);

            Map<Integer, String> groupByRow = new LinkedHashMap<>();
            Map<String, Integer> counts = new HashMap<>();
            Map<String, Map<String, BigDecimal>> sums = new HashMap<>();
            for (Row row : rows) {
                if (row.getRowNum() <= sheet.headerRow() || isBlank(row) || isTotalRow(row, sheet.totalRowMarker())) {
                    continue;
                }
                String group = text(row, groupIndex);
                groupByRow.put(row.getRowNum(), group);
                counts.merge(group, 1, Integer::sum);
                for (FormatColumn column : summable) {
                    Optional<BigDecimal> value = number(row, columnIndex(indexByName, column));
                    value.ifPresent(v -> sums.computeIfAbsent(group, g -> new HashMap<>())
                            .merge(column.field(), v, BigDecimal::add));
                }
            }
            return new XlsxFacts(groupByRow, counts, sums);
        } catch (IOException failure) {
            throw new UncheckedIOException("Не удалось прочитать собранный xlsx", failure);
        }
    }

    private static Map<String, Integer> headerIndex(List<Row> rows, FormatSheet sheet) {
        Row header = rows.stream()
                .filter(row -> row.getRowNum() == sheet.headerRow())
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В файле нет строки шапки " + sheet.headerRow()));
        Map<String, Integer> indexByName = new HashMap<>();
        for (int i = 0; i < header.getCellCount(); i++) {
            int index = i;
            header.getOptionalCell(i)
                    .filter(cell -> cell.getType() == CellType.STRING)
                    .ifPresent(cell -> indexByName.put(cell.getText(), index));
        }
        return indexByName;
    }

    private static int columnIndex(Map<String, Integer> indexByName, FormatColumn column) {
        Integer index = indexByName.get(column.name());
        if (index == null) {
            throw new IllegalStateException("В шапке файла нет колонки анкеты: " + column.name());
        }
        return index;
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

    private static boolean isTotalRow(Row row, String marker) {
        if (marker == null) {
            return false;
        }
        for (int i = 0; i < row.getCellCount(); i++) {
            Optional<Cell> cell = row.getOptionalCell(i);
            if (cell.isPresent() && cell.get().getType() == CellType.STRING && cell.get().getText().startsWith(marker)) {
                return true;
            }
        }
        return false;
    }

    private static String text(Row row, int index) {
        return row.getOptionalCell(index)
                .filter(cell -> cell.getType() == CellType.STRING)
                .map(Cell::getText)
                .orElseThrow(() -> new IllegalStateException("Нет текста группировки в строке " + row.getRowNum()));
    }

    private static Optional<BigDecimal> number(Row row, int index) {
        Optional<Cell> cell = row.getOptionalCell(index);
        if (cell.isEmpty() || cell.get().getType() == CellType.EMPTY) {
            return Optional.empty();
        }
        if (cell.get().getType() != CellType.NUMBER) {
            throw new IllegalStateException("Не число в строке " + row.getRowNum() + ", колонка " + index
                    + ": " + cell.get().getType());
        }
        return Optional.of(cell.get().asNumber());
    }

    // ---------- сборка файла по анкете фикстуры ----------

    private static Format xlsxFormat(DepartmentFixture fixture) {
        return fixture.formats().stream()
                .filter(f -> "xlsx".equals(f.fileKind()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В фикстуре нет анкеты xlsx: " + fixture.name()));
    }

    private static FormatColumn groupColumn(FormatSheet sheet) {
        return sheet.columns().stream()
                .filter(c -> "text".equals(c.type()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В анкете фикстуры нет текстовой колонки"));
    }

    private static List<FormatColumn> summableColumns(FormatSheet sheet) {
        List<FormatColumn> summable = sheet.columns().stream()
                .filter(c -> "number".equals(c.type()) || "integer".equals(c.type()))
                .toList();
        if (summable.isEmpty()) {
            throw new IllegalStateException("В анкете фикстуры нет числовой колонки");
        }
        return summable;
    }

    private static Sample sample(FormatSheet sheet, FormatColumn groupColumn) {
        List<FormatColumn> columns = sheet.columns();
        int groupIndex = columns.indexOf(groupColumn);
        List<List<Object>> rows = new ArrayList<>();
        Map<Integer, String> groupByRow = new LinkedHashMap<>();

        for (int number = 1; number <= DATA_ROWS; number++) {
            List<Object> row = goodRow(columns, number);
            String group = GROUPS.get((number - 1) % GROUPS.size());
            row.set(groupIndex, group);
            rows.add(row);
            groupByRow.put(rowNo(sheet, rows.size() - 1), group);
            if (number == BLANK_AFTER) {
                rows.add(Arrays.asList(new Object[columns.size()]));
            }
        }

        if (sheet.totalRowMarker() != null) {
            List<Object> totals = Arrays.asList(new Object[columns.size()]);
            totals.set(0, sheet.totalRowMarker() + " TEST");
            rows.add(totals);
        }

        List<String> header = columns.stream().map(FormatColumn::name).toList();
        byte[] content = UplXlsxFixtures.workbook(new SheetSpec(sheet.sheetName(), sheet.headerRow(), header, rows));
        return new Sample(content, groupByRow);
    }

    /** Номер строки как в Excel для элемента списка строк под шапкой. */
    private static int rowNo(FormatSheet sheet, int index) {
        return sheet.headerRow() + 1 + index;
    }

    private static List<Object> goodRow(List<FormatColumn> columns, int number) {
        List<Object> row = new ArrayList<>();
        for (FormatColumn column : columns) {
            row.add(cell(column, number));
        }
        return row;
    }

    private static Object cell(FormatColumn column, int number) {
        return switch (column.type()) {
            case "integer" -> Integer.valueOf(number);
            case "number" -> NUMBER_STEP.multiply(BigDecimal.valueOf(number));
            case "text" -> "TEST " + number;
            case "ref_code" -> "TEST";
            case "date" -> "31.12.2026";
            case "object_key" -> validKey(column, number);
            default -> throw new IllegalStateException("Неизвестный тип колонки фикстуры: " + column.type());
        };
    }

    private static String validKey(FormatColumn column, int number) {
        List<String> candidates = Stream.of(String.format("9%08d", number), String.format("9%013d", number))
                .filter(candidate -> Pattern.matches(column.keyMask(), candidate))
                .toList();
        if (candidates.isEmpty()) {
            throw new IllegalStateException("Нет ключа под маску колонки фикстуры: " + column.keyMask());
        }
        return candidates.get(number % candidates.size());
    }

    // ---------- загрузка и применение ----------

    private String uploadAndParse(Session session, long sourceId, Format format, byte[] content) throws Exception {
        LocalDate periodFrom = format.validFrom();
        var request = multipart(UPL);
        request.file(new MockMultipartFile("file", FILE_NAME, UplPackageTestData.XLSX_MIME, content));
        request.param("sourceId", String.valueOf(sourceId));
        request.param("periodFrom", periodFrom.toString());
        request.param("periodTo", periodFrom.plusMonths(1).minusDays(1).toString());
        var accepted = send(session, request);
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        assertThat(jobs.runQueued()).isEqualTo(1);
        return read(accepted, "$.id");
    }

    private void applyPackage(Session session, String packageId) throws Exception {
        var applied = send(session, post(UPL + "/" + packageId + "/apply"));
        assertThat(applied.getStatus()).as(applied.getContentAsString()).isEqualTo(200);
        assertThat((String) read(applied, "$.status")).isEqualTo(UplPackageModel.APPLIED);
        assertThat(((Number) read(applied, "$.rawRows")).intValue()).isEqualTo(DATA_ROWS);
    }

    // ---------- помощники ----------

    private static String ovw(long sourceId, String tail) {
        return OVW + "/" + sourceId + tail;
    }

    private static String rowsBody(int sheet, List<Map<String, Object>> filters) {
        return "{\"sheet\":" + sheet + ",\"filters\":" + json(filters) + ",\"sort\":null,\"offset\":0}";
    }

    private static AbstractMockHttpServletRequestBuilder<?> jsonPost(String url, String body) {
        return post(url).contentType("application/json").content(body);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> values(Map<String, Object> item) {
        return (Map<String, Object>) item.get("values");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> sums(Map<String, Object> group) {
        return (Map<String, Object>) group.get("sums");
    }

    private static BigDecimal decimal(Map<String, Object> sums, String field) {
        Object value = sums.get(field);
        assertThat(value).as("в суммах нет поля %s: %s", field, sums).isNotNull();
        return new BigDecimal(value.toString());
    }

    private static MockHttpServletResponse ok(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return response;
    }

    private MockHttpServletResponse send(Session session, AbstractMockHttpServletRequestBuilder<?> request)
            throws Exception {
        request.cookie(session.session(), session.csrf());
        request.header("X-XSRF-TOKEN", session.csrf().getValue());
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isNotEqualTo(500);
        return response;
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

    private void createUser(String login, Long roleId) {
        users.createUser("TEST " + login, login, login + "@test.local", null, PASSWORD, null, "ru", "UTC", null,
                Map.of(), false, false, roleId == null ? List.of() : List.of(roleId), systemUserId);
    }

    private Long roleId(String role) {
        return jdbc.sql("select id from md_roles where pcode = :role").param("role", role)
                .query(Long.class).single();
    }

    private static <T> T read(MockHttpServletResponse response, String path) throws Exception {
        return JsonPath.read(response.getContentAsString(), path);
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }
}
