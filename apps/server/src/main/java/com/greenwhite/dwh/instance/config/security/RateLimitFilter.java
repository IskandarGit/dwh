package com.greenwhite.dwh.instance.config.security;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.security.ClientIpResolver;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.search.service.SearchPolicyProvider;
import com.greenwhite.dwh.instance.search.service.SearchRateBudget;
import io.github.bucket4j.ConsumptionProbe;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;

/**
 * Лимиты частоты запросов (FR-SEC-2): по IP для неаутентифицированных,
 * по пользователю для cookie-сессий, по владельцу токена для Bearer;
 * отдельный (более строгий) лимит на дорогие пути. Превышение — 429 с
 * Retry-After (RFC 9457 body) и событием rate_limit_exceeded в
 * security-журнале (с анти-флудом: не чаще раза в минуту на ключ).
 *
 * Стоит в цепочке ПОСЛЕ KauthAuthenticationFilter (нужна личность) и
 * ДО AuthorizationFilter — превышение отвечает 429, а не 401/403.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    public static final String EVENT_RATE_LIMIT_EXCEEDED = "rate_limit_exceeded";

    private final RateLimitProperties props;
    private final RateLimitService rateLimitService;
    private final SearchPolicyProvider searchPolicyProvider;
    private final AuditLogService auditLogService;
    private final ProblemDetailAuthHandlers problemWriter;
    private final ClientIpResolver clientIpResolver;
    private final AntPathMatcher pathMatcher = new AntPathMatcher();
    private com.greenwhite.dwh.instance.search.service.SearchMetrics searchMetrics = com.greenwhite.dwh.instance.search.service.SearchMetrics.unmetered();

    @org.springframework.beans.factory.annotation.Autowired
    public RateLimitFilter(RateLimitProperties props, RateLimitService service, SearchPolicyProvider policies,
                           AuditLogService audit, ProblemDetailAuthHandlers problems,
                           ClientIpResolver clientIpResolver,
                           java.util.Optional<com.greenwhite.dwh.instance.search.service.SearchMetrics> metrics) {
        this(props, service, policies, audit, problems, clientIpResolver);
        this.searchMetrics = metrics.orElseGet(com.greenwhite.dwh.instance.search.service.SearchMetrics::unmetered);
    }

    public RateLimitFilter(RateLimitProperties props,
                           RateLimitService rateLimitService,
                           SearchPolicyProvider searchPolicyProvider,
                           AuditLogService auditLogService,
                           ProblemDetailAuthHandlers problemWriter,
                           ClientIpResolver clientIpResolver) {
        this.props = props;
        this.rateLimitService = rateLimitService;
        this.searchPolicyProvider = searchPolicyProvider;
        this.auditLogService = auditLogService;
        this.problemWriter = problemWriter;
        this.clientIpResolver = clientIpResolver != null ? clientIpResolver : new ClientIpResolver(null);
    }

    public RateLimitFilter(RateLimitProperties props,
                           RateLimitService rateLimitService,
                           SearchPolicyProvider searchPolicyProvider,
                           AuditLogService auditLogService,
                           ProblemDetailAuthHandlers problemWriter) {
        this(props, rateLimitService, searchPolicyProvider, auditLogService, problemWriter, new ClientIpResolver(null));
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !props.enabled() || request.getRequestURI().startsWith("/actuator/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        var principal = SecurityContext.getPrincipal();
        String key;
        int limit;
        if (principal == null) {
            if (isPublicI18nRead(request)) {
                key = "ip:" + clientIp(request) + ":public-read";
                limit = props.publicReadPerMinute();
            } else {
                key = "ip:" + clientIp(request);
                limit = props.ipPerMinute();
            }
        } else if (principal.isApi()) {
            // Лимит на владельца токена: сервисная учётка = одна интеграция (разд. 4.4.1 ТЗ-01)
            key = "api:" + principal.userId();
            limit = props.tokenPerMinute();
        } else {
            key = "user:" + principal.userId();
            limit = props.userPerMinute();
        }

        SearchRateBudget searchBudget = null;
        if (isInteractiveSearch(request)) {
            if (principal != null) {
                key = key + ":search";
                try {
                    searchBudget = searchPolicyProvider.effectiveBudget(limit);
                } catch (com.greenwhite.dwh.instance.common.error.ApiException unavailable) {
                    if (unavailable.getErrorCode() != ErrorCode.SERVICE_UNAVAILABLE) throw unavailable;
                    problemWriter.writeProblem(response, ErrorCode.SERVICE_UNAVAILABLE,
                            "Search configuration is unavailable", request.getRequestURI());
                    return;
                }
                limit = searchBudget.perMinute();
            }
        } else {
            String expensivePathFamily = findExpensivePathFamily(request.getRequestURI());
            if (expensivePathFamily != null) {
                key = key + ":exp:" + expensivePathFamily;
                limit = Math.min(limit, props.expensivePerMinute());
            }
        }

        ConsumptionProbe probe = searchBudget == null
                ? rateLimitService.tryConsume(key, limit)
                : rateLimitService.tryConsume(key, searchBudget.perMinute(), searchBudget.capacity());
        if (probe.isConsumed()) {
            filterChain.doFilter(request, response);
            return;
        }

        long retryAfterSec = Math.max(1, Math.ceilDiv(probe.getNanosToWaitForRefill(), 1_000_000_000L));
        if (isInteractiveSearch(request)) searchMetrics.rejected();
        if (rateLimitService.shouldLogRejection(key)) {
            auditLogService.logSecurityEvent(EVENT_RATE_LIMIT_EXCEEDED,
                    principal != null ? principal.userId() : null,
                    clientIp(request),
                    request.getHeader("User-Agent"),
                    Map.of("path", request.getRequestURI(), "key", key, "limit", limit));
        }
        response.setHeader("Retry-After", String.valueOf(retryAfterSec));
        problemWriter.writeProblem(response, ErrorCode.RATE_LIMITED,
                "Превышен лимит запросов, повторите через " + retryAfterSec + " с",
                request.getRequestURI());
    }

    private String findExpensivePathFamily(String uri) {
        for (String pattern : props.expensivePaths()) {
            if (pathMatcher.match(pattern, uri)) {
                return pattern;
            }
        }
        return null;
    }

    private static boolean isInteractiveSearch(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return ("GET".equalsIgnoreCase(request.getMethod()) && "/api/v1/search".equals(uri))
                || ("POST".equalsIgnoreCase(request.getMethod()) && "/api/v1/search/preview".equals(uri));
    }

    private boolean isPublicI18nRead(HttpServletRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }
        String uri = request.getRequestURI();
        return "/api/v1/i18n/languages".equals(uri)
                || uri.matches("/api/v1/i18n/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*");
    }

    private String clientIp(HttpServletRequest request) {
        return clientIpResolver.resolveClientIp(request);
    }
}
