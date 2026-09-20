package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * R6 (ремедиация): интеграционная проверка RBAC на PostgreSQL 18.
 * Результаты матрицы ТЗ-01 разд. 8.2 (блок PERM):
 * - системные роли соответствуют матрице разд. 4.4.1 (auditor — без единой мутации);
 * - каждый эндпоинт объявляет право, и это право существует в каталоге (FR-PERM-8/FR-PERM-1);
 * - выдача/отзыв роли материализуют эффективные права и двигают permissions_version (FR-PERM-6).
 */
@Testcontainers
class RbacSystemRolesIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_rbac_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;

    @BeforeAll
    static void migrate() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);
    }

    // ------------------------------------------------------------------
    // FR-PERM-8 + FR-PERM-1: контроллеры ↔ каталог
    // ------------------------------------------------------------------

    /**
     * Контроллеры вне матрицы прав. Исключение допустимо только если эндпоинт
     * не отдаёт данных экземпляра: иначе право обязано быть объявлено (FR-PERM-8).
     * Список закрытый — новый контроллер сюда не добавляется без обоснования.
     */
    private static final Set<String> PUBLIC_CONTROLLER_ALLOWLIST = Set.of(
            "KauthAuthController",   // публичный/сессионный контур входа
            "KauthPasswordController", // смена собственного пароля — контур аутентификации (Д-7)
            "OpenApiController",     // спецификация API, permitAll в SecurityConfig
            "MdI18nController"       // публичные UI-словари, без данных экземпляра/пользователей
    );

    @Test
    @DisplayName("FR-PERM-8: каждый handler-метод объявляет право (кроме публичного auth-контура)")
    void everyEndpointDeclaresPermission() {
        List<String> unprotected = new ArrayList<>();
        for (Class<?> controller : findRestControllers()) {
            if (PUBLIC_CONTROLLER_ALLOWLIST.contains(controller.getSimpleName())) {
                continue;
            }
            for (Method m : controller.getDeclaredMethods()) {
                if (isHandler(m) && m.getAnnotation(RequiresPermission.class) == null
                        && controller.getAnnotation(RequiresPermission.class) == null) {
                    unprotected.add(controller.getSimpleName() + "." + m.getName());
                }
            }
        }
        assertThat(unprotected)
                .as("Эндпоинты без @RequiresPermission (FR-PERM-8): %s", unprotected)
                .isEmpty();
    }

    @Test
    @DisplayName("FR-PERM-1: каждая объявленная пара (form, action) существует в каталоге БД")
    void everyDeclaredPermissionExistsInCatalog() {
        Set<String> catalog = new HashSet<>(jdbc
                .sql("select form_code || ':' || action from md_form_actions")
                .query(String.class).list());

        List<String> missing = new ArrayList<>();
        for (Class<?> controller : findRestControllers()) {
            for (Method m : controller.getDeclaredMethods()) {
                RequiresPermission rp = m.getAnnotation(RequiresPermission.class);
                if (rp != null && !catalog.contains(rp.form() + ":" + rp.action())) {
                    missing.add(rp.form() + ":" + rp.action() + " (" + controller.getSimpleName() + ")");
                }
            }
        }
        assertThat(missing)
                .as("Права из аннотаций, отсутствующие в каталоге: %s", missing)
                .isEmpty();
    }

    // ------------------------------------------------------------------
    // FR-PERM-12: матрица системных ролей (ТЗ-01 разд. 4.4.1)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Все четыре системные роли созданы")
    void systemRolesExist() {
        List<String> pcodes = jdbc.sql("select pcode from md_roles where pcode is not null order by pcode")
                .query(String.class).list();
        // [допущение] И1: pcode есть и у ролей экземпляра (V110), поэтому contains, а не точное равенство
        assertThat(pcodes).contains("admin", "manager", "auditor", "user");
    }

    @Test
    @DisplayName("admin покрывает 100% пар каталога (I-P4)")
    void adminCoversWholeCatalog() {
        Long uncovered = jdbc.sql("""
                select count(*) from md_form_actions fa
                where not exists (
                    select 1 from md_role_permissions rp
                    join md_roles r on r.id = rp.role_id and r.pcode = 'admin'
                    where rp.form_code = fa.form_code and rp.action = fa.action)
                """).query(Long.class).single();
        assertThat(uncovered).isZero();
    }

    @Test
    @DisplayName("auditor не имеет НИ ОДНОГО мутирующего действия — только view")
    void auditorHasNoMutatingPermissions() {
        List<String> mutating = jdbc.sql("""
                select rp.form_code || ':' || rp.action
                from md_role_permissions rp
                join md_roles r on r.id = rp.role_id
                where r.pcode = 'auditor' and rp.action <> 'view'
                """).query(String.class).list();
        assertThat(mutating)
                .as("Мутирующие права у auditor (запрещено определением роли): %s", mutating)
                .isEmpty();
        // и при этом просмотр у него не пустой
        Long views = jdbc.sql("""
                select count(*) from md_role_permissions rp
                join md_roles r on r.id = rp.role_id where r.pcode = 'auditor'
                """).query(Long.class).single();
        assertThat(views).isGreaterThan(5);
    }

    @Test
    @DisplayName("user: базовый набор есть, чужого (пользователи/роли/аудит) — нет")
    void userRoleMatchesMatrix() {
        Set<String> perms = new HashSet<>(jdbc.sql("""
                select rp.form_code || ':' || rp.action
                from md_role_permissions rp
                join md_roles r on r.id = rp.role_id where r.pcode = 'user'
                """).query(String.class).list());
        assertThat(perms).contains("tasks.items:view", "tasks.items:create",
                "iam.profile:view", "platform.search:view", "notify.inbox:view");
        assertThat(perms).noneMatch(p -> p.startsWith("iam.users:")
                || p.startsWith("rbac.") || p.startsWith("audit.")
                || p.startsWith("platform.settings") || p.startsWith("platform.webhooks"));
    }

    // ------------------------------------------------------------------
    // FR-PERM-6: выдача/отзыв → эффективные права + версия
    // ------------------------------------------------------------------

    @Test
    @DisplayName("Выдача роли материализует права; отзыв — очищает; версия растёт")
    void grantAndRevokeMaterializeEffectivePermissions() {
        Long userId = jdbc.sql("""
                        insert into md_users (name, login, email, password_hash, state, language, timezone,
                                              attributes, is_2fa_enabled, force_password_change)
                        values ('RBAC Test', 'rbac_test', 'rbac@test.local', 'x', 'A', 'ru', 'UTC',
                                '{}'::jsonb, false, false)
                        returning id
                        """).query(Long.class).single();
        Long roleId = jdbc.sql("select id from md_roles where pcode = 'user'").query(Long.class).single();

        var repo = new com.greenwhite.dwh.instance.md.repository.MdPermissionRepository(jdbc);
        jdbc.sql("insert into md_user_roles (user_id, role_id) values (:u, :r)")
                .param("u", userId).param("r", roleId).update();
        repo.recalculateEffectivePermissions(userId);

        Set<String> effective = repo.getEffectivePermissionsForUser(userId);
        assertThat(effective).contains("tasks.items.view");
        long v1 = repo.getPermissionVersion(userId);

        jdbc.sql("delete from md_user_roles where user_id = :u").param("u", userId).update();
        repo.recalculateEffectivePermissions(userId);

        assertThat(repo.getEffectivePermissionsForUser(userId)).isEmpty();
        assertThat(repo.getPermissionVersion(userId))
                .as("permissions_version обязан вырасти при пересчёте (I-P2)")
                .isGreaterThan(v1);
    }

    // ------------------------------------------------------------------
    // Инфраструктура сканирования
    // ------------------------------------------------------------------

    private static List<Class<?>> findRestControllers() {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        List<Class<?>> result = new ArrayList<>();
        for (var bd : scanner.findCandidateComponents("com.greenwhite.dwh.instance")) {
            try {
                Class<?> controller = Class.forName(bd.getBeanClassName());
                // Тестовые стенды (SecurityTestController и подобные) охраняют
                // выдуманные формы: в матрице прав приложения их быть не должно,
                // и держать их в списке исключений — лишний повод его редактировать.
                var source = controller.getProtectionDomain().getCodeSource();
                if (source != null && source.getLocation().getPath().contains("test-classes")) {
                    continue;
                }
                result.add(controller);
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException(e);
            }
        }
        assertThat(result).as("контроллеры должны находиться сканом").isNotEmpty();
        return result;
    }

    private static boolean isHandler(Method m) {
        return m.isAnnotationPresent(GetMapping.class) || m.isAnnotationPresent(PostMapping.class)
                || m.isAnnotationPresent(PutMapping.class) || m.isAnnotationPresent(PatchMapping.class)
                || m.isAnnotationPresent(DeleteMapping.class) || m.isAnnotationPresent(RequestMapping.class);
    }
}
