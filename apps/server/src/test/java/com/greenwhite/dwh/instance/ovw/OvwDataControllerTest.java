package com.greenwhite.dwh.instance.ovw;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
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
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** HTTP-проверка запросов обзора данных {@code /api/v1/ovw} (контракт И14). */
class OvwDataControllerTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/ovw/sources";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final LocalDate JAN_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);
    private static final String ROWS_BODY = "{\"filters\":[],\"offset\":0}";
    private static final String GROUPS_BODY = "{\"groupBy\":\"org_name\",\"filters\":[]}";

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplParseJob parseJob;
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
    private String adminLogin;
    private String analystLogin;
    private String strangerLogin;
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
        });
        dwhJdbc.sql("delete from raw.rows").update();
        sourceId = UplPackageTestData.publishedSource(sources, systemUserId, JAN_FROM);
        appliedPackage(UplPackageTestData.workbook(7, 3));

        String rnd = rnd();
        adminLogin = "ovw-admin-" + rnd;
        analystLogin = "ovw-analyst-" + rnd;
        strangerLogin = "ovw-stranger-" + rnd;
        createUser(adminLogin, roleId("chief_admin"));
        createUser(analystLogin, roleId("analyst"));
        createUser(strangerLogin, null);
    }

    @Test
    @DisplayName("AC-1: администратор видит источники, раскладку и первую страницу строк")
    void chiefAdminReadsOverview() throws Exception {
        readsOverview(login(adminLogin));
    }

    @Test
    @DisplayName("AC-1: аналитик видит источники, раскладку и первую страницу строк")
    void analystReadsOverview() throws Exception {
        readsOverview(login(analystLogin));
    }

    @Test
    @DisplayName("AC-1: пользователь без роли — 403 на все четыре запроса, без входа — 401")
    void permissionsAreEnforced() throws Exception {
        Session stranger = login(strangerLogin);

        assertThat(send(stranger, get(BASE)).getStatus()).isEqualTo(403);
        assertThat(send(stranger, get(source("/layout"))).getStatus()).isEqualTo(403);
        assertThat(send(stranger, jsonPost(source("/rows"), ROWS_BODY)).getStatus()).isEqualTo(403);
        assertThat(send(stranger, jsonPost(source("/groups"), GROUPS_BODY)).getStatus()).isEqualTo(403);

        assertThat(mvc.perform(get(BASE)).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("AC-5: фильтр по неизвестной колонке — 422 с кодом поля, не 500")
    void unknownColumnFilterIsValidationError() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, jsonPost(source("/rows"),
                "{\"filters\":[{\"field\":\"nope\",\"op\":\"contains\",\"value\":\"x\"}],\"offset\":0}"));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
        assertThat((String) read(response, "$.errors[0].code")).isEqualTo(OvwErrors.OVW_COLUMN_UNKNOWN);
    }

    @Test
    @DisplayName("Неизвестный источник — 404 с кодом OVW_SOURCE_NOT_FOUND")
    void unknownSourceIsNotFound() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, get(BASE + "/999999999/layout"));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(404);
        assertThat((String) read(response, "$.detail")).isEqualTo(OvwErrors.OVW_SOURCE_NOT_FOUND);
    }

    @Test
    @DisplayName("AC-6: итог групп по числу строк сходится с суммой групп")
    void groupsAddUpToTotal() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, jsonPost(source("/groups"), GROUPS_BODY));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        List<Integer> counts = read(response, "$.groups[*].count");
        assertThat(counts).isNotEmpty();
        int sum = counts.stream().mapToInt(Integer::intValue).sum();
        assertThat(((Number) read(response, "$.total.count")).intValue()).isEqualTo(sum).isEqualTo(10);
    }

    // ---------- помощники ----------

    private void readsOverview(Session session) throws Exception {
        var list = send(session, get(BASE));
        assertThat(list.getStatus()).as(list.getContentAsString()).isEqualTo(200);
        List<Integer> ids = read(list, "$[*].id");
        assertThat(ids.stream().map(Integer::longValue).toList()).contains(sourceId);

        var layout = send(session, get(source("/layout")));
        assertThat(layout.getStatus()).as(layout.getContentAsString()).isEqualTo(200);
        List<Object> columns = read(layout, "$.columns");
        assertThat(columns).isNotEmpty();

        var rows = send(session, jsonPost(source("/rows"), ROWS_BODY));
        assertThat(rows.getStatus()).as(rows.getContentAsString()).isEqualTo(200);
        assertThat((Integer) read(rows, "$.limit")).isEqualTo(OvwLimits.PAGE_SIZE);
        assertThat((Integer) read(rows, "$.total")).isEqualTo(10);
    }

    private String source(String tail) {
        return BASE + "/" + sourceId + tail;
    }

    private static AbstractMockHttpServletRequestBuilder<?> jsonPost(String url, String body) {
        return post(url).contentType("application/json").content(body);
    }

    private void appliedPackage(byte[] content) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, systemUserId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, JAN_FROM, JAN_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), systemUserId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        PackageRow applied = applies.apply(row.publicId().toString(), systemUserId);
        assertThat(applied.status()).isEqualTo(UplPackageModel.APPLIED);
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

    private static String rnd() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
