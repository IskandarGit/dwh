package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.md.repository.ModuleRegistryRepository;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class ModuleRegistryIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_module_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;
    static ModuleRegistryService moduleService;

    @BeforeAll
    static void setup() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);
        var mapper = new ObjectMapper();
        var repo = new ModuleRegistryRepository(jdbc, mapper);
        var auditRepo = new AuditLogRepository(jdbc, mapper);
        var auditService = new AuditLogService(auditRepo, null, new AuditDataRedactor());
        moduleService = new ModuleRegistryService(repo, auditService);
    }

    @Test
    @DisplayName("1. Реестр содержит базовые системные модули и эталонный модуль заметок")
    void registryContainsCoreAndReferenceModules() {
        var all = moduleService.getAllModules();
        assertThat(all).isNotEmpty();
        var codes = all.stream().map(ModuleRegistryService.InstalledModuleView::code).toList();
        assertThat(codes).contains("iam", "tasks", "files", "audit", "search", "notes");

        var active = moduleService.getActiveModules();
        assertThat(active).isNotEmpty();
    }

    @Test
    @DisplayName("2. Системные модули защищены от отключения")
    void systemModulesCannotBeDisabled() {
        assertThatThrownBy(() -> moduleService.toggleModuleStatus("iam", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Системный модуль");

        assertThatThrownBy(() -> moduleService.toggleModuleStatus("tasks", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Системный модуль");
    }

    @Test
    @DisplayName("3. Прикладной модуль может быть отключен и повторно включен")
    void applicationModuleCanBeToggled() {
        var disabled = moduleService.toggleModuleStatus("notes", false);
        assertThat(disabled.status()).isEqualTo("DISABLED");

        var activeAfterDisable = moduleService.getActiveModules();
        assertThat(activeAfterDisable.stream().map(ModuleRegistryService.InstalledModuleView::code))
                .doesNotContain("notes");

        var enabled = moduleService.toggleModuleStatus("notes", true);
        assertThat(enabled.status()).isEqualTo("ACTIVE");

        var activeAfterEnable = moduleService.getActiveModules();
        assertThat(activeAfterEnable.stream().map(ModuleRegistryService.InstalledModuleView::code))
                .contains("notes");
    }

    @Test
    @DisplayName("4. Динамическая регистрация нового модуля через реестр")
    void registerNewCustomModule() {
        var registered = moduleService.registerModule(
                "inventory", "Управление складом", "Учет товаров и остатков",
                "1.0.0", "package", "/inventory", false, 150, Map.of("currency", "USD")
        );

        assertThat(registered.code()).isEqualTo("inventory");
        assertThat(registered.status()).isEqualTo("ACTIVE");
        assertThat(registered.name()).isEqualTo("Управление складом");

        var found = moduleService.getModule("inventory");
        assertThat(found).isPresent();
        assertThat(found.get().attributes()).containsEntry("currency", "USD");
    }
}
