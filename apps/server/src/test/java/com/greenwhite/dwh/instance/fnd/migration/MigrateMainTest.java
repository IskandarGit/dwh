package com.greenwhite.dwh.instance.fnd.migration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Область миграции {@code DWH_MIGRATE_SCOPE}: проверки без Spring и без базы. */
class MigrateMainTest {

    @Test
    @DisplayName("неизвестная область отвергается с именем переменной в сообщении")
    void rejectsUnknownScope() {
        assertThatThrownBy(() -> MigrateMain.run(Map.of("DWH_MIGRATE_SCOPE", "oltp")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DWH_MIGRATE_SCOPE");
    }

    @Test
    @DisplayName("область dwh пропускает OLTP и идёт сразу к pg-dwh")
    void scopeDwhSkipsOltp() {
        assertThatThrownBy(() -> MigrateMain.run(Map.of("DWH_MIGRATE_SCOPE", "dwh")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DWH_DATA_DB_URL");
    }

    @Test
    @DisplayName("по умолчанию миграция начинается с OLTP")
    void defaultScopeStartsWithOltp() {
        assertThatThrownBy(() -> MigrateMain.run(Map.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageEndingWith("DWH_DB_URL")
                .hasMessageNotContaining("DWH_DATA_DB_URL");
    }
}
