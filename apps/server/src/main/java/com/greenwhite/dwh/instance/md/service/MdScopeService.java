package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.ScopeFilter;
import com.greenwhite.dwh.instance.md.dto.MdOrgUnitDtos.RoleRule;
import com.greenwhite.dwh.instance.md.dto.MdOrgUnitDtos.UserAssignments;
import com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository;
import com.greenwhite.dwh.instance.md.repository.MdScopeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Скоуп данных: кто какие строки видит (ADR-0013).
 *
 * Модель доступа Этапа 1 отвечала только на вопрос «можно ли открыть форму».
 * Здесь появляется второй вопрос — «какие строки в ней твои», без которого
 * дашборды Этапа 3 показывать нельзя.
 *
 * Правило видимости принадлежит роли, позиция в дереве — пользователю.
 * Это разделение позволяет одной ролью «региональный менеджер» обслужить все
 * регионы: правило одно, а видят её носители разное, потому что стоят
 * в разных узлах.
 */
@Service
public class MdScopeService {

    public static final String RULE_ALL = "ALL";
    public static final String RULE_SUBTREE = "SUBTREE";
    public static final String RULE_UNITS = "UNITS";
    public static final String RULE_SELF = "SELF";

    private static final Set<String> VALID_RULES = Set.of(RULE_ALL, RULE_SUBTREE, RULE_UNITS, RULE_SELF);

    private final MdScopeRepository scopeRepository;
    private final MdOrgUnitRepository orgUnitRepository;
    private final MdPermissionService permissionService;
    private final AuditLogService auditLogService;

    public MdScopeService(MdScopeRepository scopeRepository,
                          MdOrgUnitRepository orgUnitRepository,
                          MdPermissionService permissionService,
                          AuditLogService auditLogService) {
        this.scopeRepository = scopeRepository;
        this.orgUnitRepository = orgUnitRepository;
        this.permissionService = permissionService;
        this.auditLogService = auditLogService;
    }

    // ------------------------------------------------------- правило у роли

    /** Acquire before source rows or per-user materializations are changed. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void acquireMutationLock() {
        scopeRepository.lockScopeMutation();
    }

    @Transactional
    public void setRoleRule(Long roleId, String rule) {
        acquireMutationLock();
        requireRole(roleId);
        String normalized = normalize(rule);
        String before = scopeRepository.getRoleRule(roleId);

        scopeRepository.setRoleRule(roleId, normalized);
        recalculateForRole(roleId);

        // Смена правила меняет видимость данных так же радикально, как выдача
        // права, поэтому пишется в аудит наравне с матрицей прав (FR-AUD-1).
        auditLogService.logChange("md_role_scope_rules", String.valueOf(roleId), "U",
                List.of("rule"),
                Map.of("rule", before),
                Map.of("rule", normalized));
    }

    @Transactional(readOnly = true)
    public String getRoleRule(Long roleId) {
        return scopeRepository.getRoleRule(roleId);
    }

    @Transactional(readOnly = true)
    public RoleRule getRoleScopeRule(Long roleId) {
        requireRole(roleId);
        return new RoleRule(roleId, scopeRepository.getRoleRule(roleId));
    }

    // -------------------------------------------------- позиция пользователя

    @Transactional
    public void assignUserOrgUnits(Long userId, List<Long> orgUnitIds) {
        acquireMutationLock();
        requireUser(userId);
        if (orgUnitIds == null) {
            throw validation("Список подразделений обязателен; для снятия всех назначений передайте пустой массив");
        }
        for (Long unitId : orgUnitIds) {
            requirePositiveId(unitId, "Идентификатор подразделения");
        }
        List<Long> requested = List.copyOf(new TreeSet<>(orgUnitIds));
        for (Long unitId : requested) {
            orgUnitRepository.findById(unitId).orElseThrow(() ->
                    ApiException.notFound(ErrorCode.NOT_FOUND, "Узел оргструктуры не найден: " + unitId));
        }

        Set<Long> before = scopeRepository.getUserOrgUnitIds(userId);
        scopeRepository.replaceUserOrgUnits(userId, requested);
        recalculateFor(userId);

        auditLogService.logChange("md_user_org_units", String.valueOf(userId), "U",
                List.of("org_units"),
                Map.of("org_units", List.copyOf(before)),
                Map.of("org_units", List.copyOf(scopeRepository.getUserOrgUnitIds(userId))));
    }

    /**
     * Пересчёт эффективного скоупа пользователя. Версия прав двигается вместе
     * со скоупом: изменение видимости данных обязано инвалидировать кэш
     * доступа так же, как изменение права, иначе отзыв не сработает (I-P2).
     */
    @Transactional
    public String recalculateFor(Long userId) {
        acquireMutationLock();
        String rule = scopeRepository.recalculateEffectiveScope(userId);
        permissionService.recalculateEffectivePermissions(userId);
        return rule;
    }

    @Transactional
    public void recalculateForRole(Long roleId) {
        acquireMutationLock();
        for (Long userId : scopeRepository.getUserIdsByRole(roleId)) {
            recalculateFor(userId);
        }
    }

    /** Users on either side of a tree mutation must be captured while holding the mutation lock. */
    @Transactional(readOnly = true)
    public List<Long> getUserIdsAffectedByUnit(Long orgUnitId) {
        return scopeRepository.getUserIdsAffectedByUnit(orgUnitId);
    }

    /** Refresh users assigned inside the branch or on its ancestors. */
    @Transactional
    public void recalculateForUnitSubtree(Long orgUnitId) {
        acquireMutationLock();
        for (Long userId : scopeRepository.getUserIdsAffectedByUnit(orgUnitId)) {
            recalculateFor(userId);
        }
    }

    @Transactional(readOnly = true)
    public UserScope getUserScope(Long userId) {
        requireUser(userId);
        return new UserScope(scopeRepository.getUserRule(userId), scopeRepository.getEffectiveScope(userId));
    }

    @Transactional(readOnly = true)
    public UserAssignments getUserAssignments(Long userId) {
        requireUser(userId);
        return new UserAssignments(
                userId,
                scopeRepository.getUserOrgUnitIds(userId).stream().sorted().toList(),
                scopeRepository.findUserOrgUnit(userId).orElse(null));
    }

    // ------------------------------------------------------- применение в SQL

    /**
     * Ограничение выборки для текущего пользователя.
     *
     * Предикат добавляется в запрос явно, а не подставляется автоматически:
     * молчаливая фильтрация — это когда разработчик не видит, что его запрос
     * урезан, и отлаживает пустой список часами. Полнота покрытия
     * проверяется тестом на каждую скоупируемую сущность.
     *
     * @param orgUnitColumn колонка привязки строки к узлу, например {@code md_users.org_unit_id}
     * @param ownerColumn   колонка владельца строки для правила SELF
     */
    @Transactional(readOnly = true)
    public ScopeFilter filterFor(Long userId, String orgUnitColumn, String ownerColumn) {
        if (userId == null) {
            return ScopeFilter.unrestricted();
        }
        return switch (scopeRepository.getUserRule(userId)) {
            case RULE_SUBTREE, RULE_UNITS -> ScopeFilter.byOrgUnit(orgUnitColumn, userId);
            case RULE_SELF -> ScopeFilter.byOwner(ownerColumn, userId);
            default -> ScopeFilter.unrestricted();
        };
    }

    /** Row visibility for queries whose task table alias is {@code t}. */
    @Transactional(readOnly = true)
    public ScopeFilter filterForTasks(Long userId) {
        if (userId == null) {
            return ScopeFilter.unrestricted();
        }
        return switch (scopeRepository.getUserRule(userId)) {
            case RULE_SUBTREE, RULE_UNITS -> ScopeFilter.taskByParticipantOrgUnit(userId);
            case RULE_SELF -> ScopeFilter.taskSelf(userId);
            default -> ScopeFilter.unrestricted();
        };
    }

    /** Row visibility for queries whose file table alias is {@code f}. */
    @Transactional(readOnly = true)
    public ScopeFilter filterForFiles(Long userId) {
        if (userId == null) {
            return ScopeFilter.unrestricted();
        }
        return switch (scopeRepository.getUserRule(userId)) {
            case RULE_SUBTREE, RULE_UNITS -> ScopeFilter.fileByOwnerOrTaskOrgUnit(userId);
            case RULE_SELF -> ScopeFilter.fileSelf(userId);
            default -> ScopeFilter.unrestricted();
        };
    }

    /** Validates assignees before a scoped actor can add them to a task. */
    @Transactional(readOnly = true)
    public boolean canAccessUser(Long viewerId, Long targetUserId) {
        if (viewerId == null || targetUserId == null) {
            return viewerId == null;
        }
        return switch (scopeRepository.getUserRule(viewerId)) {
            case RULE_SELF -> viewerId.equals(targetUserId) && scopeRepository.userExists(targetUserId);
            case RULE_SUBTREE, RULE_UNITS -> scopeRepository.isUserInEffectiveScope(viewerId, targetUserId);
            default -> scopeRepository.userExists(targetUserId);
        };
    }

    private static String normalize(String rule) {
        String normalized = rule != null ? rule.trim().toUpperCase() : "";
        if (!VALID_RULES.contains(normalized)) {
            throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED,
                    "Неизвестное правило видимости: " + rule + ". Допустимо: " + VALID_RULES);
        }
        return normalized;
    }

    private void requireUser(Long userId) {
        requirePositiveId(userId, "Идентификатор пользователя");
        if (!scopeRepository.userExists(userId)) {
            throw ApiException.notFound(ErrorCode.NOT_FOUND, "Пользователь не найден: " + userId);
        }
    }

    private void requireRole(Long roleId) {
        requirePositiveId(roleId, "Идентификатор роли");
        if (!scopeRepository.roleExists(roleId)) {
            throw ApiException.notFound(ErrorCode.NOT_FOUND, "Роль не найдена: " + roleId);
        }
    }

    private static void requirePositiveId(Long id, String field) {
        if (id == null || id <= 0) {
            throw validation(field + " должен быть положительным числом");
        }
    }

    private static ApiException validation(String message) {
        return ApiException.badRequest(ErrorCode.VALIDATION_FAILED, message);
    }

    public record UserScope(String rule, Set<Long> visibleOrgUnitIds) {}
}
