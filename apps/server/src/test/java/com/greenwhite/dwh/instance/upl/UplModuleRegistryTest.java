package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** U5а (В-2): V113 регистрирует upl в реестре модулей каркаса. */
class UplModuleRegistryTest extends EmbeddedPostgresTest {

    @Autowired
    private JdbcClient jdbc;

    @Test
    @DisplayName("upl зарегистрирован как активный несистемный модуль с маршрутом /upl/sources")
    void uplIsRegisteredAsActiveNonSystemModule() {
        List<Map<String, Object>> rows = jdbc
                .sql("select route, is_system, status from md_installed_modules where code = 'upl'")
                .query()
                .listOfRows();

        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst())
                .containsEntry("route", "/upl/sources")
                .containsEntry("is_system", false)
                .containsEntry("status", "ACTIVE");
    }
}
