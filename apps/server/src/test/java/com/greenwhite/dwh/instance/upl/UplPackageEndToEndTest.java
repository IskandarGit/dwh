package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.fnd.load.FndLoad;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Format;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatColumn;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatSheet;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Сквозная проверка загрузки для конфигураций экземпляров из фикстур: анкета опубликована,
 * файл принят, задание разобрало его, список и ошибки прочитаны запросами. Ни одного имени
 * конкретной конфигурации в коде теста нет — всё берётся из {@link DepartmentFixture}.
 */
class UplPackageEndToEndTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/upl/packages";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String FILE_NAME = "TEST.xlsx";
    private static final String BAD_KEY = "TEST-BAD";
    private static final int GOOD_ROWS = 5;
    private static final int BAD_KEY_ROWS = 3;
    private static final int REJECTED_ROWS = BAD_KEY_ROWS + 1;
    private static final int EXPECTED_ERRORS = BAD_KEY_ROWS + 2;

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
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private FndLoadService loads;

    private MockMvc mvc;
    private String analystLogin;
    private long systemUserId;

    private record Session(Cookie session, Cookie csrf) {
    }

    /** Собранный файл и ожидания по нему: счётчики строк и адреса ошибочных ячеек. */
    private record Sample(byte[] content, int total, int rejected, int errors, List<Integer> badKeyRowNos,
                          int doubleBadRowNo) {
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

        analystLogin = "upl-e2e-analyst-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        createUser(analystLogin, roleId("analyst"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("Файл конфигурации экземпляра принят, разобран заданием, счётчики и адреса ошибок сходятся")
    void uploadedFileIsParsedAndErrorsAreAddressed(DepartmentFixture fixture) throws Exception {
        UplFixtureSources.registerUnits(units, actors, fixture);
        Format format = xlsxFormat(fixture);
        FormatSheet sheet = format.sheets().getFirst();
        long sourceId = UplFixtureSources.publish(sources, format, systemUserId);
        Sample sample = sample(sheet);
        Session analyst = login(analystLogin);

        var accepted = upload(analyst, sourceId, format, sample.content());
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        assertThat((String) read(accepted, "$.id")).isNotBlank();
        assertThat((String) read(accepted, "$.status")).isEqualTo(UplPackageModel.RECEIVED);
        Map<String, Object> received = read(accepted, "$");
        assertThat(received.get("rowsTotal")).isNull();

        assertThat(jdbc.sql("select file_sha256 from upl_packages").query(String.class).single())
                .isEqualTo(sha256(sample.content()));
        assertThat(jdbc.sql("select file_size_bytes from upl_packages").query(Long.class).single())
                .isEqualTo(sample.content().length);
        assertThat(storedFiles(sample.content())).isEqualTo(1);

        assertThat(jdbc.sql("select handler from fnd_job_queue").query(String.class).list())
                .containsExactly(UplPref.JOB_PARSE);
        assertThat(jobs.runQueued()).isEqualTo(1);

        var list = sendGet(analyst, BASE, 200);
        assertThat((String) read(list, "$.items[0].id")).isEqualTo(read(accepted, "$.id"));
        assertThat((String) read(list, "$.items[0].status")).isEqualTo(UplPackageModel.VERIFIED);
        assertThat((Integer) read(list, "$.items[0].rowsTotal")).isEqualTo(sample.total());
        assertThat((Integer) read(list, "$.items[0].rowsAccepted")).isEqualTo(sample.total() - sample.rejected());
        assertThat((Integer) read(list, "$.items[0].rowsRejected")).isEqualTo(sample.rejected());
        assertThat((Integer) read(list, "$.items[0].errorsTotal")).isEqualTo(sample.errors());
        assertThat((Integer) read(list, "$.items[0].formatVersion")).isEqualTo(UplFixtureSources.FIRST_VERSION);
        assertThat((String) read(list, "$.items[0].fileName")).isEqualTo(FILE_NAME);
        assertThat(((Number) read(list, "$.items[0].sourceId")).longValue()).isEqualTo(sourceId);

        var errors = sendGet(analyst, BASE + "/" + read(list, "$.items[0].id") + "/errors", 200);
        assertErrors(errors, sheet, sample);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("Тот же файл второй раз: два пакета с теми же счётчиками, в хранилище один файл")
    void sameFileTwiceKeepsOneStoredFile(DepartmentFixture fixture) throws Exception {
        UplFixtureSources.registerUnits(units, actors, fixture);
        Format format = xlsxFormat(fixture);
        long sourceId = UplFixtureSources.publish(sources, format, systemUserId);
        Sample sample = sample(format.sheets().getFirst());
        Session analyst = login(analystLogin);

        var first = upload(analyst, sourceId, format, sample.content());
        var second = upload(analyst, sourceId, format, sample.content());
        assertThat(first.getStatus()).as(first.getContentAsString()).isEqualTo(202);
        assertThat(second.getStatus()).as(second.getContentAsString()).isEqualTo(202);
        assertThat((String) read(first, "$.id")).isNotEqualTo(read(second, "$.id"));

        assertThat(jdbc.sql("select count(*) from upl_packages").query(Long.class).single()).isEqualTo(2);
        assertThat(jdbc.sql("select count(distinct file_id) from upl_packages").query(Long.class).single())
                .isEqualTo(1);
        assertThat(storedFiles(sample.content())).isEqualTo(1);
        assertThat(jobs.runQueued()).isEqualTo(2);

        var list = sendGet(analyst, BASE, 200);
        List<Map<String, Object>> items = read(list, "$.items");
        assertThat(items).hasSize(2).allSatisfy(item -> {
            assertThat(item).containsEntry("status", UplPackageModel.VERIFIED);
            assertThat(item).containsEntry("rowsTotal", sample.total());
            assertThat(item).containsEntry("rowsAccepted", sample.total() - sample.rejected());
            assertThat(item).containsEntry("rowsRejected", sample.rejected());
            assertThat(item).containsEntry("errorsTotal", sample.errors());
        });
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("Проверенный файл применён: строки в raw с адресом исходника, второй пакет периода — своя загрузка, первая не тронута")
    void verifiedPackageIsAppliedToRaw(DepartmentFixture fixture) throws Exception {
        UplFixtureSources.registerUnits(units, actors, fixture);
        Format format = xlsxFormat(fixture);
        FormatSheet sheet = format.sheets().getFirst();
        long sourceId = UplFixtureSources.publish(sources, format, systemUserId);
        String adminLogin = "upl-e2e-admin-" + UUID.randomUUID().toString().substring(0, 8);
        createUser(adminLogin, roleId("admin"));
        Session admin = login(adminLogin);

        Sample first = sample(sheet);
        String firstId = uploadAndParse(admin, sourceId, format, first);
        long firstLoad = applyPackage(admin, firstId, first);

        assertThat(rawRows(firstLoad)).isEqualTo(first.total());
        assertThat(dwhJdbc.sql("select count(distinct source_row_no) from raw.rows where load_id = :id"
                        + " and sheet = :sheet and source_row_no is not null")
                .param("id", firstLoad).param("sheet", sheet.sheetName()).query(Long.class).single())
                .isEqualTo(first.total());
        assertThat(dwhJdbc.sql("select min(source_row_no) from raw.rows where load_id = :id")
                .param("id", firstLoad).query(Long.class).single())
                .isGreaterThan(sheet.headerRow());
        assertThat(loads.find(firstLoad).orElseThrow().status()).isEqualTo(FndLoad.APPLIED);

        Sample second = sample(sheet);
        String secondId = uploadAndParse(admin, sourceId, format, second);
        long secondLoad = applyPackage(admin, secondId, second);

        assertThat(secondLoad).isNotEqualTo(firstLoad);
        assertThat(rawRows(secondLoad)).isEqualTo(second.total());
        assertThat(rawRows(firstLoad)).isEqualTo(first.total());
        assertThat(loads.find(firstLoad).orElseThrow().status()).isEqualTo(FndLoad.SUPERSEDED);
        assertThat(loads.find(secondLoad).orElseThrow().status()).isEqualTo(FndLoad.APPLIED);

        var list = sendGet(admin, BASE, 200);
        List<Map<String, Object>> items = read(list, "$.items");
        assertThat(items).filteredOn(item -> firstId.equals(item.get("id")))
                .singleElement()
                .satisfies(item -> assertThat(item).containsEntry("status", UplPackageModel.APPLIED));
    }

    private String uploadAndParse(Session session, long sourceId, Format format, Sample sample) throws Exception {
        var accepted = upload(session, sourceId, format, sample.content());
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        assertThat(jobs.runQueued()).isEqualTo(1);
        return read(accepted, "$.id");
    }

    private long applyPackage(Session session, String packageId, Sample sample) throws Exception {
        var applied = send(session, post(BASE + "/" + packageId + "/apply"));
        assertThat(applied.getStatus()).as(applied.getContentAsString()).isEqualTo(200);
        assertThat((String) read(applied, "$.status")).isEqualTo(UplPackageModel.APPLIED);
        assertThat(((Number) read(applied, "$.rawRows")).intValue()).isEqualTo(sample.total());
        return ((Number) read(applied, "$.loadId")).longValue();
    }

    private long rawRows(long loadId) {
        return dwhJdbc.sql("select count(*) from raw.rows where load_id = :id")
                .param("id", loadId).query(Long.class).single();
    }

    // ---------- ожидания по ошибкам ----------

    private static void assertErrors(MockHttpServletResponse errors, FormatSheet sheet, Sample sample)
            throws Exception {
        assertThat((Integer) read(errors, "$.total")).isEqualTo(sample.errors());
        assertThat((Integer) read(errors, "$.shown")).isEqualTo(sample.errors());
        List<Map<String, Object>> items = read(errors, "$.items");
        assertThat(items).hasSize(sample.errors());
        assertThat(items).allSatisfy(item -> assertThat(item).containsEntry("sheet", sheet.sheetName()));

        List<Integer> expectedBadKeyRows = new ArrayList<>(sample.badKeyRowNos());
        expectedBadKeyRows.add(sample.doubleBadRowNo());
        List<Map<String, Object>> keyErrors = items.stream()
                .filter(item -> UplXlsxParser.UPL_CELL_KEY_MASK.equals(item.get("code")))
                .toList();
        assertThat(keyErrors).hasSize(expectedBadKeyRows.size());
        assertThat(keyErrors).allSatisfy(item -> {
            assertThat(item).containsEntry("columnName", keyColumn(sheet).name());
            assertThat(item).containsEntry("value", BAD_KEY);
        });
        assertThat(keyErrors.stream().map(item -> (Integer) item.get("rowNo")).toList())
                .containsExactlyInAnyOrderElementsOf(expectedBadKeyRows);

        List<Map<String, Object>> requiredErrors = items.stream()
                .filter(item -> UplXlsxParser.UPL_CELL_REQUIRED.equals(item.get("code")))
                .toList();
        assertThat(requiredErrors).hasSize(1);
        assertThat(requiredErrors.getFirst()).containsEntry("rowNo", sample.doubleBadRowNo());
        assertThat(requiredErrors.getFirst()).containsEntry("columnName", requiredColumn(sheet).name());

        assertThat(items.stream().map(item -> (Integer) item.get("rowNo")).toList()).isSorted();
    }

    // ---------- сборка файла по анкете фикстуры ----------

    private static Format xlsxFormat(DepartmentFixture fixture) {
        return fixture.formats().stream()
                .filter(f -> "xlsx".equals(f.fileKind()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В фикстуре нет анкеты xlsx: " + fixture.name()));
    }

    private static FormatColumn keyColumn(FormatSheet sheet) {
        return sheet.columns().stream()
                .filter(c -> "object_key".equals(c.type()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В анкете фикстуры нет колонки ключа объекта учёта"));
    }

    private static FormatColumn requiredColumn(FormatSheet sheet) {
        return sheet.columns().stream()
                .filter(c -> c.required() && !"object_key".equals(c.type()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("В анкете фикстуры нет обязательной колонки"));
    }

    private static Sample sample(FormatSheet sheet) {
        List<FormatColumn> columns = sheet.columns();
        FormatColumn key = keyColumn(sheet);
        int keyIndex = columns.indexOf(key);
        List<List<Object>> rows = new ArrayList<>();

        for (int number = 1; number <= GOOD_ROWS; number++) {
            rows.add(goodRow(columns, number));
        }
        markUnique(columns, rows.getFirst());
        if (key.keyPadLength() != null && key.keyPadMax() != null && key.keyPadMax() >= 1) {
            List<Object> padded = goodRow(columns, rows.size() + 1);
            padded.set(keyIndex, "1".repeat(key.keyPadLength() - 1));
            rows.add(padded);
        }
        int total = rows.size() + BAD_KEY_ROWS + 1;
        rows.add(Arrays.asList(new Object[columns.size()]));

        List<Integer> badKeyRowNos = new ArrayList<>();
        for (int i = 0; i < BAD_KEY_ROWS; i++) {
            List<Object> bad = goodRow(columns, rows.size() + 1);
            bad.set(keyIndex, BAD_KEY);
            rows.add(bad);
            badKeyRowNos.add(rowNo(sheet, rows.size() - 1));
        }

        List<Object> doubleBad = goodRow(columns, rows.size() + 1);
        doubleBad.set(keyIndex, BAD_KEY);
        doubleBad.set(columns.indexOf(requiredColumn(sheet)), null);
        rows.add(doubleBad);
        int doubleBadRowNo = rowNo(sheet, rows.size() - 1);

        if (sheet.totalRowMarker() != null) {
            List<Object> totals = Arrays.asList(new Object[columns.size()]);
            totals.set(0, sheet.totalRowMarker() + " TEST");
            rows.add(totals);
        }

        List<String> header = columns.stream().map(FormatColumn::name).toList();
        byte[] content = UplXlsxFixtures.workbook(new SheetSpec(sheet.sheetName(), sheet.headerRow(), header, rows));
        return new Sample(content, total, REJECTED_ROWS, EXPECTED_ERRORS, badKeyRowNos, doubleBadRowNo);
    }

    /** Номер строки как в Excel для элемента списка строк данных. */
    private static int rowNo(FormatSheet sheet, int index) {
        return sheet.headerRow() + 1 + index;
    }

    /** Делает файл неповторимым: первая текстовая ячейка первой строки уникальна. */
    private static void markUnique(List<FormatColumn> columns, List<Object> row) {
        for (int i = 0; i < columns.size(); i++) {
            if ("text".equals(columns.get(i).type())) {
                row.set(i, "TEST " + UUID.randomUUID());
                return;
            }
        }
        throw new IllegalStateException("В анкете фикстуры нет текстовой колонки");
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
            case "number" -> Double.valueOf(10.5);
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

    // ---------- помощники ----------

    private MockHttpServletResponse upload(Session session, long sourceId, Format format, byte[] content)
            throws Exception {
        LocalDate periodFrom = format.validFrom();
        var request = multipart(BASE);
        request.file(new MockMultipartFile("file", FILE_NAME, UplPackageTestData.XLSX_MIME, content));
        request.param("sourceId", String.valueOf(sourceId));
        request.param("periodFrom", periodFrom.toString());
        request.param("periodTo", periodFrom.plusMonths(1).minusDays(1).toString());
        return send(session, request);
    }

    private MockHttpServletResponse send(Session session, AbstractMockHttpServletRequestBuilder<?> request)
            throws Exception {
        request.cookie(session.session(), session.csrf());
        request.header("X-XSRF-TOKEN", session.csrf().getValue());
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isNotEqualTo(500);
        return response;
    }

    private MockHttpServletResponse sendGet(Session session, String url, int expectedStatus) throws Exception {
        var response = mvc.perform(get(url).cookie(session.session(), session.csrf())).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expectedStatus);
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

    private long storedFiles(byte[] content) {
        return jdbc.sql("select count(*) from mf_files where sha256 = :sha")
                .param("sha", sha256(content)).query(Long.class).single();
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException absent) {
            throw new IllegalStateException("Нет алгоритма SHA-256", absent);
        }
    }

    private static <T> T read(MockHttpServletResponse response, String path) throws Exception {
        return JsonPath.read(response.getContentAsString(), path);
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }
}
