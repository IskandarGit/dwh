package com.greenwhite.dwh.instance.config.cache;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;

import static org.assertj.core.api.Assertions.assertThat;

class CacheConfigTest {

    private final CacheConfig cacheConfig = new CacheConfig();

    @Test
    @DisplayName("CacheManager должен регистрировать все необходимые кэши для справочников и навигации")
    void shouldRegisterAllDeclaredCaches() {
        CacheManager cacheManager = cacheConfig.cacheManager();
        assertThat(cacheManager).isNotNull();

        assertThat(cacheManager.getCacheNames()).containsExactlyInAnyOrder(
                CacheConfig.TASK_STATUSES_CACHE,
                CacheConfig.TASK_TYPES_CACHE,
                CacheConfig.ACTIVE_MODULES_CACHE,
                CacheConfig.ALL_MODULES_CACHE,
                CacheConfig.MODULE_ACTIVE_CACHE,
                CacheConfig.NAVIGATION_ITEMS_CACHE,
                CacheConfig.CUSTOM_FIELDS_CACHE
        );
    }

    @Test
    @DisplayName("Кэш должен сохранять и возвращать значения, а также поддерживать очистку")
    void shouldStoreRetrieveAndEvictCachedEntries() {
        CacheManager cacheManager = cacheConfig.cacheManager();
        Cache cache = cacheManager.getCache(CacheConfig.TASK_STATUSES_CACHE);
        assertThat(cache).isNotNull();

        cache.put("all", "dummy-status-list");
        assertThat(cache.get("all", String.class)).isEqualTo("dummy-status-list");

        cache.clear();
        assertThat(cache.get("all")).isNull();
    }
}
