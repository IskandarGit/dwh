package com.greenwhite.dwh.instance.kauth;

import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.config.error.GlobalExceptionHandler;
import com.greenwhite.dwh.instance.kauth.controller.KauthAuthController;
import com.greenwhite.dwh.instance.kauth.controller.KauthPasswordController;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.security.KauthAuthenticationFilter;
import com.greenwhite.dwh.instance.kauth.service.KauthApiTokenService;
import com.greenwhite.dwh.instance.kauth.service.KauthAuthService;
import com.greenwhite.dwh.instance.kauth.service.KauthPasswordHasher;
import com.greenwhite.dwh.instance.kauth.service.KauthSessionService;
import com.greenwhite.dwh.instance.kauth.service.KauthUserSessionInvalidator;
import com.greenwhite.dwh.instance.md.repository.MdCustomFieldRepository;
import com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository;
import com.greenwhite.dwh.instance.md.repository.MdPermissionRepository;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdScopeRepository;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import com.greenwhite.dwh.instance.md.service.MdCustomFieldService;
import com.greenwhite.dwh.instance.md.service.MdPermissionService;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.md.service.PasswordValidator;
import com.greenwhite.dwh.instance.md.service.UserSessionInvalidator;
import com.greenwhite.dwh.instance.search.SearchChangePublisher;
import jakarta.servlet.http.Cookie;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** FR-AUTH-04: the public password flow, not just the invalidator, revokes access atomically. */
@Testcontainers
class KauthPasswordChangeIntegrationTest {

    private static final String OLD_PASSWORD = "Before-Change-2026!"; // gitleaks:allow -- synthetic test credential
    private static final String NEW_PASSWORD = "After-Change-2026!"; // gitleaks:allow -- synthetic test credential
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("password_change_test").withUsername("test_user").withPassword("test_pass");

    static DriverManagerDataSource dataSource;
    static JdbcClient jdbc;
    static ObjectMapper mapper;
    static KauthPasswordHasher hasher;
    static MdUserRepository users;
    static KauthSessionRepository sessions;
    static KauthApiTokenRepository tokens;
    static KauthUserSessionInvalidator invalidator;
    static AnnotationConfigApplicationContext context;
    static MockMvc mvc;

    @BeforeAll
    static void setup() {
        dataSource = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(dataSource)
                .locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(dataSource);
        mapper = new ObjectMapper();
        hasher = new KauthPasswordHasher();
        users = new MdUserRepository(jdbc, mapper);
        sessions = new KauthSessionRepository(jdbc);
        tokens = new KauthApiTokenRepository(jdbc);
        invalidator = new KauthUserSessionInvalidator(sessions, tokens);
        context = serviceContext(invalidator);
        var userService = context.getBean(MdUserService.class);
        var sessionService = new KauthSessionService(sessions);
        var tokenService = new KauthApiTokenService(tokens, new com.greenwhite.dwh.instance.kauth.service.KauthCredentialGuard(sessions, tokens));
        var permissions = new MdPermissionService(new MdPermissionRepository(jdbc));
        mvc = MockMvcBuilders.standaloneSetup(
                        new KauthPasswordController(userService),
                        // Only /me is exercised here; login/OTP delivery has its own integration suite.
                        new KauthAuthController(mock(KauthAuthService.class), sessionService, userService,
                                org.springframework.security.web.csrf.CookieCsrfTokenRepository.withHttpOnlyFalse()))
                .addFilters(new KauthAuthenticationFilter(sessionService, tokenService, userService, permissions))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @AfterAll
    static void closeContext() {
        if (context != null) context.close();
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContext.clear();
        SecurityContextHolder.clearContext();
    }

    static Stream<Arguments> passwordPaths() {
        return Stream.of("/api/v1/auth/password", "/api/v1/iam/users/me/password")
                .flatMap(path -> Stream.of(Arguments.of(path, false), Arguments.of(path, true)));
    }

    @ParameterizedTest
    @MethodSource("passwordPaths")
    void passwordChangeRevokesAllExistingCredentials(String path, boolean forced) throws Exception {
        var target = fixture(forced);
        var unrelated = fixture(false);
        assertHttpAccess(target, 200);

        mvc.perform(post(path).cookie(sessionCookie(target.sessionSecrets().getFirst()))
                        .contentType("application/json")
                        .content(mapper.writeValueAsString(Map.of("oldPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD))))
                .andExpect(status().isNoContent());

        var updated = users.findById(target.userId()).orElseThrow();
        assertThat(hasher.verifyPassword(NEW_PASSWORD, updated.passwordHash())).isTrue();
        assertThat(hasher.verifyPassword(OLD_PASSWORD, updated.passwordHash())).isFalse();
        assertThat(updated.forcePasswordChange()).isFalse();
        assertThat(updated.authenticationVersion()).isEqualTo(1);
        assertHttpAccess(target, 401);
        assertThat(openSessions(target.userId())).isZero();
        assertThat(activeTokens(target.userId())).isZero();
        assertHttpAccess(unrelated, 200);
        assertThat(users.findById(unrelated.userId()).orElseThrow().authenticationVersion()).isZero();
        assertThat(passwordAuditCount(target.userId())).isEqualTo(1);
    }

    @Test
    void passwordChangeAuthenticatedByApiTokenAlsoRevokesThatToken() throws Exception {
        var target = fixture(false);

        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", "Bearer " + target.tokenSecrets().getFirst())
                        .contentType("application/json")
                        .content(mapper.writeValueAsString(Map.of("oldPassword", OLD_PASSWORD, "newPassword", NEW_PASSWORD))))
                .andExpect(status().isNoContent());

        assertHttpAccess(target, 401);
    }

    @Test
    void wrongCurrentPasswordDoesNotRevokeAccessOrChangePassword() throws Exception {
        var target = fixture(true);
        String originalHash = users.findById(target.userId()).orElseThrow().passwordHash();

        mvc.perform(post("/api/v1/auth/password").cookie(sessionCookie(target.sessionSecrets().getFirst()))
                        .contentType("application/json")
                        .content(mapper.writeValueAsString(Map.of("oldPassword", "Wrong-Current-2026!", "newPassword", NEW_PASSWORD))))
                .andExpect(status().isUnauthorized());

        assertUnchanged(target, originalHash);
    }

    @Test
    void invalidNewPasswordDoesNotRevokeAccessOrClearForcedChange() throws Exception {
        var target = fixture(true);
        String originalHash = users.findById(target.userId()).orElseThrow().passwordHash();

        mvc.perform(post("/api/v1/auth/password").cookie(sessionCookie(target.sessionSecrets().getFirst()))
                        .contentType("application/json")
                        .content(mapper.writeValueAsString(Map.of("oldPassword", OLD_PASSWORD, "newPassword", "short"))))
                .andExpect(status().isUnprocessableEntity());

        assertUnchanged(target, originalHash);
    }

    @Test
    void revocationFailureRollsBackPasswordSessionsTokensAndForcedChangeFlag() throws Exception {
        var target = fixture(true);
        String originalHash = users.findById(target.userId()).orElseThrow().passwordHash();
        // Fault at a real transaction boundary, after both real revocation writes have run.
        UserSessionInvalidator failingInvalidator = userId -> {
            invalidator.invalidateAllAccess(userId);
            throw new IllegalStateException("synthetic revocation failure");
        };

        try (var failingContext = serviceContext(failingInvalidator)) {
            assertThatThrownBy(() -> failingContext.getBean(MdUserService.class)
                    .changePassword(target.userId(), 0, OLD_PASSWORD, NEW_PASSWORD))
                    .isInstanceOf(IllegalStateException.class).hasMessage("synthetic revocation failure");
        }

        assertUnchanged(target, originalHash);
    }

    private static AnnotationConfigApplicationContext serviceContext(UserSessionInvalidator credentialInvalidator) {
        var testContext = new AnnotationConfigApplicationContext();
        testContext.register(EnableTransactions.class);
        testContext.registerBean(DataSource.class, () -> dataSource);
        testContext.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        var audit = new AuditLogService(new AuditLogRepository(jdbc, mapper), null, new AuditDataRedactor());
        var permissions = new MdPermissionService(new MdPermissionRepository(jdbc));
        var scopes = new MdScopeService(new MdScopeRepository(jdbc), new MdOrgUnitRepository(jdbc), permissions, audit);
        testContext.registerBean(MdUserService.class, () -> new MdUserService(
                users, new MdRoleRepository(jdbc), new MdCustomFieldService(new MdCustomFieldRepository(jdbc, mapper), audit),
                hasher, new PasswordValidator(), credentialInvalidator, mock(SearchChangePublisher.class), audit, scopes));
        testContext.refresh();
        return testContext;
    }

    private static Credentials fixture(boolean forced) {
        String login = "password_change_" + SEQUENCE.incrementAndGet();
        Long userId = jdbc.sql("""
                        insert into md_users (name, login, email, password_hash, state, language, timezone,
                                              attributes, is_2fa_enabled, force_password_change)
                        values (:login, :login, :email, :hash, 'A', 'ru', 'UTC', '{}'::jsonb, false, :forced)
                        returning id
                        """)
                .param("login", login).param("email", login + "@example.test")
                .param("hash", hasher.hashPassword(OLD_PASSWORD)).param("forced", forced).query(Long.class).single();
        List<String> sessionSecrets = List.of(UUID.randomUUID().toString(), UUID.randomUUID().toString());
        List<String> tokenSecrets = List.of("dwh_" + UUID.randomUUID(), "dwh_" + UUID.randomUUID());
        for (String secret : sessionSecrets) sessions.create(userId, 0, KauthPasswordHasher.sha256(secret), "127.0.0.1", "test", "test");
        for (String secret : tokenSecrets) tokens.create(userId, 0, "test", secret.substring(0, 12), KauthPasswordHasher.sha256(secret), null);
        return new Credentials(userId, sessionSecrets, tokenSecrets);
    }

    private static void assertHttpAccess(Credentials target, int expectedStatus) throws Exception {
        for (String secret : target.sessionSecrets()) {
            mvc.perform(get("/api/v1/auth/me").cookie(sessionCookie(secret))).andExpect(status().is(expectedStatus));
        }
        for (String secret : target.tokenSecrets()) {
            mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + secret)).andExpect(status().is(expectedStatus));
        }
    }

    private static void assertUnchanged(Credentials target, String originalHash) throws Exception {
        var user = users.findById(target.userId()).orElseThrow();
        assertThat(user.passwordHash().equals(originalHash)).isTrue();
        assertThat(user.authenticationVersion()).isZero();
        assertThat(user.forcePasswordChange()).isTrue();
        assertThat(openSessions(target.userId())).isEqualTo(2);
        assertThat(activeTokens(target.userId())).isEqualTo(2);
        assertThat(passwordAuditCount(target.userId())).isZero();
        assertHttpAccess(target, 200);
    }

    private static long openSessions(Long userId) {
        return jdbc.sql("select count(*) from kauth_sessions where user_id = :id and closed_at is null")
                .param("id", userId).query(Long.class).single();
    }

    private static long activeTokens(Long userId) {
        return jdbc.sql("select count(*) from kauth_api_tokens where user_id = :id and revoked_at is null")
                .param("id", userId).query(Long.class).single();
    }

    private static long passwordAuditCount(Long userId) {
        return jdbc.sql("select count(*) from security_events where user_id = :id and event_type = 'PASSWORD_CHANGED'")
                .param("id", userId).query(Long.class).single();
    }

    private static Cookie sessionCookie(String secret) {
        return new Cookie(KauthPref.SESSION_COOKIE_NAME, secret);
    }

    private record Credentials(Long userId, List<String> sessionSecrets, List<String> tokenSecrets) {}

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class EnableTransactions {}
}
