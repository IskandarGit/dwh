package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.api.UplUnitController;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.DefaultMockMvcBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** HTTP-проверка списка единиц {@code /api/v1/upl/units} (К-1, И4). */
class UplUnitControllerTest extends EmbeddedPostgresTest {

    private static final String BASE = "/api/v1/upl/units";
    private static final String PASSWORD = "StrongPassword2026!";

    @Autowired
    private WebApplicationContext wac;
    @Autowired
    private MdUserService users;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private FndUnitService units;
    @Autowired
    private FndActors actors;

    private MockMvc mvc;
    private String adminLogin;
    private String analystLogin;
    private String baseUnitCode;
    private String derivedUnitCode;

    private record Session(Cookie session, Cookie csrf) {
    }

    @BeforeEach
    void setUp() {
        DefaultMockMvcBuilder builder = MockMvcBuilders.webAppContextSetup(wac).apply(springSecurity());
        mvc = builder.build();
        String rnd = rnd();
        adminLogin = "upl-units-admin-" + rnd;
        analystLogin = "upl-units-analyst-" + rnd;
        createUser(adminLogin, "chief_admin");
        createUser(analystLogin, "analyst");
        baseUnitCode = "ub" + rnd();
        derivedUnitCode = "ud" + rnd();
        units.registerUnit(baseUnitCode, Map.of("uz", "Bazaviy TEST"), baseUnitCode, actors.system());
        units.registerUnit(derivedUnitCode, Map.of("uz", "Hosila TEST", "ru", "Единица TEST"), baseUnitCode,
                actors.system());
    }

    @Test
    @DisplayName("К-1: chief_admin видит единицы, имя — ru, иначе uz; порядок по коду")
    void chiefAdminSeesUnitsWithRussianName() throws Exception {
        var response = sendGet(login(adminLogin), BASE, 200);
        String body = response.getContentAsString();
        List<String> codes = JsonPath.read(body, "$[*].code");
        assertThat(codes).as(body).contains(baseUnitCode, derivedUnitCode);

        assertThat(field(body, baseUnitCode, "name")).as(body).containsExactly("Bazaviy TEST");
        assertThat(field(body, baseUnitCode, "baseUnitCode")).as(body).containsExactly(baseUnitCode);
        assertThat(field(body, derivedUnitCode, "name")).as(body).containsExactly("Единица TEST");
        assertThat(field(body, derivedUnitCode, "baseUnitCode")).as(body).containsExactly(baseUnitCode);

        assertThat(codes.indexOf(baseUnitCode)).as(body).isLessThan(codes.indexOf(derivedUnitCode));
    }

    @Test
    @DisplayName("К-1: analyst видит список единиц — право upl.sources.view у него есть")
    void analystSeesUnits() throws Exception {
        var response = sendGet(login(analystLogin), BASE, 200);
        List<String> codes = JsonPath.read(response.getContentAsString(), "$[*].code");
        assertThat(codes).as(response.getContentAsString()).contains(baseUnitCode);
    }

    @Test
    @DisplayName("К-1: без входа — 401")
    void anonymousIsUnauthorized() throws Exception {
        assertThat(mvc.perform(get(BASE)).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("К-1: имя без ru и uz падает до кода единицы")
    void displayNameFallsBackToCode() {
        assertThat(UplUnitController.displayName("u_x", Map.of())).isEqualTo("u_x");
        assertThat(UplUnitController.displayName("u_x", Map.of("uz", "A"))).isEqualTo("A");
        assertThat(UplUnitController.displayName("u_x", Map.of("uz", "A", "ru", "Б"))).isEqualTo("Б");
        assertThat(UplUnitController.displayName("u_x", Map.of("ru", ""))).isEqualTo("u_x");
    }

    /** Значение поля элемента с заданным кодом единицы: JsonPath-фильтр всегда отдаёт список. */
    private static List<String> field(String body, String code, String name) {
        return JsonPath.read(body, "$[?(@.code=='" + code + "')]." + name);
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

    private MockHttpServletResponse sendGet(Session s, String url, int expectedStatus) throws Exception {
        var response = mvc.perform(get(url).cookie(s.session(), s.csrf())).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expectedStatus);
        return response;
    }

    private static String json(Object value) {
        return new tools.jackson.databind.ObjectMapper().writeValueAsString(value);
    }

    private static String rnd() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
