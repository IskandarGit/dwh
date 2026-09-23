package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import com.greenwhite.dwh.instance.upl.upload.UplUploadService;
import com.greenwhite.dwh.instance.upl.upload.UplUploadValidator;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** HTTP-проверка API загрузок файлов {@code /api/v1/upl/packages} (контракт И5, разделы 3 и 8). */
class UplPackageControllerTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/upl/packages";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String PERIOD_FROM = "2026-03-01";
    private static final String PERIOD_TO = "2026-03-31";

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
    private TransactionTemplate tx;

    private MockMvc mvc;
    private String adminLogin;
    private String analystLogin;
    private String strangerLogin;
    private String viewerLogin;
    private long systemUserId;
    private long sourceId;

    private record Session(Cookie session, Cookie csrf) {
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
        sourceId = UplPackageTestData.publishedSource(sources, systemUserId, LocalDate.of(2026, 1, 1));

        String rnd = rnd();
        adminLogin = "upl-pkg-admin-" + rnd;
        analystLogin = "upl-pkg-analyst-" + rnd;
        strangerLogin = "upl-pkg-stranger-" + rnd;
        createUser(adminLogin, roleId("chief_admin"));
        createUser(analystLogin, roleId("analyst"));
        createUser(strangerLogin, null);
        viewerLogin = "upl_viewer_" + rnd();
        createUser(viewerLogin, viewOnlyRoleId());
    }

    @Test
    @DisplayName("AC-1, 3, 4: файл принят, разобран заданием и виден в списке вместе с ошибками ячеек")
    void uploadedFileIsParsedAndVisible() throws Exception {
        Session admin = login(adminLogin);

        var accepted = upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(7, 3));
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        Map<String, Object> received = read(accepted, "$");
        assertThat(received).containsEntry("status", UplPackageModel.RECEIVED);
        assertThat(received.get("id")).isNotNull();
        assertThat(received.get("rowsTotal")).isNull();
        assertThat(received.get("rowsAccepted")).isNull();
        assertThat(received.get("rowsRejected")).isNull();
        assertThat(received.get("errorsTotal")).isNull();

        assertThat(jdbc.sql("select handler from fnd_job_queue").query(String.class).list())
                .containsExactly(UplPref.JOB_PARSE);
        assertThat(jobs.runQueued()).isEqualTo(1);

        var list = sendGet(admin, BASE, 200);
        assertThat((String) read(list, "$.items[0].status")).isEqualTo(UplPackageModel.VERIFIED);
        assertThat((Integer) read(list, "$.items[0].rowsTotal")).isEqualTo(10);
        assertThat((Integer) read(list, "$.items[0].rowsAccepted")).isEqualTo(7);
        assertThat((Integer) read(list, "$.items[0].rowsRejected")).isEqualTo(3);
        assertThat((Integer) read(list, "$.items[0].errorsTotal")).isEqualTo(3);

        var errors = sendGet(admin, BASE + "/" + read(list, "$.items[0].id") + "/errors", 200);
        assertThat((Integer) read(errors, "$.total")).isEqualTo(3);
        assertThat((Integer) read(errors, "$.shown")).isEqualTo(3);
        List<Map<String, Object>> items = read(errors, "$.items");
        assertThat(items).hasSize(3).allSatisfy(item -> {
            assertThat(item).containsEntry("code", UplXlsxParser.UPL_CELL_KEY_MASK);
            assertThat(item).containsEntry("sheet", UplPackageTestData.SHEET);
            assertThat(item).containsEntry("columnName", "Ключ");
            assertThat(item.get("rowNo")).isNotNull();
        });
    }

    @Test
    @DisplayName("Тот же файл второй раз: второй пакет, а в хранилище по-прежнему один файл")
    void sameFileTwiceGivesTwoPackagesAndOneStoredFile() throws Exception {
        Session admin = login(adminLogin);
        byte[] content = UplPackageTestData.workbook(2, 1);

        String first = read(upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO, content), "$.id");
        String second = read(upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO, content), "$.id");

        assertThat(first).isNotEqualTo(second);
        List<String> hashes = jdbc.sql("select file_sha256 from upl_packages").query(String.class).list();
        assertThat(hashes).hasSize(2);
        assertThat(hashes.get(0)).isEqualTo(hashes.get(1));
        Long stored = jdbc.sql("select count(*) from mf_files where sha256 = :sha")
                .param("sha", hashes.getFirst()).query(Long.class).single();
        assertThat(stored).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-3: файл не по анкете — пакет «отклонён системой», расхождения без номера строки")
    void fileAgainstFormatIsRejected() throws Exception {
        Session admin = login(adminLogin);

        upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO, UplPackageTestData.brokenStructure());
        assertThat(jobs.runQueued()).isEqualTo(1);

        var list = sendGet(admin, BASE, 200);
        assertThat((String) read(list, "$.items[0].status")).isEqualTo(UplPackageModel.REJECTED);
        assertThat((String) read(list, "$.items[0].rejectCode")).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat((Integer) read(list, "$.items[0].rejectParams.count")).isEqualTo(2);

        var errors = sendGet(admin, BASE + "/" + read(list, "$.items[0].id") + "/errors", 200);
        List<Map<String, Object>> items = read(errors, "$.items");
        assertThat(items).hasSize(2).allSatisfy(item -> assertThat(item.get("rowNo")).isNull());
    }

    @Test
    @DisplayName("AC-2: нет анкеты на дату периода — 409, неизвестный источник — 404, пакет не создаётся")
    void periodWithoutFormatAndUnknownSourceAreRefused() throws Exception {
        Session admin = login(adminLogin);
        byte[] content = UplPackageTestData.workbook(1, 0);

        var noFormat = upload(admin, String.valueOf(sourceId), "2025-12-01", "2025-12-31", content);
        assertThat(noFormat.getStatus()).as(noFormat.getContentAsString()).isEqualTo(409);
        assertThat((String) read(noFormat, "$.detail")).isEqualTo(UplUploadService.UPL_PKG_NO_FORMAT_AT_DATE);

        var noSource = upload(admin, "999999999", PERIOD_FROM, PERIOD_TO, content);
        assertThat(noSource.getStatus()).as(noSource.getContentAsString()).isEqualTo(404);
        assertThat((String) read(noSource, "$.detail")).isEqualTo(UplSourceService.UPL_SOURCE_NOT_FOUND);

        assertThat(packageCount()).isZero();
    }

    @Test
    @DisplayName("AC-2: запрос без полей и без файла — 422 со всеми ошибками сразу")
    void requestWithoutAnyPartIsValidationError() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, multipart(BASE));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
        List<String> codes = read(response, "$.errors[*].code");
        assertThat(codes).containsExactly(
                UplUploadValidator.UPL_PKG_SOURCE_REQUIRED,
                UplUploadValidator.UPL_PKG_PERIOD_REQUIRED,
                UplUploadValidator.UPL_PKG_PERIOD_REQUIRED,
                UplUploadValidator.UPL_PKG_FILE_REQUIRED);
        assertThat(packageCount()).isZero();
    }

    @Test
    @DisplayName("AC-2: файл больше предела — 413, пакет не создаётся")
    void tooLargeFileIsRefused() throws Exception {
        Session admin = login(adminLogin);
        byte[] content = new byte[(int) UplLimits.MAX_FILE_BYTES + 1];

        var response = upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO, content);

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(413);
        assertThat((String) read(response, "$.code")).isEqualTo("file_size_exceeded");
        assertThat((String) read(response, "$.detail")).isEqualTo(UplUploadService.UPL_PKG_FILE_TOO_LARGE);
        assertThat(packageCount()).isZero();
    }

    @Test
    @DisplayName("Ошибки неизвестного пакета и нечитаемого идентификатора — 404")
    void errorsOfUnknownPackageAreNotFound() throws Exception {
        Session admin = login(adminLogin);

        var unknown = sendGet(admin, BASE + "/" + UUID.randomUUID() + "/errors", 404);
        assertThat((String) read(unknown, "$.detail")).isEqualTo(UplPackageService.UPL_PKG_NOT_FOUND);

        var notUuid = sendGet(admin, BASE + "/not-a-uuid/errors", 404);
        assertThat((String) read(notUuid, "$.detail")).isEqualTo(UplPackageService.UPL_PKG_NOT_FOUND);
    }

    @Test
    @DisplayName("Права: аналитик грузит и смотрит, пользователь без ролей — 403, без входа — 401")
    void permissionsAreEnforced() throws Exception {
        Session analyst = login(analystLogin);
        sendGet(analyst, BASE, 200);
        var accepted = upload(analyst, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(1, 0));
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);

        Session stranger = login(strangerLogin);
        sendGet(stranger, BASE, 403);
        var refused = upload(stranger, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(1, 0));
        assertThat(refused.getStatus()).as(refused.getContentAsString()).isEqualTo(403);

        assertThat(mvc.perform(get(BASE)).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("Права: роль только с просмотром видит список и ошибки, загрузка — 403, пакет не создан")
    void viewOnlyRoleCannotUpload() throws Exception {
        Session analyst = login(analystLogin);
        var accepted = upload(analyst, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(1, 0));
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        String id = read(accepted, "$.id");

        Session viewer = login(viewerLogin);
        sendGet(viewer, BASE, 200);
        sendGet(viewer, BASE + "/" + id + "/errors", 200);

        var refused = upload(viewer, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(1, 0));
        assertThat(refused.getStatus()).as(refused.getContentAsString()).isEqualTo(403);
        assertThat(packageCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-10, 12: администратор применяет проверенную загрузку; повтор и неразобранная — 409")
    void adminAppliesVerifiedPackage() throws Exception {
        Session admin = login(adminLogin);
        var accepted = upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(7, 3));
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        String id = read(accepted, "$.id");

        var notParsed = send(admin, post(BASE + "/" + id + "/apply"));
        assertThat(notParsed.getStatus()).as(notParsed.getContentAsString()).isEqualTo(409);
        assertThat((String) read(notParsed, "$.detail")).isEqualTo("UPL_PKG_NOT_VERIFIED");

        assertThat(jobs.runQueued()).isEqualTo(1);

        var applied = send(admin, post(BASE + "/" + id + "/apply"));
        assertThat(applied.getStatus()).as(applied.getContentAsString()).isEqualTo(200);
        assertThat((String) read(applied, "$.status")).isEqualTo("applied");
        assertThat((Integer) read(applied, "$.rawRows")).isEqualTo(10);
        assertThat((Integer) read(applied, "$.rowsTotal")).isEqualTo(10);
        Object loadId = read(applied, "$.loadId");
        assertThat(loadId).isNotNull();
        assertThat(String.valueOf(loadId)).isNotBlank();

        var repeated = send(admin, post(BASE + "/" + id + "/apply"));
        assertThat(repeated.getStatus()).as(repeated.getContentAsString()).isEqualTo(409);
        assertThat((String) read(repeated, "$.detail")).isEqualTo("UPL_PKG_NOT_VERIFIED");

        var unknown = send(admin, post(BASE + "/00000000-0000-0000-0000-000000000000/apply"));
        assertThat(unknown.getStatus()).as(unknown.getContentAsString()).isEqualTo(404);
    }

    @Test
    @DisplayName("AC-12: аналитик и пользователь только с просмотром не применяют — 403")
    void analystAndViewerCannotApply() throws Exception {
        Session admin = login(adminLogin);
        var accepted = upload(admin, String.valueOf(sourceId), PERIOD_FROM, PERIOD_TO,
                UplPackageTestData.workbook(7, 3));
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        String id = read(accepted, "$.id");
        assertThat(jobs.runQueued()).isEqualTo(1);

        var byAnalyst = send(login(analystLogin), post(BASE + "/" + id + "/apply"));
        assertThat(byAnalyst.getStatus()).as(byAnalyst.getContentAsString()).isEqualTo(403);
        var byViewer = send(login(viewerLogin), post(BASE + "/" + id + "/apply"));
        assertThat(byViewer.getStatus()).as(byViewer.getContentAsString()).isEqualTo(403);

        var list = sendGet(admin, BASE, 200);
        assertThat((String) read(list, "$.items[0].id")).isEqualTo(id);
        assertThat((String) read(list, "$.items[0].status")).isEqualTo(UplPackageModel.VERIFIED);
    }

    // ---------- помощники ----------

    private MockHttpServletResponse upload(Session session, String source, String from, String to, byte[] content)
            throws Exception {
        var request = multipart(BASE);
        request.file(new MockMultipartFile("file", "TEST.xlsx", UplPackageTestData.XLSX_MIME, content));
        request.param("sourceId", source);
        request.param("periodFrom", from);
        request.param("periodTo", to);
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

    /** Роль с единственной парой «загрузки — просмотр»: такой роли в миграциях нет, граница прав проверяется на ней. */
    private Long viewOnlyRoleId() {
        String suffix = rnd();
        return tx.execute(status -> {
            actors.apply(actors.system());
            Long id = jdbc.sql("insert into md_roles (name, pcode) values (:name, :pcode) returning id")
                    .param("name", "TEST только просмотр " + suffix)
                    .param("pcode", "test_view_" + suffix)
                    .query(Long.class).single();
            jdbc.sql("insert into md_role_permissions (role_id, form_code, action) values (:role, :form, :action)")
                    .param("role", id).param("form", UplPref.FORM_PACKAGES).param("action", UplPref.ACTION_VIEW)
                    .update();
            return id;
        });
    }

    private Long roleId(String role) {
        return jdbc.sql("select id from md_roles where pcode = :role").param("role", role)
                .query(Long.class).single();
    }

    private long packageCount() {
        return jdbc.sql("select count(*) from upl_packages").query(Long.class).single();
    }

    private static <T> T read(MockHttpServletResponse response, String path) throws Exception {
        return JsonPath.read(response.getContentAsString(), path);
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }

    private static String rnd() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
