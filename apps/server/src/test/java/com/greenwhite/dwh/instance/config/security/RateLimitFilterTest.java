package com.greenwhite.dwh.instance.config.security;

import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.security.KauthAuthenticationFilter;
import com.greenwhite.dwh.instance.kauth.service.KauthApiTokenService;
import com.greenwhite.dwh.instance.kauth.service.KauthSessionService;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import com.greenwhite.dwh.instance.md.service.MdPermissionService;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import com.greenwhite.dwh.instance.search.service.SearchPolicyProvider;
import io.github.bucket4j.TimeMeter;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * R3 (ремедиация, ADR-0008 разд. 2.2): DoD — превышение лимита -> 429 + Retry-After
 * + событие rate_limit_exceeded в security-журнале (ровно одно на окно, анти-флуд).
 */
@WebMvcTest(controllers = SecurityTestController.class)
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc(print=org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
@Import({SecurityConfig.class, ProblemDetailAuthHandlers.class,
        KauthAuthenticationFilter.class, RateLimitFilter.class, SearchPolicyProvider.class,
        RateLimitFilterTest.FixedClockRateLimitConfiguration.class,
        com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter.class,
        SecurityTestController.class})
@TestPropertySource(properties = {
        "logging.level.org.springframework.boot.security.autoconfigure=ERROR",
        "dwh.rate-limit.ip-per-minute=2",
        "dwh.rate-limit.public-read-per-minute=4",
        "dwh.rate-limit.user-per-minute=30",
        "dwh.rate-limit.token-per-minute=5",
        "dwh.rate-limit.expensive-per-minute=1"
})
class RateLimitFilterTest {

    @Autowired
    MockMvc mvc;
    @Autowired io.micrometer.core.instrument.simple.SimpleMeterRegistry searchMetricRegistry;

    @MockitoBean com.greenwhite.dwh.instance.search.repository.SearchSettingsRepository searchSettings;
    @org.junit.jupiter.api.BeforeEach void initializeSearchPolicy() {
        searchPolicyProvider.publishCommitted(new com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.SettingsSnapshot(
                1, com.greenwhite.dwh.instance.search.service.SearchQueryPolicy.defaults()));
    }

    @MockitoBean
    KauthSessionService sessionService;
    @MockitoBean
    KauthApiTokenService apiTokenService;
    @MockitoBean
    MdUserService userService;
    @MockitoBean
    MdPermissionService permissionService;
    @MockitoBean
    AuditLogService auditLogService;
    @MockitoBean
    com.greenwhite.dwh.instance.config.idempotency.IdempotencyService idempotencyService;
    @Autowired
    MutableTimeMeter timeMeter;
    @Autowired
    SearchPolicyProvider searchPolicyProvider;


    @Test
    @DisplayName("IP-лимит: 3-й неаутентифицированный запрос -> 429 + Retry-After + событие в журнале")
    void ipLimitExceeded_returns429AndLogsSecurityEvent() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/v1/auth/login").with(r -> { r.setRemoteAddr("10.9.9.1"); return r; }));
        }
        mvc.perform(post("/api/v1/auth/login").with(r -> { r.setRemoteAddr("10.9.9.1"); return r; }))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.code").value("rate_limited"));

        verify(auditLogService, times(1)).logSecurityEvent(
                eq(RateLimitFilter.EVENT_RATE_LIMIT_EXCEEDED), isNull(), eq("10.9.9.1"), any(), any());
    }

    @Test
    @DisplayName("Untrusted peer cannot bypass IP rate limit by spoofing rotating X-Forwarded-For headers")
    void untrustedPeer_spoofedXff_rateLimitedByRemoteAddr() throws Exception {
        String attackerDirectIp = "198.51.100.25";

        mvc.perform(post("/api/v1/auth/login")
                .with(r -> { r.setRemoteAddr(attackerDirectIp); return r; })
                .header("X-Forwarded-For", "1.1.1.1"));

        mvc.perform(post("/api/v1/auth/login")
                .with(r -> { r.setRemoteAddr(attackerDirectIp); return r; })
                .header("X-Forwarded-For", "2.2.2.2"));

        mvc.perform(post("/api/v1/auth/login")
                .with(r -> { r.setRemoteAddr(attackerDirectIp); return r; })
                .header("X-Forwarded-For", "3.3.3.3"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("rate_limited"));

        verify(auditLogService, times(1)).logSecurityEvent(
                eq(RateLimitFilter.EVENT_RATE_LIMIT_EXCEEDED), isNull(), eq(attackerDirectIp), any(), any());
    }

    @Test
    @DisplayName("Лимит пользователя считается отдельно от IP и привязан к user_id")
    void userLimitTracksAuthenticatedUser() throws Exception {
        mockAuthenticatedUser(7L, "session-7");

        for (int i = 0; i < 30; i++) {
            mvc.perform(get("/api/v1/security-test")
                            .with(r -> { r.setRemoteAddr("10.9.9.2"); return r; })
                            .cookie(new Cookie("DWH_SESSION", "session-7")))
                    .andExpect(status().isOk());
        }
        mvc.perform(get("/api/v1/security-test")
                        .with(r -> { r.setRemoteAddr("10.9.9.2"); return r; })
                        .cookie(new Cookie("DWH_SESSION", "session-7")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("rate_limited"));

        verify(auditLogService).logSecurityEvent(
                eq(RateLimitFilter.EVENT_RATE_LIMIT_EXCEEDED), eq(7L), anyString(), any(), any());
    }

    @Test
    @DisplayName("Search management path остаётся в строгом expensive bucket")
    void searchManagementPathUsesExpensiveLimit() throws Exception {
        mockAuthenticatedUser(8L, "session-8");

        mvc.perform(get("/api/v1/search/rebuild")
                        .with(r -> { r.setRemoteAddr("10.9.9.3"); return r; })
                        .cookie(new Cookie("DWH_SESSION", "session-8")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/search/rebuild")
                        .with(r -> { r.setRemoteAddr("10.9.9.3"); return r; })
                        .cookie(new Cookie("DWH_SESSION", "session-8")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("Публичные i18n reads не расходуют строгий bucket входа за общим NAT")
    void publicI18nReadsUseIndependentHigherCapacityBucket() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/api/v1/auth/login").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }));
        }
        mvc.perform(post("/api/v1/auth/login").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }))
                .andExpect(status().isTooManyRequests());

        for (int i = 0; i < 4; i++) {
            mvc.perform(get("/api/v1/i18n/ru").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/v1/i18n/ru").with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("Дорогие search и audit пути не должны исчерпывать общий лимит друг друга")
    void expensivePathFamiliesUseIndependentBuckets() throws Exception {
        mockAuthenticatedUser(9L, "session-9");

        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-9")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-9")))
                .andExpect(status().isTooManyRequests());

        for (int request = 0; request < 20; request++) {
            mvc.perform(get("/api/v1/search").param("q", "private-query-value")
                            .cookie(new Cookie("DWH_SESSION", "session-9")))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/v1/search").param("q", "private-query-value")
                        .cookie(new Cookie("DWH_SESSION", "session-9")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", matchesPattern("[1-9][0-9]*")));
    }

    @Test
    @DisplayName("Interactive search bucket разделён по владельцу и не пишет query в security log")
    void searchBurstIsOwnerScopedAndSecurityLogOmitsQuery() throws Exception {
        searchMetricRegistry.clear();
        mockAuthenticatedApiUser(11L, 111L, "api-11");
        mockAuthenticatedApiUser(12L, 112L, "api-12");

        for (int request = 0; request < 5; request++) {
            mvc.perform(post("/api/v1/search/preview").param("q", "sensitive-search-text")
                            .header("Authorization", "Bearer api-11"))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(post("/api/v1/search/preview").param("q", "sensitive-search-text")
                        .header("Authorization", "Bearer api-11"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", matchesPattern("[1-9][0-9]*")));
        mvc.perform(post("/api/v1/search/preview").param("q", "different-sensitive-text")
                        .header("Authorization", "Bearer api-11"))
                .andExpect(status().isTooManyRequests());
        mvc.perform(post("/api/v1/search/preview").param("q", "sensitive-search-text")
                        .header("Authorization", "Bearer api-12"))
                .andExpect(status().isNotFound());

        var details = org.mockito.ArgumentCaptor.<Map<String, Object>>captor();
        verify(auditLogService).logSecurityEvent(
                eq(RateLimitFilter.EVENT_RATE_LIMIT_EXCEEDED), eq(11L), anyString(), any(), details.capture());
        assertThat(details.getValue().toString()).doesNotContain("sensitive-search-text");
        assertThat(details.getValue().toString()).doesNotContain("different-sensitive-text");
        assertThat(searchMetricRegistry.find("dwh.search.rate.rejections").counter()).isNotNull();
        assertThat(searchMetricRegistry.find("dwh.search.rate.rejections").counter().count()).isEqualTo(2);
        assertThat(searchMetricRegistry.getMeters()).allSatisfy(meter -> assertThat(meter.getId().getTags()).isEmpty());
    }

    @Test
    @DisplayName("Только GET получает interactive search budget")
    void postSearchRemainsInExpensiveBucket() throws Exception {
        mockAuthenticatedApiUser(16L, 116L, "api-16");

        mvc.perform(post("/api/v1/search").param("q", "admin")
                        .header("Authorization", "Bearer api-16"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/search").param("q", "admin")
                        .header("Authorization", "Bearer api-16"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("GET preview остаётся в expensive bucket")
    void getPreviewRemainsInExpensiveBucket() throws Exception {
        mockAuthenticatedApiUser(17L, 117L, "api-17");

        mvc.perform(get("/api/v1/search/preview").param("q", "admin")
                        .header("Authorization", "Bearer api-17"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/search/preview").param("q", "admin")
                        .header("Authorization", "Bearer api-17"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("API owner cap ограничивает search rate и capacity")
    void apiOwnerLimitCapsSearchRateAndCapacity() throws Exception {
        mockAuthenticatedApiUser(13L, 113L, "api-13");
        var exposedBudgets = searchPolicyProvider.effectiveBudgets();
        assertThat(exposedBudgets.user().perMinute()).isEqualTo(30);
        assertThat(exposedBudgets.user().capacity()).isEqualTo(20);
        assertThat(exposedBudgets.api().perMinute()).isEqualTo(5);
        assertThat(exposedBudgets.api().capacity()).isEqualTo(5);

        for (int request = 0; request < 5; request++) {
            mvc.perform(get("/api/v1/search").param("q", "admin")
                            .header("Authorization", "Bearer api-13"))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/v1/search").param("q", "admin")
                        .header("Authorization", "Bearer api-13"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("Неаутентифицированный search сохраняет IP policy")
    void unauthenticatedSearchRetainsIpPolicy() throws Exception {
        for (int request = 0; request < 2; request++) {
            mvc.perform(get("/api/v1/search").param("q", "admin")
                            .with(r -> { r.setRemoteAddr("10.9.9.14"); return r; }))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(get("/api/v1/search").param("q", "admin")
                        .with(r -> { r.setRemoteAddr("10.9.9.14"); return r; }))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("Retry-After округляется вверх до полной секунды")
    void retryAfterRoundsUp() throws Exception {
        mockAuthenticatedUser(15L, "session-15");

        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-15")))
                .andExpect(status().isNotFound());
        timeMeter.advanceNanos(1);
        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-15")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "60"));
    }

    @Test
    @DisplayName("Дорогие audit endpoints не должны исчерпывать общий лимит страницы")
    void expensiveAuditEndpointsUseIndependentBuckets() throws Exception {
        mockAuthenticatedUser(10L, "session-10");

        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-10")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/audit/stats")
                        .cookie(new Cookie("DWH_SESSION", "session-10")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/audit/security-events")
                        .cookie(new Cookie("DWH_SESSION", "session-10")))
                .andExpect(status().isNotFound());

        mvc.perform(get("/api/v1/audit/logs")
                        .cookie(new Cookie("DWH_SESSION", "session-10")))
                .andExpect(status().isTooManyRequests());
    }

    private void mockAuthenticatedUser(long userId, String rawSession) {
        when(sessionService.getActiveSession(rawSession)).thenReturn(Optional.of(
                new KauthSessionRepository.SessionRecord(
                        userId, userId, "hash", "127.0.0.1", "ua", null,
                        Instant.now(), Instant.now(), null, 0)));
        when(userService.getUserById(userId)).thenReturn(new MdUserRepository.UserRecord(
                userId, "U" + userId, "u" + userId, "u" + userId + "@x", null, "hash",
                MdPref.STATE_ACTIVE, null, "ru", "UTC", null, Map.of(),
                false, false, null, Instant.now(), Instant.now(), null, null, 0));
        when(permissionService.getEffectivePermissions(userId)).thenReturn(Set.of("*.*"));
        when(permissionService.getPermissionVersion(userId)).thenReturn(1L);
    }

    private void mockAuthenticatedApiUser(long userId, long tokenId, String rawToken) {
        when(apiTokenService.validateToken(rawToken)).thenReturn(Optional.of(
                new KauthApiTokenRepository.ApiTokenRecord(
                        tokenId, userId, "test", "dwh_test", "hash", null,
                        Instant.now(), null, null, 0)));
        when(userService.getUserById(userId)).thenReturn(new MdUserRepository.UserRecord(
                userId, "U" + userId, "u" + userId, "u" + userId + "@x", null, "hash",
                MdPref.STATE_ACTIVE, null, "ru", "UTC", null, Map.of(),
                false, false, null, Instant.now(), Instant.now(), null, null, 0));
        when(permissionService.getEffectivePermissions(userId)).thenReturn(Set.of("*.*"));
        when(permissionService.getPermissionVersion(userId)).thenReturn(1L);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockRateLimitConfiguration {
        @Bean io.micrometer.core.instrument.simple.SimpleMeterRegistry searchMetricRegistry() { return new io.micrometer.core.instrument.simple.SimpleMeterRegistry(); }
        @Bean com.greenwhite.dwh.instance.search.service.SearchMetrics searchMetrics(io.micrometer.core.instrument.simple.SimpleMeterRegistry registry) {
            return new com.greenwhite.dwh.instance.search.service.SearchMetrics(registry);
        }
        @Bean
        MutableTimeMeter mutableTimeMeter() {
            return new MutableTimeMeter();
        }

        @Bean
        RateLimitService rateLimitService(MutableTimeMeter timeMeter) {
            return new RateLimitService(timeMeter);
        }
    }

    static final class MutableTimeMeter implements TimeMeter {
        private final AtomicLong currentNanos = new AtomicLong();

        @Override
        public long currentTimeNanos() {
            return currentNanos.get();
        }

        @Override
        public boolean isWallClockBased() {
            return false;
        }

        void advanceNanos(long nanos) {
            currentNanos.addAndGet(nanos);
        }
    }
}
