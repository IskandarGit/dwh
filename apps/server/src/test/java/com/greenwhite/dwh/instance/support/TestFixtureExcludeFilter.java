package com.greenwhite.dwh.instance.support;

import org.springframework.boot.context.TypeExcludeFilter;
import org.springframework.core.type.classreading.MetadataReader;
import org.springframework.core.type.classreading.MetadataReaderFactory;

import java.io.IOException;

/**
 * Убирает из компонент-скана {@code @SpringBootTest} тестовые конфигурации каркаса.
 *
 * <p>Тесты каркаса — слайсы ({@code @WebMvcTest}) с фикстурами вида
 * {@code SearchSettingsIntegrationTestSupport.Fixture}: это {@code @Configuration} в тестовых
 * исходниках, поднимающие Testcontainers и подменяющие {@code dataSource}/{@code jdbcClient}.
 * Штатный {@code TestTypeExcludeFilter} их не отсекает — методов {@code @Test} в них нет,
 * — и полный контекст падает без Docker. Исключаем всё, что лежит в {@code target/test-classes};
 * явный {@code @Import} в тестах этим фильтром не затрагивается.
 */
public class TestFixtureExcludeFilter extends TypeExcludeFilter {

    @Override
    public boolean match(MetadataReader metadataReader, MetadataReaderFactory metadataReaderFactory) throws IOException {
        String location = metadataReader.getResource().getURI().toString().replace('\\', '/');
        return location.contains("/test-classes/");
    }

    @Override
    public boolean equals(Object other) {
        return other != null && getClass() == other.getClass();
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
