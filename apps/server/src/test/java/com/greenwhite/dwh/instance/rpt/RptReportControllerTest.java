package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInput;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptTestData.RefRow;
import com.greenwhite.dwh.instance.rpt.RptTestData.SourceRow;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
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

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** HTTP-проверка запросов сводного отчёта {@code /api/v1/rpt} (контракт И15а, раздел 2). */
class RptReportControllerTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/rpt";
    private static final String PASSWORD = "StrongPassword2026!";
    private static final String MODULE = "rpt";
    private static final LocalDate JAN_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);
    private static final String CELLS_BODY = "{\"year\":2026,\"period\":{\"kind\":\"year\"},\"path\":[],\"offset\":0}";

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
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
    private ModuleRegistryService modules;
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
    private long refId;
    private long reportId;

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
            jdbc.sql("delete from rpt_reports").update();
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        RptTestData data = new RptTestData(sources, packages, parseJob, applies, files, systemUserId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
        data.applySource(sourceId, List.of(
                new SourceRow("15.01.2026", 10.5, 1, "TEST-1", "TEST группа"),
                new SourceRow("20.01.2026", 2, 3, "TEST-1", "TEST группа")), JAN_FROM, JAN_TO);
        data.applyRef(refId, List.of(new RefRow("TEST-1", "TEST название")), JAN_FROM, JAN_TO);
        reportId = definitions.create(input("TEST report"), systemUserId).id();

        String rnd = rnd();
        adminLogin = "rpt-admin-" + rnd;
        analystLogin = "rpt-analyst-" + rnd;
        strangerLogin = "rpt-stranger-" + rnd;
        createUser(adminLogin, roleId("chief_admin"));
        createUser(analystLogin, roleId("analyst"));
        createUser(strangerLogin, null);
    }

    @AfterEach
    void enableModule() {
        setModule(true);
    }

    @Test
    @DisplayName("AC-1: администратор — все восемь запросов успешны, создание — 201")
    void chiefAdminUsesAllRequests() throws Exception {
        Session admin = login(adminLogin);

        var list = send(admin, get(BASE + "/reports"));
        assertThat(list.getStatus()).as(list.getContentAsString()).isEqualTo(200);
        List<Integer> ids = read(list, "$[*].id");
        assertThat(ids.stream().map(Integer::longValue).toList()).contains(reportId);

        var read = send(admin, get(report("")));
        assertThat(read.getStatus()).as(read.getContentAsString()).isEqualTo(200);
        int lockVersion = read(read, "$.lockVersion");

        var created = send(admin, jsonPost(BASE + "/reports", json(body("TEST report B", null))));
        assertThat(created.getStatus()).as(created.getContentAsString()).isEqualTo(201);
        assertThat((String) read(created, "$.name")).isEqualTo("TEST report B");

        var updated = send(admin, jsonPut(report(""), json(body("TEST report C", lockVersion))));
        assertThat(updated.getStatus()).as(updated.getContentAsString()).isEqualTo(200);
        assertThat((String) read(updated, "$.name")).isEqualTo("TEST report C");

        var sourceList = send(admin, get(BASE + "/sources"));
        assertThat(sourceList.getStatus()).as(sourceList.getContentAsString()).isEqualTo(200);
        List<Integer> sourceIds = read(sourceList, "$[*].id");
        assertThat(sourceIds.stream().map(Integer::longValue).toList()).contains(sourceId, refId);

        var layout = send(admin, get(BASE + "/sources/" + sourceId + "/layout?sheet=1"));
        assertThat(layout.getStatus()).as(layout.getContentAsString()).isEqualTo(200);
        List<Object> columns = read(layout, "$.columns");
        assertThat(columns).isNotEmpty();

        var view = send(admin, get(report("/view?year=2026")));
        assertThat(view.getStatus()).as(view.getContentAsString()).isEqualTo(200);
        assertThat((Integer) read(view, "$.year")).isEqualTo(2026);

        var cells = send(admin, jsonPost(report("/cells"), CELLS_BODY));
        assertThat(cells.getStatus()).as(cells.getContentAsString()).isEqualTo(200);
        assertThat((Integer) read(cells, "$.total")).isEqualTo(2);
    }

    @Test
    @DisplayName("AC-1: аналитик — просмотр, расчёт и строки ячейки да; описание, источники и раскладка — 403")
    void analystOnlyViews() throws Exception {
        Session analyst = login(analystLogin);

        assertThat(send(analyst, get(BASE + "/reports")).getStatus()).isEqualTo(200);
        assertThat(send(analyst, get(report(""))).getStatus()).isEqualTo(200);
        assertThat(send(analyst, get(report("/view"))).getStatus()).isEqualTo(200);
        assertThat(send(analyst, jsonPost(report("/cells"), CELLS_BODY)).getStatus()).isEqualTo(200);

        assertThat(send(analyst, jsonPost(BASE + "/reports", json(body("TEST report D", null)))).getStatus())
                .isEqualTo(403);
        assertThat(send(analyst, jsonPut(report(""), json(body("TEST report E", 0)))).getStatus()).isEqualTo(403);
        assertThat(send(analyst, get(BASE + "/sources")).getStatus()).isEqualTo(403);
        assertThat(send(analyst, get(BASE + "/sources/" + sourceId + "/layout")).getStatus()).isEqualTo(403);
    }

    @Test
    @DisplayName("AC-1: пользователь без роли — 403, без входа — 401")
    void permissionsAreEnforced() throws Exception {
        Session stranger = login(strangerLogin);

        assertThat(send(stranger, get(BASE + "/reports")).getStatus()).isEqualTo(403);
        assertThat(mvc.perform(get(BASE + "/reports")).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("Пустое описание — 422 со списком ошибок полей, не 500")
    void emptyDefinitionIsValidationError() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, jsonPost(BASE + "/reports", "{}"));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
        List<Object> errors = read(response, "$.errors");
        assertThat(errors).isNotEmpty();
    }

    @Test
    @DisplayName("Неизвестный отчёт — 404 с кодом RPT_REPORT_NOT_FOUND")
    void unknownReportIsNotFound() throws Exception {
        Session admin = login(adminLogin);

        var response = send(admin, get(BASE + "/reports/999999999"));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(404);
        assertThat((String) read(response, "$.detail")).isEqualTo(RptErrors.RPT_REPORT_NOT_FOUND);
    }

    @Test
    @DisplayName("Модуль «Отчёты» выключен — 400 RPT_MODULE_DISABLED")
    void disabledModule() throws Exception {
        Session admin = login(adminLogin);
        setModule(false);

        var response = send(admin, get(BASE + "/reports"));

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(400);
        assertThat((String) read(response, "$.detail")).isEqualTo(RptErrors.RPT_MODULE_DISABLED);
    }

    @Test
    @DisplayName("10.7, 10.8: отчёт из двух мер — меры в ответе; строки ячейки меры 2 с подписью колонки; мера 2 без неё — 422")
    void secondMeasureCells() throws Exception {
        Session admin = login(adminLogin);
        DefinitionInput first = input("TEST report two");
        long twoMeasures = definitions.create(new DefinitionInput(first.name(), first.sourceId(), first.sourceSheet(),
                first.dateField(), first.measure(), first.divisor(), first.decimals(), first.ref(), first.level1(),
                first.level2(), null, "TEST мера 1", null,
                new MeasureInput("TEST мера 2", sourceId, 1, null, RptTestData.months(RptTestData.AMOUNT), null, 1, 0,
                        null, new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP),
                        new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.CODE))), systemUserId).id();

        var view = send(admin, get(BASE + "/reports/" + twoMeasures + "/view"));
        assertThat(view.getStatus()).as(view.getContentAsString()).isEqualTo(200);
        List<String> names = read(view, "$.measures[*].name");
        assertThat(names).containsExactly("TEST мера 1", "TEST мера 2");
        assertThat((Integer) read(view, "$.ytdMonth")).isEqualTo(1);

        var cells = send(admin, jsonPost(BASE + "/reports/" + twoMeasures + "/cells",
                "{\"period\":{\"kind\":\"year\"},\"path\":[],\"offset\":0,\"measure\":2}"));
        assertThat(cells.getStatus()).as(cells.getContentAsString()).isEqualTo(200);
        assertThat((Integer) read(cells, "$.total")).isEqualTo(2);
        assertThat((String) read(cells, "$.value")).isEqualTo("12.5");
        List<String> columns = read(cells, "$.items[*].column");
        assertThat(columns).containsExactly("Сумма TEST", "Сумма TEST");

        var invalid = send(admin, jsonPost(report("/cells"),
                "{\"year\":2026,\"period\":{\"kind\":\"year\"},\"path\":[],\"offset\":0,\"measure\":2}"));
        assertThat(invalid.getStatus()).as(invalid.getContentAsString()).isEqualTo(422);
        List<String> fields = read(invalid, "$.errors[*].field");
        assertThat(fields).containsExactly("measure");
    }

    // ---------- помощники ----------

    private DefinitionInput input(String name) {
        return new DefinitionInput(name, sourceId, 1, RptTestData.DATE,
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), 1000, 2,
                new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE))),
                new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP), null);
    }

    private Map<String, Object> body(String name, Integer lockVersion) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        body.put("sourceId", sourceId);
        body.put("sourceSheet", 1);
        body.put("dateField", RptTestData.DATE);
        body.put("measure", Map.of("kind", RptModel.MEASURE_TOTAL, "field", RptTestData.AMOUNT));
        body.put("divisor", 1000);
        body.put("decimals", 2);
        body.put("ref", Map.of("sourceId", refId, "sheet", 1,
                "keys", List.of(Map.of("field", RptTestData.CODE, "refField", RptTestData.REF_CODE))));
        body.put("level1", Map.of("origin", RptModel.ORIGIN_REF, "field", RptTestData.REF_NAME));
        body.put("level2", Map.of("origin", RptModel.ORIGIN_SOURCE, "field", RptTestData.GROUP));
        if (lockVersion != null) {
            body.put("lockVersion", lockVersion);
        }
        return body;
    }

    private String report(String tail) {
        return BASE + "/reports/" + reportId + tail;
    }

    private void setModule(boolean enable) {
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            modules.toggleModuleStatus(MODULE, enable);
        });
    }

    private static AbstractMockHttpServletRequestBuilder<?> jsonPost(String url, String body) {
        return post(url).contentType("application/json").content(body);
    }

    private static AbstractMockHttpServletRequestBuilder<?> jsonPut(String url, String body) {
        return put(url).contentType("application/json").content(body);
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
