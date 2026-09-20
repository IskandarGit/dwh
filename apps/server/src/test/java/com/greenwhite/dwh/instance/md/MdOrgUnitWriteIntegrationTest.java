package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.config.error.GlobalExceptionHandler;
import com.greenwhite.dwh.instance.md.controller.MdOrgUnitController;
import com.greenwhite.dwh.instance.md.repository.*;
import com.greenwhite.dwh.instance.md.service.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.interceptor.TransactionProxyFactoryBean;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** All writes run against a synthetic PostgreSQL database with actual transaction boundaries. */
@Testcontainers
class MdOrgUnitWriteIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("org_write_test").withUsername("test_user").withPassword("test_pass");
    static final AtomicInteger sequence = new AtomicInteger();
    static JdbcClient jdbc;
    static DataSourceTransactionManager transactions;
    static TransactionTemplate transaction;
    static MdOrgUnitRepository units;
    static MdScopeRepository scopes;
    static MdRoleRepository roles;
    static MdScopeService scopeService;
    static MdOrgUnitService orgUnitService;
    static MdRoleService roleService;
    static MdPermissionService permissions;
    static AuditLogService audit;
    static MockMvc mvc;
    static Long root;

    @BeforeAll
    static void setup() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(ds)
                .locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);
        transactions = new DataSourceTransactionManager(ds);
        transaction = new TransactionTemplate(transactions);
        units = new MdOrgUnitRepository(jdbc);
        scopes = new MdScopeRepository(jdbc);
        roles = new MdRoleRepository(jdbc);
        permissions = new MdPermissionService(new MdPermissionRepository(jdbc));
        audit = new AuditLogService(new AuditLogRepository(jdbc, new ObjectMapper()), null, new AuditDataRedactor());
        scopeService = proxy(new MdScopeService(scopes, units, permissions, audit));
        orgUnitService = proxy(new MdOrgUnitService(units, scopeService, audit));
        roleService = proxy(new MdRoleService(roles, permissions, audit, scopes));
        mvc = MockMvcBuilders.standaloneSetup(new MdOrgUnitController(orgUnitService, scopeService))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        root = orgUnitService.create(null, "HQ", "Company", "company", 0).id();
    }

    @Test
    void movingChildRecalculatesOldAndNewAncestorsExactlyOnce() {
        Long oldParent = unit(root), newParent = unit(root), otherParent = unit(root);
        Long child = unit(oldParent), grandchild = unit(child);
        Long oldManager = manager(oldParent), newManager = manager(newParent), otherManager = manager(otherParent);
        Long overlappingManager = manager(oldParent), descendantManager = manager(grandchild);
        scopeService.assignUserOrgUnits(overlappingManager, List.of(oldParent, newParent, child));
        long overlappingVersion = version(overlappingManager), descendantVersion = version(descendantManager);
        long oldVersion = version(oldManager), newVersion = version(newManager), otherVersion = version(otherManager);
        assertThat(scopeService.getUserScope(oldManager).visibleOrgUnitIds()).contains(child, grandchild);

        transaction.executeWithoutResult(s -> orgUnitService.update(child, newParent, null, null, null, null));

        assertThat(scopeService.getUserScope(oldManager).visibleOrgUnitIds()).containsExactly(oldParent);
        assertThat(scopeService.getUserScope(newManager).visibleOrgUnitIds()).containsExactlyInAnyOrder(newParent, child, grandchild);
        assertThat(version(oldManager)).isEqualTo(oldVersion + 1);
        assertThat(version(newManager)).isEqualTo(newVersion + 1);
        assertThat(version(otherManager)).isEqualTo(otherVersion);
        assertThat(version(overlappingManager)).isEqualTo(overlappingVersion + 1);
        assertThat(version(descendantManager)).isEqualTo(descendantVersion + 1);
    }

    @Test
    void creatingDeletingAndTogglingChildRefreshesAncestorScope() {
        Long parent = unit(root), manager = manager(parent);
        long before = version(manager);
        Long child = unit(parent);
        assertThat(scopeService.getUserScope(manager).visibleOrgUnitIds()).contains(child);
        assertThat(version(manager)).isEqualTo(before + 1);
        orgUnitService.update(child, parent, null, null, "P", null);
        assertThat(scopeService.getUserScope(manager).visibleOrgUnitIds()).doesNotContain(child);
        orgUnitService.update(child, parent, null, null, "A", null);
        assertThat(scopeService.getUserScope(manager).visibleOrgUnitIds()).contains(child);
        orgUnitService.delete(child);
        assertThat(scopeService.getUserScope(manager).visibleOrgUnitIds()).containsExactly(parent);
        assertThat(version(manager)).isEqualTo(before + 4);
    }

    @Test
    void roleActivationAndDeactivationRecalculateWidestScope() {
        Long parent = unit(root), child = unit(parent), user = manager(parent);
        Long role = roles.getUserRoleIds(user).getFirst();
        long before = version(user);
        roleService.updateRole(role, null, "P", null);
        assertThat(scopeService.getUserScope(user).rule()).isEqualTo("ALL");
        assertThat(scopeService.getUserScope(user).visibleOrgUnitIds()).isEmpty();
        roleService.updateRole(role, null, "A", null);
        assertThat(scopeService.getUserScope(user).rule()).isEqualTo("SUBTREE");
        assertThat(scopeService.getUserScope(user).visibleOrgUnitIds()).containsExactlyInAnyOrder(parent, child);
        assertThat(version(user)).isEqualTo(before + 2);
    }

    @Test
    void sparsePatchPreservesParentExplicitParentMovesAndNullConflicts() throws Exception {
        Long parent = unit(root), destination = unit(root), child = unit(parent);
        mvc.perform(patch("/api/v1/iam/org-units/{id}", child).contentType("application/json")
                        .content("{\"name\":\" Renamed \",\"orderNo\":-2147483648}"))
                .andExpect(status().isNoContent());
        assertThat(units.findById(child).orElseThrow().parentId()).isEqualTo(parent);
        assertThat(units.findById(child).orElseThrow().name()).isEqualTo("Renamed");
        assertThat(units.findById(child).orElseThrow().orderNo()).isEqualTo(Integer.MIN_VALUE);
        assertThat(jdbc.sql("select new_row ->> 'parent_id' from audit_log where table_name = 'md_org_units' and row_pk = :id and event = 'U' order by id desc limit 1")
                .param("id", child.toString()).query(String.class).single()).isEqualTo(parent.toString());
        mvc.perform(patch("/api/v1/iam/org-units/{id}", child).contentType("application/json")
                        .content("{\"parentId\":" + destination + "}"))
                .andExpect(status().isNoContent());
        assertThat(units.findById(child).orElseThrow().parentId()).isEqualTo(destination);
        assertThat(jdbc.sql("select new_row ->> 'parent_id' from audit_log where table_name = 'md_org_units' and row_pk = :id and event = 'U' order by id desc limit 1")
                .param("id", child.toString()).query(String.class).single()).isEqualTo(destination.toString());
        mvc.perform(patch("/api/v1/iam/org-units/{id}", child).contentType("application/json")
                        .content("{\"parentId\":null}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("conflict"));
        assertThat(units.findById(child).orElseThrow().parentId()).isEqualTo(destination);
    }

    @Test
    void invalidPatchInputsReturnControlledErrorsWithoutWriting() throws Exception {
        Long child = unit(root);
        var before = units.findById(child).orElseThrow();
        for (String body : List.of("{\"name\":\"  \"}", "{\"name\":\"\\b\"}",
                "{\"state\":\"invalid\"}", "{\"state\":\"\"}", "{\"kind\":\"  \"}", "{\"parentId\":0}")) {
            mvc.perform(patch("/api/v1/iam/org-units/{id}", child).contentType("application/json").content(body))
                    .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("validation_failed"));
        }
        mvc.perform(patch("/api/v1/iam/org-units/0").contentType("application/json").content("{}"))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(patch("/api/v1/iam/org-units/99999999").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch("/api/v1/iam/org-units/{id}", child).contentType("application/json")
                        .content("{\"parentId\":99999999}"))
                .andExpect(status().isNotFound());
        assertThat(units.findById(child).orElseThrow()).isEqualTo(before);
    }

    @Test
    void createNormalizesFieldsAndRejectsDuplicateOrInvalidCode() throws Exception {
        String code = "code-" + sequence.incrementAndGet();
        mvc.perform(post("/api/v1/iam/org-units").contentType("application/json")
                        .content("{\"parentId\":" + root + ",\"code\":\" " + code + " \",\"name\":\" Child \",\"kind\":\" team \",\"orderNo\":0}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.name").value("Child")).andExpect(jsonPath("$.kind").value("team"));
        mvc.perform(post("/api/v1/iam/org-units").contentType("application/json")
                        .content("{\"parentId\":" + root + ",\"code\":\"" + code + "\",\"name\":\"Child\",\"orderNo\":0}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("conflict"));
        for (String badCode : List.of("  ", "\\b")) {
            mvc.perform(post("/api/v1/iam/org-units").contentType("application/json")
                            .content("{\"parentId\":" + root + ",\"code\":\"" + badCode + "\",\"name\":\"Child\",\"orderNo\":0}"))
                    .andExpect(status().isUnprocessableEntity());
        }
    }

    @Test
    void occupiedNodesCannotBeDeleted() throws Exception {
        Long parent = unit(root), child = unit(parent), explicit = manager(child), legacy = unit(root);
        jdbc.sql("update md_users set org_unit_id = :unit where id = :user")
                .param("unit", legacy).param("user", explicit).update();
        for (Long id : List.of(parent, child, legacy)) {
            mvc.perform(delete("/api/v1/iam/org-units/{id}", id)).andExpect(status().isConflict());
            assertThat(units.findById(id)).isPresent();
        }
    }

    @Test
    void rootAndCycleGuardsReturnConflictsAndRootCanBePatched() throws Exception {
        Long parent = unit(root), child = unit(parent);
        for (Long[] move : List.of(new Long[]{parent, parent}, new Long[]{parent, child}, new Long[]{root, child})) {
            mvc.perform(patch("/api/v1/iam/org-units/{id}", move[0]).contentType("application/json")
                            .content("{\"parentId\":" + move[1] + "}"))
                    .andExpect(status().isConflict());
        }
        mvc.perform(patch("/api/v1/iam/org-units/{id}", root).contentType("application/json")
                        .content("{\"parentId\":null,\"name\":\"Company\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/iam/org-units").contentType("application/json")
                        .content("{\"parentId\":null,\"code\":\"SECOND-HQ\",\"name\":\"Second\",\"orderNo\":0}"))
                .andExpect(status().isConflict());
        assertThat(units.findById(root).orElseThrow().parentId()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"tree-create", "tree-update", "tree-delete", "unit-assignment", "role-rule",
            "role-create", "role-update", "role-delete", "assign-roles", "user-create", "user-update"})
    void scopeWritersWaitForMutationLockBeforeTakingRowWriteLocks(String operation) throws Exception {
        Long node = unit(root), user = manager(node), role = roles.getUserRoleIds(user).getFirst();
        Long unusedRole = roleService.createRole("unused-" + sequence.incrementAndGet(), 0).id();
        var users = new MdUserRepository(jdbc, new ObjectMapper());
        var assignments = proxy(new MdAssignmentService(users, roles, new MdPermissionRepository(jdbc),
                permissions, scopeService, audit));
        var userService = proxy(new MdUserService(users, roles, mock(MdCustomFieldService.class),
                mock(PasswordHasher.class), mock(PasswordValidator.class), mock(UserSessionInvalidator.class),
                mock(com.greenwhite.dwh.instance.search.SearchChangePublisher.class), audit, scopeService));
        Long emptyNode = unit(root);
        var started = new CountDownLatch(1);
        var backendPid = new AtomicInteger();
        var result = new AtomicReference<Future<?>>();
        try (var executor = Executors.newSingleThreadExecutor()) {
            transaction.executeWithoutResult(holder -> {
                jdbc.sql("select pg_advisory_xact_lock(129632, 1)").query((rs, row) -> true).single();
                result.set(executor.submit(() -> transaction.executeWithoutResult(writer -> {
                    backendPid.set(jdbc.sql("select pg_backend_pid()").query(Integer.class).single());
                    started.countDown();
                    switch (operation) {
                        case "tree-create" -> unit(root);
                        case "tree-update" -> orgUnitService.update(node, root, "Updated", null, null, null);
                        case "tree-delete" -> orgUnitService.delete(emptyNode);
                        case "unit-assignment" -> scopeService.assignUserOrgUnits(user, List.of(emptyNode));
                        case "role-rule" -> scopeService.setRoleRule(role, "SELF");
                        case "role-create" -> roleService.createRole("new-" + sequence.incrementAndGet(), 0);
                        case "role-update" -> roleService.updateRole(role, null, "P", null);
                        case "role-delete" -> roleService.deleteRole(unusedRole);
                        case "assign-roles" -> assignments.assignRoles(user, List.of(unusedRole));
                        case "user-create" -> {
                            String login = "new-user-" + sequence.incrementAndGet();
                            userService.createUser(login, login, login + "@test.invalid", null, null, null,
                                    "ru", "UTC", null, java.util.Map.of(), false, List.of(role), null);
                        }
                        case "user-update" -> userService.updateUser(user, "Updated", null, null, null, null,
                                null, null, null, List.of(unusedRole), null);
                        default -> throw new AssertionError(operation);
                    }
                })));
                await(started);
                long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
                boolean waiting = false;
                while (!result.get().isDone() && System.nanoTime() < deadline) {
                    waiting = jdbc.sql("select exists(select 1 from pg_locks where pid = :pid and locktype = 'advisory' and not granted)")
                            .param("pid", backendPid.get()).query(Boolean.class).single();
                    if (waiting) break;
                }
                assertThat(waiting).as(operation + " waits for shared scope writer lock").isTrue();
                assertThat(jdbc.sql("select count(*) from pg_locks where pid = :pid and mode = 'RowExclusiveLock' and granted")
                        .param("pid", backendPid.get()).query(Long.class).single())
                        .as(operation + " has not changed source rows before acquiring the mutation lock").isZero();
            });
            result.get().get(10, TimeUnit.SECONDS);
        }
    }

    @Test
    void auditFailureRollsBackMoveScopesAndPermissionVersions() {
        Long oldParent = unit(root), newParent = unit(root), child = unit(oldParent);
        Long oldManager = manager(oldParent), newManager = manager(newParent);
        var beforeUnit = units.findById(child);
        var oldScope = scopeService.getUserScope(oldManager);
        var newScope = scopeService.getUserScope(newManager);
        long oldVersion = version(oldManager), newVersion = version(newManager);
        var failingAudit = mock(AuditLogService.class);
        doThrow(new IllegalStateException("synthetic audit failure")).when(failingAudit)
                .logChange(anyString(), anyString(), anyString(), anyList(), any(), any());
        var failingService = proxy(new MdOrgUnitService(units, scopeService, failingAudit));

        assertThatThrownBy(() -> failingService.update(child, newParent, "Rollback", null, null, null))
                .isInstanceOf(IllegalStateException.class).hasMessage("synthetic audit failure");
        assertThat(units.findById(child)).isEqualTo(beforeUnit);
        assertThat(scopeService.getUserScope(oldManager)).isEqualTo(oldScope);
        assertThat(scopeService.getUserScope(newManager)).isEqualTo(newScope);
        assertThat(version(oldManager)).isEqualTo(oldVersion);
        assertThat(version(newManager)).isEqualTo(newVersion);
    }

    @Test
    void opposingConcurrentMovesSerializeAndLeaveAnAcyclicTree() throws Exception {
        Long a = unit(root), b = unit(root);
        var firstMoved = new CountDownLatch(1);
        var releaseFirst = new CountDownLatch(1);
        var secondStarted = new CountDownLatch(1);
        var secondPid = new AtomicInteger();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> transaction.execute(s -> {
                orgUnitService.update(a, b, null, null, null, null);
                firstMoved.countDown();
                await(releaseFirst);
                return "success";
            }));
            try {
                assertThat(firstMoved.await(10, TimeUnit.SECONDS)).isTrue();
                var second = executor.submit(() -> {
                    try {
                        transaction.executeWithoutResult(s -> {
                            secondPid.set(jdbc.sql("select pg_backend_pid()").query(Integer.class).single());
                            secondStarted.countDown();
                            orgUnitService.update(b, a, null, null, null, null);
                        });
                        return "success";
                    } catch (ApiException e) {
                        assertThat(e.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
                        return "conflict";
                    }
                });
                assertThat(secondStarted.await(10, TimeUnit.SECONDS)).isTrue();
                long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
                boolean waiting = false;
                while (!second.isDone() && System.nanoTime() < deadline) {
                    waiting = jdbc.sql("select exists(select 1 from pg_locks where pid = :pid and locktype = 'advisory' and not granted)")
                            .param("pid", secondPid.get()).query(Boolean.class).single();
                    if (waiting) break;
                }
                releaseFirst.countDown();
                assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo("success");
                assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo("conflict");
                assertThat(waiting).as("second transaction waited for the database mutation lock").isTrue();
            } finally {
                releaseFirst.countDown();
            }
        }
        assertThat(units.findById(a).orElseThrow().parentId()).isEqualTo(b);
        assertThat(units.findById(b).orElseThrow().parentId()).isEqualTo(root);
    }

    static Long unit(Long parent) {
        String code = "node-" + sequence.incrementAndGet();
        return orgUnitService.create(parent, code, code, "department", 0).id();
    }

    static Long manager(Long unit) {
        return transaction.execute(s -> {
            String login = "manager-" + sequence.incrementAndGet();
            Long user = jdbc.sql("insert into md_users (name, login, email, state) values (:login, :login, :login || '@test.invalid', 'A') returning id")
                    .param("login", login).query(Long.class).single();
            Long role = roleService.createRole(login, 0).id();
            scopeService.setRoleRule(role, "SUBTREE");
            roles.assignRolesToUser(user, List.of(role));
            scopeService.assignUserOrgUnits(user, List.of(unit));
            return user;
        });
    }

    static long version(Long user) { return permissions.getPermissionVersion(user); }

    static void await(CountDownLatch latch) {
        try {
            if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("latch timed out");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    @SuppressWarnings("unchecked")
    static <T> T proxy(T target) {
        var factory = new TransactionProxyFactoryBean();
        factory.setTarget(target);
        factory.setProxyTargetClass(true);
        factory.setTransactionManager(transactions);
        var attributes = new Properties();
        attributes.setProperty("*", "PROPAGATION_REQUIRED");
        factory.setTransactionAttributes(attributes);
        factory.afterPropertiesSet();
        return (T) factory.getObject();
    }
}
