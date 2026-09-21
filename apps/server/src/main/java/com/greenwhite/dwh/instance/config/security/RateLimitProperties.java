package com.greenwhite.dwh.instance.config.security;

import com.greenwhite.dwh.instance.search.SearchOwnerRateLimits;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Лимиты частоты запросов (FR-SEC-2, ADR-0008 разд. 2.2). Значения — в минуту.
 * Все значения настраиваются конфигурацией экземпляра.
 */
@ConfigurationProperties(prefix = "dwh.rate-limit")
public record RateLimitProperties(
        boolean enabled,
        int ipPerMinute,
        int publicReadPerMinute,
        int userPerMinute,
        int tokenPerMinute,
        int expensivePerMinute,
        List<String> expensivePaths,
        int maxEntries
) implements SearchOwnerRateLimits {
    public RateLimitProperties {
        if (ipPerMinute <= 0) ipPerMinute = 60;
        if (publicReadPerMinute <= 0) publicReadPerMinute = 600;
        if (userPerMinute <= 0) userPerMinute = 600;
        if (tokenPerMinute <= 0) tokenPerMinute = 300;
        if (expensivePerMinute <= 0) expensivePerMinute = 10;
        if (maxEntries <= 0) maxEntries = 10_000;
        if (expensivePaths == null) {
            expensivePaths = List.of(
                    "/api/v1/audit/stats",
                    "/api/v1/audit/logs",
                    "/api/v1/audit/security-events",
                    "/api/v1/search/**");
        }
    }
}
