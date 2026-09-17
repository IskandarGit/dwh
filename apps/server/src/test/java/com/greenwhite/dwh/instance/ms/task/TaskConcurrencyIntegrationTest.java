package com.greenwhite.dwh.instance.ms.task;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.config.error.GlobalExceptionHandler;
import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.security.RequiresPermissionInterceptor;
import com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository;
import com.greenwhite.dwh.instance.md.repository.MdPermissionRepository;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdScopeRepository;
import com.greenwhite.dwh.instance.md.service.MdCustomFieldService;
import com.greenwhite.dwh.instance.md.service.MdPermissionService;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.ms.task.controller.MsTaskController;
import com.greenwhite.dwh.instance.ms.task.pref.MsTaskPref;
import com.greenwhite.dwh.instance.ms.task.repository.MsProjectRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskMemberRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskStatusRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskTypeRepository;
import com.greenwhite.dwh.instance.ms.task.service.MsTaskService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.interceptor.TransactionProxyFactoryBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers
class TaskConcurrencyIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("task_concurrency_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    static JdbcClient jdbc;
    static DriverManagerDataSource dataSource;
    static MsTaskRepository taskRepository;
    static MsTaskStatusRepository statusRepository;
    static KauthSessionRepository sessionRepository;
    static KauthApiTokenRepository apiTokenRepository;
    static MdScopeRepository scopeRepository;
    static MdRoleRepository roles;
    static MdScopeService scopes;
    static MockMvc mvc;
    static Long testUserId;
    static Long rootUnit;

    @BeforeAll
    static void setup() {
        dataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(dataSource);
        var transactions = new DataSourceTransactionManager(dataSource);
        var objectMapper = new ObjectMapper();

        taskRepository = new MsTaskRepository(jdbc, objectMapper);
        statusRepository = new MsTaskStatusRepository(jdbc);
        sessionRepository = new KauthSessionRepository(jdbc);
        apiTokenRepository = new KauthApiTokenRepository(jdbc);

        var audit = new AuditLogService(
                new AuditLogRepository(jdbc, objectMapper), null, new AuditDataRedactor());
        scopeRepository = new MdScopeRepository(jdbc);
        roles = new MdRoleRepository(jdbc);
        scopes = new MdScopeService(
                scopeRepository,
                new MdOrgUnitRepository(jdbc),
                new MdPermissionService(new MdPermissionRepository(jdbc)),
                audit);

        var taskServiceTarget = new MsTaskService(
                taskRepository,
                statusRepository,
                new MsTaskTypeRepository(jdbc),
                new MsTaskMemberRepository(jdbc),
                new MsProjectRepository(jdbc, objectMapper),
                mock(MdCustomFieldService.class),
                scopes,
                mock(MfFileService.class),
                mock(ApplicationEventPublisher.class),
                mock(com.greenwhite.dwh.instance.search.SearchChangePublisher.class),
                audit);
        MsTaskService taskService = transactional(taskServiceTarget, transactions, MsTaskService.class);

        mvc = MockMvcBuilders.standaloneSetup(new MsTaskController(taskService))
                .addInterceptors(new RequiresPermissionInterceptor())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        rootUnit = orgUnit(null, "root");
        testUserId = user("ConcurrencyActor", rootUnit);
        assignScope(testUserId, "ALL", List.of());
    }

    @AfterEach
    void cleanup() {
        SecurityContext.clear();
    }

    @Test
    void p02_duplicateIndexesAreDropped() {
        List<String> indexes = jdbc.sql("""
                select indexname from pg_indexes
                where schemaname = 'public' and tablename = 'ms_tasks'
                """)
                .query(String.class)
                .list();

        assertThat(indexes).doesNotContain("idx_ms_tasks_status_id");
        assertThat(indexes).doesNotContain("idx_ms_tasks_project_id");

        assertThat(indexes).contains("ms_tasks_status_idx");
        assertThat(indexes).contains("ms_tasks_project_idx");
    }

    @Test
    void p01_kauthSessionActivityCoalescing() {
        Long user = user("SessionUser", rootUnit);
        var session = sessionRepository.create(user, 0L, "hash-" + SEQUENCE.incrementAndGet(), "127.0.0.1", "agent", "desktop");

        Instant initialSeen = session.lastSeenAt();

        // Immediate touch within 60s -> should be coalesced (0 rows updated)
        sessionRepository.updateLastSeen(session.id());
        var fetched = sessionRepository.findActiveById(session.id()).orElseThrow();
        assertThat(fetched.lastSeenAt()).isEqualTo(initialSeen);

        // Age session past 60s
        jdbc.sql("update kauth_sessions set last_seen_at = now() - interval '65 seconds' where id = :id")
                .param("id", session.id())
                .update();

        // Touch after 65s -> should update last_seen_at
        sessionRepository.updateLastSeen(session.id());
        var updated = sessionRepository.findActiveById(session.id()).orElseThrow();
        assertThat(updated.lastSeenAt()).isAfter(initialSeen);
    }

    @Test
    void p01_kauthApiTokenActivityCoalescing() {
        Long user = user("TokenUser", rootUnit);
        var token = apiTokenRepository.create(user, 0L, "Token " + SEQUENCE.incrementAndGet(), "dwh_", "hash-" + SEQUENCE.incrementAndGet(), null);

        assertThat(token.lastUsedAt()).isNull();

        // First touch initializes last_used_at
        apiTokenRepository.updateLastUsed(token.id());
        var firstTouch = apiTokenRepository.findActiveById(token.id()).orElseThrow();
        Instant initialUsed = firstTouch.lastUsedAt();
        assertThat(initialUsed).isNotNull();

        // Immediate touch within 60s -> coalesced (no change)
        apiTokenRepository.updateLastUsed(token.id());
        var fetched = apiTokenRepository.findActiveById(token.id()).orElseThrow();
        assertThat(fetched.lastUsedAt()).isEqualTo(initialUsed);

        // Age token past 60s
        jdbc.sql("update kauth_api_tokens set last_used_at = now() - interval '65 seconds' where id = :id")
                .param("id", token.id())
                .update();

        // Touch after 65s -> should update last_used_at
        apiTokenRepository.updateLastUsed(token.id());
        var updated = apiTokenRepository.findActiveById(token.id()).orElseThrow();
        assertThat(updated.lastUsedAt()).isAfter(initialUsed);
    }

    @Test
    void a03_taskRevisionOptimisticConcurrencyControl_repository() {
        statusRepository.initDefaultStatusesIfEmpty();
        var defaultStatus = statusRepository.findByPcode(MsTaskPref.STATUS_NEW).orElseThrow();

        // 1. Create task has monotonic revision = 1
        var task = taskRepository.create(new MsTaskRepository.TaskCreateData(
                null, null, "OCC Task", "Description",
                defaultStatus.id(), "medium", testUserId, Map.of(), null, null
        ), testUserId);

        assertThat(task.revision()).isEqualTo(1L);

        // 2. Matching expectedRevision updates revision to 2
        taskRepository.update(task.id(), new MsTaskRepository.TaskUpdateData(
                null, "OCC Task Updated", "Description", defaultStatus.id(), "high", null, Map.of(), null, null, null, 1L
        ), testUserId);

        var current = taskRepository.findById(task.id()).orElseThrow();
        assertThat(current.revision()).isEqualTo(2L);
        assertThat(current.title()).isEqualTo("OCC Task Updated");

        // 3. Stale expectedRevision (1L vs current 2L) throws TASK_REVISION_CONFLICT
        assertThatThrownBy(() -> taskRepository.update(task.id(), new MsTaskRepository.TaskUpdateData(
                null, "Stale OCC Task", "Description", defaultStatus.id(), "low", null, Map.of(), null, null, null, 1L
        ), testUserId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.TASK_REVISION_CONFLICT));

        // 4. Stale status transition throws TASK_REVISION_CONFLICT
        assertThatThrownBy(() -> taskRepository.updateStatus(task.id(), defaultStatus.id(), null, 1L, testUserId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.TASK_REVISION_CONFLICT));

        // 5. Matching status transition increments revision to 3
        taskRepository.updateStatus(task.id(), defaultStatus.id(), null, 2L, testUserId);
        current = taskRepository.findById(task.id()).orElseThrow();
        assertThat(current.revision()).isEqualTo(3L);

        // 6. Omitted expectedRevision increments revision without conflict (backward compatibility)
        taskRepository.update(task.id(), new MsTaskRepository.TaskUpdateData(
                null, "No Expected Revision", null, null, null, null, null, null, null, null
        ), testUserId);
        current = taskRepository.findById(task.id()).orElseThrow();
        assertThat(current.revision()).isEqualTo(4L);
        assertThat(current.title()).isEqualTo("No Expected Revision");

        taskRepository.updateStatus(task.id(), defaultStatus.id(), null, null, testUserId);
        current = taskRepository.findById(task.id()).orElseThrow();
        assertThat(current.revision()).isEqualTo(5L);
    }

    @Test
    void a03_taskRevisionOptimisticConcurrencyControl_httpApi() throws Exception {
        statusRepository.initDefaultStatusesIfEmpty();
        var defaultStatus = statusRepository.findByPcode(MsTaskPref.STATUS_NEW).orElseThrow();
        var inProgressStatus = statusRepository.findByPcode(MsTaskPref.STATUS_IN_PROGRESS).orElseThrow();

        var task = taskRepository.create(new MsTaskRepository.TaskCreateData(
                null, null, "HTTP OCC Task", "Description",
                defaultStatus.id(), "medium", testUserId, Map.of(), null, null
        ), testUserId);

        signIn(testUserId);

        // 1. PATCH with matching expectedRevision = 1 -> 204 No Content
        mvc.perform(patch("/api/v1/tasks/{id}", task.id())
                        .contentType("application/json")
                        .content("""
                                {
                                    "title": "HTTP OCC Updated",
                                    "expectedRevision": 1
                                }
                                """))
                .andExpect(status().isNoContent());

        var fetched = taskRepository.findById(task.id()).orElseThrow();
        assertThat(fetched.revision()).isEqualTo(2L);
        assertThat(fetched.title()).isEqualTo("HTTP OCC Updated");

        // 2. Concurrent/stale PATCH with expectedRevision = 1 -> 409 Conflict
        mvc.perform(patch("/api/v1/tasks/{id}", task.id())
                        .contentType("application/json")
                        .content("""
                                {
                                    "title": "Stale HTTP Edit",
                                    "expectedRevision": 1
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("task_revision_conflict"));

        // 3. Status change with matching expectedRevision = 2 -> 204 No Content
        mvc.perform(post("/api/v1/tasks/{id}/status", task.id())
                        .contentType("application/json")
                        .content("""
                                {
                                    "statusId": %d,
                                    "expectedRevision": 2
                                }
                                """.formatted(inProgressStatus.id())))
                .andExpect(status().isNoContent());

        fetched = taskRepository.findById(task.id()).orElseThrow();
        assertThat(fetched.revision()).isEqualTo(3L);
        assertThat(fetched.statusId()).isEqualTo(inProgressStatus.id());

        // 4. Stale status change with expectedRevision = 2 -> 409 Conflict
        mvc.perform(post("/api/v1/tasks/{id}/status", task.id())
                        .contentType("application/json")
                        .content("""
                                {
                                    "statusId": %d,
                                    "expectedRevision": 2
                                }
                                """.formatted(defaultStatus.id())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("task_revision_conflict"));

        // 5. Omitted expectedRevision -> 204 No Content (revision increments to 4)
        mvc.perform(patch("/api/v1/tasks/{id}", task.id())
                        .contentType("application/json")
                        .content("""
                                {
                                    "title": "No OCC Header"
                                }
                                """))
                .andExpect(status().isNoContent());

        fetched = taskRepository.findById(task.id()).orElseThrow();
        assertThat(fetched.revision()).isEqualTo(4L);
        assertThat(fetched.title()).isEqualTo("No OCC Header");
    }

    private static Long user(String prefix, Long orgUnitId) {
        String login = (prefix + "-" + SEQUENCE.incrementAndGet()).toLowerCase();
        return jdbc.sql("""
                insert into md_users (name, login, email, password_hash, state, language, timezone,
                                      attributes, is_2fa_enabled, force_password_change, org_unit_id)
                values (:name, :login, :login || '@example.invalid', 'x', 'A', 'ru', 'UTC',
                        '{}', false, false, :orgUnitId)
                returning id
                """)
                .param("name", prefix)
                .param("login", login)
                .param("orgUnitId", orgUnitId)
                .query(Long.class)
                .single();
    }

    private static String login(Long userId) {
        return jdbc.sql("select login from md_users where id = :id")
                .param("id", userId).query(String.class).single();
    }

    private static Long orgUnit(Long parent, String code) {
        return jdbc.sql("""
                insert into md_org_units (parent_id, code, name, kind, state, order_no)
                values (:parent, :code, :name, 'department', 'A', 1) returning id
                """).param("parent", parent)
                .param("code", code + "-" + SEQUENCE.incrementAndGet())
                .param("name", code)
                .query(Long.class).single();
    }

    private static void assignScope(Long userId, String rule, List<Long> orgUnitIds) {
        var role = roles.create("Concurrency role " + rule + " " + SEQUENCE.incrementAndGet(), null, "A", 100);
        scopeRepository.setRoleRule(role.id(), rule);
        roles.assignRolesToUser(userId, List.of(role.id()));
        scopeRepository.replaceUserOrgUnits(userId, orgUnitIds);
        scopes.recalculateFor(userId);
    }

    private static void signIn(Long userId) {
        SecurityContext.setPrincipal(new SecurityContext.KauthPrincipal(
                userId, login(userId), login(userId) + "@example.invalid", 1000L,
                false, Set.of("*.*"), 1L, false, 0, null));
    }

    private static <T> T transactional(T target, DataSourceTransactionManager tx, Class<T> type) {
        var proxy = new TransactionProxyFactoryBean();
        proxy.setTarget(target);
        proxy.setProxyTargetClass(true);
        proxy.setTransactionManager(tx);
        var props = new Properties();
        props.setProperty("*", "PROPAGATION_REQUIRED");
        proxy.setTransactionAttributes(props);
        proxy.afterPropertiesSet();
        return type.cast(proxy.getObject());
    }
}
