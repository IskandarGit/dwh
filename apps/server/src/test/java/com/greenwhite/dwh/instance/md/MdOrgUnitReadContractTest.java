package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository;
import com.greenwhite.dwh.instance.md.repository.MdPermissionRepository;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdScopeRepository;
import com.greenwhite.dwh.instance.md.service.MdPermissionService;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@Testcontainers
class MdOrgUnitReadContractTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_org_read_contract_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    private static JdbcClient jdbc;
    private static MdScopeService databaseService;
    private static MdScopeRepository databaseScopeRepository;
    private static MdRoleRepository databaseRoleRepository;
    private static MdPermissionService databasePermissionService;

    private MdScopeRepository scopeRepository;
    private MdOrgUnitRepository orgUnitRepository;
    private MdPermissionService permissionService;
    private AuditLogService auditLogService;
    private MdScopeService service;

    @BeforeAll
    static void setUpDatabase() {
        var dataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbc = JdbcClient.create(dataSource);

        databaseScopeRepository = new MdScopeRepository(jdbc);
        databaseRoleRepository = new MdRoleRepository(jdbc);
        databasePermissionService = new MdPermissionService(new MdPermissionRepository(jdbc));
        var databaseAuditService = new AuditLogService(
                new AuditLogRepository(jdbc, new ObjectMapper()), null, new AuditDataRedactor());
        databaseService = new MdScopeService(
                databaseScopeRepository,
                new MdOrgUnitRepository(jdbc),
                databasePermissionService,
                databaseAuditService);
    }

    @BeforeEach
    void setUp() {
        scopeRepository = mock(MdScopeRepository.class);
        orgUnitRepository = mock(MdOrgUnitRepository.class);
        permissionService = mock(MdPermissionService.class);
        auditLogService = mock(AuditLogService.class);
        service = new MdScopeService(scopeRepository, orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void userAssignmentsRemainExplicitAndSeparateFromLegacyAndEffectiveScope() {
        when(scopeRepository.userExists(42L)).thenReturn(true);
        when(scopeRepository.getUserOrgUnitIds(42L)).thenReturn(Set.of(7L, 3L));
        when(scopeRepository.findUserOrgUnit(42L)).thenReturn(Optional.of(9L));
        when(scopeRepository.getEffectiveScope(42L)).thenReturn(Set.of(3L, 4L, 7L));

        var result = service.getUserAssignments(42L);

        assertThat(result.userId()).isEqualTo(42L);
        assertThat(result.orgUnitIds()).containsExactly(3L, 7L);
        assertThat(result.legacyOrgUnitId()).isEqualTo(9L);
        verify(scopeRepository, never()).getEffectiveScope(42L);
        verify(scopeRepository, never()).replaceUserOrgUnits(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyList());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void existingRoleWithoutExplicitRuleReadsAsAllWithoutWritingADefault() {
        when(scopeRepository.roleExists(55L)).thenReturn(true);
        when(scopeRepository.getRoleRule(55L)).thenReturn(MdScopeService.RULE_ALL);

        var result = service.getRoleScopeRule(55L);

        assertThat(result.roleId()).isEqualTo(55L);
        assertThat(result.rule()).isEqualTo(MdScopeService.RULE_ALL);
        verify(scopeRepository, never()).setRoleRule(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void unknownUserAndRoleReadsReturnDomainNotFound() {
        when(scopeRepository.userExists(42L)).thenReturn(false);
        when(scopeRepository.roleExists(55L)).thenReturn(false);

        assertNotFound(() -> service.getUserAssignments(42L));
        assertNotFound(() -> service.getUserScope(42L));
        assertNotFound(() -> service.getRoleScopeRule(55L));

        verify(scopeRepository, never()).getUserOrgUnitIds(42L);
        verify(scopeRepository, never()).getUserRule(42L);
        verify(scopeRepository, never()).getRoleRule(55L);
    }

    @Test
    void readIdentifiersMustBePositiveBeforeRepositoryLookup() {
        for (Long invalid : new Long[]{null, 0L, -1L}) {
            assertValidation(() -> service.getUserAssignments(invalid));
            assertValidation(() -> service.getUserScope(invalid));
            assertValidation(() -> service.getRoleScopeRule(invalid));
        }

        verifyNoInteractions(scopeRepository, orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void nullAssignmentListIsRejectedBeforeAnyReplacement() {
        when(scopeRepository.userExists(42L)).thenReturn(true);

        assertValidation(() -> service.assignUserOrgUnits(42L, null));

        verify(scopeRepository, never()).replaceUserOrgUnits(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyList());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void nullZeroAndNegativeAssignmentIdentifiersAreRejectedBeforeReplacement() {
        when(scopeRepository.userExists(42L)).thenReturn(true);

        for (List<Long> invalid : List.of(
                java.util.Arrays.asList(7L, null),
                List.of(0L),
                List.of(-1L))) {
            assertValidation(() -> service.assignUserOrgUnits(42L, invalid));
        }

        verify(scopeRepository, never()).replaceUserOrgUnits(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyList());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void duplicateAssignmentsAreNormalizedAndSortedBeforeReplacement() {
        when(scopeRepository.userExists(42L)).thenReturn(true);
        when(orgUnitRepository.findById(anyLong())).thenReturn(
                Optional.of(mock(MdOrgUnitRepository.OrgUnitRecord.class)));
        when(scopeRepository.getUserOrgUnitIds(42L)).thenReturn(Set.of());

        service.assignUserOrgUnits(42L, List.of(7L, 3L, 7L));

        verify(scopeRepository).replaceUserOrgUnits(42L, List.of(3L, 7L));
    }

    @Test
    void explicitEmptyAssignmentListClearsAssignments() {
        when(scopeRepository.userExists(42L)).thenReturn(true);
        when(scopeRepository.getUserOrgUnitIds(42L)).thenReturn(Set.of(7L));

        service.assignUserOrgUnits(42L, List.of());

        verify(scopeRepository).replaceUserOrgUnits(42L, List.of());
    }

    @Test
    void unknownUserIsRejectedBeforeAssignmentReplacement() {
        when(scopeRepository.userExists(42L)).thenReturn(false);

        assertNotFound(() -> service.assignUserOrgUnits(42L, List.of()));

        verify(scopeRepository, never()).replaceUserOrgUnits(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyList());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void unknownRoleIsRejectedBeforeRuleDefaultOrWrite() {
        when(scopeRepository.roleExists(55L)).thenReturn(false);

        assertNotFound(() -> service.setRoleRule(55L, MdScopeService.RULE_UNITS));

        verify(scopeRepository, never()).getRoleRule(55L);
        verify(scopeRepository, never()).setRoleRule(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyString());
        verifyNoInteractions(orgUnitRepository, permissionService, auditLogService);
    }

    @Test
    void databaseReadsKeepDirectAssignmentsSeparateAndLeaveMaterializedStateAndVersionUntouched() {
        Long rootId = insertOrgUnit(null, "READ-HQ", "Read HQ");
        Long assignedId = insertOrgUnit(rootId, "READ-REGION", "Read region");
        Long descendantId = insertOrgUnit(assignedId, "READ-BRANCH", "Read branch");
        Long legacyId = insertOrgUnit(rootId, "READ-LEGACY", "Read legacy unit");
        Long userId = insertUser("org_read_contract", legacyId);
        Long roleId = databaseRoleRepository.create("Read contract subtree role", null, "A", 100).id();
        databaseScopeRepository.setRoleRule(roleId, MdScopeService.RULE_SUBTREE);
        databaseRoleRepository.assignRolesToUser(userId, List.of(roleId));
        databaseService.assignUserOrgUnits(userId, List.of(assignedId));

        List<Long> directBefore = directAssignments(userId);
        List<Long> effectiveBefore = effectiveAssignments(userId);
        String ruleBefore = materializedRule(userId);
        long versionBefore = databasePermissionService.getPermissionVersion(userId);

        var assignments = databaseService.getUserAssignments(userId);
        var scope = databaseService.getUserScope(userId);
        var roleRule = databaseService.getRoleScopeRule(roleId);

        assertThat(assignments.orgUnitIds()).containsExactly(assignedId);
        assertThat(assignments.orgUnitIds()).doesNotContain(descendantId, legacyId);
        assertThat(assignments.legacyOrgUnitId()).isEqualTo(legacyId);
        assertThat(scope.rule()).isEqualTo(MdScopeService.RULE_SUBTREE);
        assertThat(scope.visibleOrgUnitIds()).containsExactlyInAnyOrder(assignedId, descendantId);
        assertThat(roleRule.rule()).isEqualTo(MdScopeService.RULE_SUBTREE);

        assertThat(directAssignments(userId)).isEqualTo(directBefore);
        assertThat(effectiveAssignments(userId)).isEqualTo(effectiveBefore);
        assertThat(materializedRule(userId)).isEqualTo(ruleBefore);
        assertThat(databasePermissionService.getPermissionVersion(userId)).isEqualTo(versionBefore);
    }

    private static Long insertOrgUnit(Long parentId, String code, String name) {
        return jdbc.sql("""
                        insert into md_org_units (parent_id, code, name, kind, state, order_no)
                        values (:parentId, :code, :name, 'department', 'A', 10)
                        returning id
                        """)
                .param("parentId", parentId)
                .param("code", code)
                .param("name", name)
                .query(Long.class)
                .single();
    }

    private static Long insertUser(String login, Long legacyOrgUnitId) {
        return jdbc.sql("""
                        insert into md_users (name, login, email, password_hash, state, language, timezone,
                                              attributes, is_2fa_enabled, force_password_change, org_unit_id)
                        values (:login, :login, :login || '@test.local', 'x', 'A', 'ru', 'UTC',
                                '{}'::jsonb, false, false, :orgUnitId)
                        returning id
                        """)
                .param("login", login)
                .param("orgUnitId", legacyOrgUnitId)
                .query(Long.class)
                .single();
    }

    private static List<Long> directAssignments(Long userId) {
        return jdbc.sql("select org_unit_id from md_user_org_units where user_id = :userId order by org_unit_id")
                .param("userId", userId)
                .query(Long.class)
                .list();
    }

    private static List<Long> effectiveAssignments(Long userId) {
        return jdbc.sql("select org_unit_id from md_effective_scope where user_id = :userId order by org_unit_id")
                .param("userId", userId)
                .query(Long.class)
                .list();
    }

    private static String materializedRule(Long userId) {
        return jdbc.sql("select rule from md_user_scope where user_id = :userId")
                .param("userId", userId)
                .query(String.class)
                .single();
    }

    private static void assertNotFound(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(ApiException.class, error ->
                        assertThat(error.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    private static void assertValidation(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(ApiException.class, error ->
                        assertThat(error.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }
}
