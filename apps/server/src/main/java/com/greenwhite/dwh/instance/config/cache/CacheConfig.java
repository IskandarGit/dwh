package com.greenwhite.dwh.instance.config.cache;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.List;

/**
 * In-memory caching configuration using Caffeine for frequently queried reference data
 * (task statuses/types, installed modules, navigation items, custom field definitions).
 */
@Configuration
@EnableCaching
public class CacheConfig {

    public static final String TASK_STATUSES_CACHE = "taskStatuses";
    public static final String TASK_TYPES_CACHE = "taskTypes";
    public static final String ACTIVE_MODULES_CACHE = "activeModules";
    public static final String ALL_MODULES_CACHE = "allModules";
    public static final String MODULE_ACTIVE_CACHE = "moduleActive";
    public static final String NAVIGATION_ITEMS_CACHE = "navigationItems";
    public static final String CUSTOM_FIELDS_CACHE = "customFields";

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(Caffeine.newBuilder()
                .maximumSize(500)
                .expireAfterWrite(Duration.ofMinutes(10))
                .recordStats());
        cacheManager.setCacheNames(List.of(
                TASK_STATUSES_CACHE,
                TASK_TYPES_CACHE,
                ACTIVE_MODULES_CACHE,
                ALL_MODULES_CACHE,
                MODULE_ACTIVE_CACHE,
                NAVIGATION_ITEMS_CACHE,
                CUSTOM_FIELDS_CACHE
        ));
        return cacheManager;
    }
}
