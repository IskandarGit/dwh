package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** HTTP-проверка API анкеты файла {@code /api/v1/upl/sources} (контракт И3, AC-1…AC-16). */
class UplSourceControllerTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/upl/sources";
    private static final String PASSWORD = "StrongPassword2026!";

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
    @Autowired
    private JdbcClient jdbc;

    private MockMvc mvc;
    private boolean idempotencyEnabled;
    private String adminLogin;
    private String analystLogin;

    private record Session(Cookie session, Cookie csrf) {
    }

    @BeforeEach
    void setUp() {
        DefaultMockMvcBuilder builder = MockMvcBuilders.webAppContextSetup(wac).apply(springSecurity());
        IdempotencyFilter idempotency = wac.getBeanProvider(IdempotencyFilter.class).getIfAvailable();
        idempotencyEnabled = idempotency != null;
        if (idempotencyEnabled) {
            builder.addFilters(idempotency);
        }
        mvc = builder.build();
        String rnd = rnd();
        adminLogin = "upl-admin-" + rnd;
        analystLogin = "upl-analyst-" + rnd;
        createUser(adminLogin, "chief_admin");
        createUser(analystLogin, "analyst");
    }

    @Test
    @DisplayName("AC-1, 4–8, 10–13: сценарий контракта через HTTP под chief_admin")
    void fullScenarioAsChiefAdmin() throws Exception {
        Session admin = login(adminLogin);
        String code = "test.api." + rnd();

        var created = send(admin, post(BASE), sourceBody(code, "TEST source", "month", null));
        assertThat(created.getStatus()).isEqualTo(201);
        long id = ((Number) read(created, "$.id")).longValue();
        assertThat((Integer) read(created, "$.lockVersion")).isZero();
        assertThat((String) read(created, "$.sourceType")).isEqualTo("file");

        var updated = send(admin, put(BASE + "/" + id), sourceBody(code, "TEST source 2", "quarter", 0));
        assertThat(updated.getStatus()).isEqualTo(200);
        assertThat((Integer) read(updated, "$.lockVersion")).isEqualTo(1);

        var stale = send(admin, put(BASE + "/" + id), sourceBody(code, "TEST source 3", "quarter", 0));
        assertProblem(stale, 409, ErrorCode.CONFLICT, "STALE_VERSION");

        String versions = BASE + "/" + id + "/format-versions";
        var draft = send(admin, post(versions), null);
        assertThat(draft.getStatus()).isEqualTo(201);
        assertThat((Integer) read(draft, "$.version")).isEqualTo(1);
        int lock = read(draft, "$.lockVersion");

        var replaced = send(admin, put(versions + "/1"), draftBody(lock));
        assertThat(replaced.getStatus()).isEqualTo(200);
        List<Object> sheets = read(replaced, "$.sheets");
        assertThat(sheets).hasSize(2);
        assertThat((String) read(replaced, "$.sheets[1].columns[0].dataType")).isEqualTo("object_key");
        assertThat((Integer) read(replaced, "$.sheets[1].ordinal")).isEqualTo(2);

        assertThat(send(admin, post(versions + "/1/publish"), Map.of("validFrom", "2026-01-01")).getStatus())
                .isEqualTo(204);
        assertThat((Integer) read(sendGet(admin, versions + "?at=2026-03-01", 200), "$.version")).isEqualTo(1);

        var copy = send(admin, post(versions), Map.of("copyFrom", 1));
        assertThat(copy.getStatus()).isEqualTo(201);
        assertThat((Integer) read(copy, "$.version")).isEqualTo(2);
        List<Object> copiedSheets = read(copy, "$.sheets");
        assertThat(copiedSheets).hasSize(2);
        assertThat(send(admin, post(versions + "/2/publish"), Map.of("validFrom", "2026-04-01")).getStatus())
                .isEqualTo(204);

        assertThat((Integer) read(sendGet(admin, versions + "?at=2026-03-31", 200), "$.version")).isEqualTo(1);
        assertThat((Integer) read(sendGet(admin, versions + "?at=2026-04-01", 200), "$.version")).isEqualTo(2);

        var list = sendGet(admin, versions, 200);
        List<Object> items = read(list, "$");
        assertThat(items).hasSize(2);
        assertThat((String) read(list, "$[0].validTo")).isEqualTo("2026-03-31");
        assertThat((String) read(list, "$[0].status")).isNotEqualTo("draft");

        var notDraft = send(admin, put(versions + "/1"), draftBody(0));
        assertProblem(notDraft, 409, ErrorCode.CONFLICT, "UPL_FORMAT_NOT_DRAFT");

        var source = sendGet(admin, BASE + "/" + id, 200);
        assertThat((Integer) read(source, "$.lastPublishedVersion")).isEqualTo(2);
        assertThat((Boolean) read(source, "$.hasDraft")).isFalse();
    }

    @Test
    @DisplayName("AC-2, 3, 9, 16: ошибки — problem+json по контракту, без 500")
    void errorsAreProblemJson() throws Exception {
        Session admin = login(adminLogin);
        String code = "test.api." + rnd();
        var created = send(admin, post(BASE), sourceBody(code, "TEST source", "month", null));
        assertThat(created.getStatus()).isEqualTo(201);
        long id = ((Number) read(created, "$.id")).longValue();

        var taken = send(admin, post(BASE), sourceBody(code, "TEST dup", "month", null));
        assertProblem(taken, 400, ErrorCode.CODE_ALREADY_EXISTS, "UPL_SOURCE_CODE_TAKEN");

        var invalid = send(admin, post(BASE), sourceBody("test.api." + rnd(), "", "weekly", null));
        assertThat(invalid.getStatus()).isEqualTo(422);
        assertThat((Integer) read(invalid, "$.status")).isEqualTo(422);
        List<String> fields = read(invalid, "$.errors[*].field");
        assertThat(fields).contains("periodicity", "name");

        String versions = BASE + "/" + id + "/format-versions";
        assertThat(send(admin, post(versions), null).getStatus()).isEqualTo(201);
        var emptyPublish = send(admin, post(versions + "/1/publish"), Map.of("validFrom", "2026-01-01"));
        assertThat(emptyPublish.getStatus()).isEqualTo(422);
        assertThat((Integer) read(emptyPublish, "$.status")).isEqualTo(422);
        assertThat((String) read(emptyPublish, "$.detail")).isEqualTo("UPL_FORMAT_INVALID");
        List<String> codes = read(emptyPublish, "$.errors[*].code");
        assertThat(codes).contains("UPL_NO_SHEETS");

        var missing = sendGet(admin, BASE + "/" + Long.MAX_VALUE, 404);
        assertThat((Integer) read(missing, "$.status")).isEqualTo(404);
        assertThat((String) read(missing, "$.code")).isNotBlank();

        var secondDraft = send(admin, post(versions), null);
        assertProblem(secondDraft, 409, ErrorCode.CONFLICT, "FND_VERSION_DRAFT_EXISTS");

        if (idempotencyEnabled) {
            String idemCode = "test.api." + rnd();
            String key = UUID.randomUUID().toString();
            Map<String, Object> body = sourceBody(idemCode, "TEST idem", "year", null);
            var first = send(admin, post(BASE).header("Idempotency-Key", key), body);
            var second = send(admin, post(BASE).header("Idempotency-Key", key), body);
            assertThat(first.getStatus()).isEqualTo(201);
            assertThat(second.getStatus()).isEqualTo(201);
            assertThat(((Number) read(second, "$.id")).longValue())
                    .isEqualTo(((Number) read(first, "$.id")).longValue());
            Long rows = jdbc.sql("select count(*) from upl_sources where code = :code")
                    .param("code", idemCode).query(Long.class).single();
            assertThat(rows).isEqualTo(1L);
        }
    }

    @Test
    @DisplayName("AC-5: список листается курсором без повторов")
    void listPagesWithCursor() throws Exception {
        Session admin = login(adminLogin);
        String prefix = "test.api." + rnd() + ".";
        for (String suffix : List.of("a", "b", "c")) {
            assertThat(send(admin, post(BASE), sourceBody(prefix + suffix, "TEST " + suffix, "month", null))
                    .getStatus()).isEqualTo(201);
        }
        List<String> seen = new ArrayList<>();
        String cursor = null;
        boolean hasMore = true;
        int guard = 0;
        while (hasMore) {
            assertThat(guard++).isLessThan(10_000);
            String url = BASE + "?limit=1" + (cursor == null ? "" : "&cursor=" + cursor);
            var page = sendGet(admin, url, 200);
            List<String> codes = read(page, "$.items[*].code");
            assertThat(codes).hasSizeLessThanOrEqualTo(1);
            codes.stream().filter(c -> c.startsWith(prefix)).forEach(seen::add);
            hasMore = read(page, "$.hasMore");
            Map<String, Object> pageBody = read(page, "$");
            cursor = (String) pageBody.get("nextCursor");
            if (hasMore) {
                assertThat(cursor).isNotBlank();
            }
        }
        assertThat(seen).containsExactly(prefix + "a", prefix + "b", prefix + "c");
    }

    @Test
    @DisplayName("AC-14: analyst только читает")
    void analystReadsOnly() throws Exception {
        Session admin = login(adminLogin);
        var created = send(admin, post(BASE), sourceBody("test.api." + rnd(), "TEST source", "month", null));
        assertThat(created.getStatus()).isEqualTo(201);
        long id = ((Number) read(created, "$.id")).longValue();
        assertThat(send(admin, post(BASE + "/" + id + "/format-versions"), null).getStatus()).isEqualTo(201);

        Session analyst = login(analystLogin);
        sendGet(analyst, BASE, 200);
        sendGet(analyst, BASE + "/" + id, 200);
        sendGet(analyst, BASE + "/" + id + "/format-versions", 200);

        assertForbidden(send(analyst, post(BASE), sourceBody("test.api." + rnd(), "TEST", "month", null)));
        assertForbidden(send(analyst, put(BASE + "/" + id), sourceBody("x", "TEST", "month", 0)));
        assertForbidden(send(analyst, post(BASE + "/" + id + "/format-versions"), null));
        assertForbidden(send(analyst, post(BASE + "/" + id + "/format-versions/1/publish"),
                Map.of("validFrom", "2026-01-01")));
    }

    @Test
    @DisplayName("AC-14: без входа — 401")
    void anonymousIsUnauthorized() throws Exception {
        assertThat(mvc.perform(get(BASE)).andReturn().getResponse().getStatus()).isEqualTo(401);
        var anonymousPost = mvc.perform(post(BASE).contentType("application/json")
                        .content(json(sourceBody("test.api." + rnd(), "TEST", "month", null))))
                .andReturn().getResponse();
        assertThat(anonymousPost.getStatus()).isEqualTo(401);
    }

    private void createUser(String login, String role) {
        Long systemId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        Long roleId = jdbc.sql("select id from md_roles where pcode = :role").param("role", role)
                .query(Long.class).single();
        users.createUser("TEST " + login, login, login + "@test.local", null, PASSWORD, null, "ru", "UTC", null,
                Map.of(), false, false, List.of(roleId), systemId);
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

    private MockHttpServletResponse send(Session s, MockHttpServletRequestBuilder request, Object body)
            throws Exception {
        request.cookie(s.session(), s.csrf()).header("X-XSRF-TOKEN", s.csrf().getValue());
        if (body != null) {
            request.contentType("application/json").content(json(body));
        }
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isNotEqualTo(500);
        return response;
    }

    private MockHttpServletResponse sendGet(Session s, String url, int expectedStatus) throws Exception {
        var response = mvc.perform(get(url).cookie(s.session(), s.csrf())).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expectedStatus);
        return response;
    }

    private static void assertProblem(MockHttpServletResponse response, int status, ErrorCode code, String detail)
            throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        assertThat((Integer) read(response, "$.status")).isEqualTo(status);
        assertThat((String) read(response, "$.code")).isEqualTo(wireCode(code));
        assertThat((String) read(response, "$.detail")).isEqualTo(detail);
    }

    private static void assertForbidden(MockHttpServletResponse response) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(403);
        assertThat((String) read(response, "$.code")).isEqualTo(wireCode(ErrorCode.PERMISSION_DENIED));
    }

    private static String wireCode(ErrorCode code) {
        return code.name().toLowerCase(Locale.ROOT);
    }

    private static <T> T read(MockHttpServletResponse response, String path) throws Exception {
        return JsonPath.read(response.getContentAsString(), path);
    }

    private static Map<String, Object> sourceBody(String code, String name, String periodicity, Integer lockVersion) {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("code", code);
        body.put("name", name);
        body.put("ownerOrg", "TEST org");
        body.put("periodicity", periodicity);
        body.put("slaDays", 5);
        if (lockVersion != null) {
            body.put("lockVersion", lockVersion);
        }
        return body;
    }

    private static Map<String, Object> draftBody(int lockVersion) {
        return Map.of(
                "lockVersion", lockVersion,
                "fileKind", "xlsx",
                "matchColumnsBy", "header",
                "sheets", List.of(sheet("TEST sheet 1"), sheet("TEST sheet 2")));
    }

    private static Map<String, Object> sheet(String name) {
        Map<String, Object> key = new java.util.LinkedHashMap<>();
        key.put("nameInFile", "TEST key");
        key.put("targetField", "object_key");
        key.put("dataType", "object_key");
        key.put("required", true);
        key.put("keyMask", "[0-9]{9}");
        Map<String, Object> text = Map.of(
                "nameInFile", "TEST name",
                "targetField", "object_name",
                "dataType", "text",
                "required", false);
        return Map.of("sheetName", name, "headerRow", 1, "columns", List.of(key, text));
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }

    private static String rnd() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
