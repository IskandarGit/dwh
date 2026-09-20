package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.repository.MdPermissionRepository;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Назначение ролей и персональных прав пользователям (FR-PERM-4, FR-PERM-5, FR-PERM-10).
 *
 * Ключевое правило: любое изменение прав в ТОЙ ЖЕ транзакции пересчитывает
 * эффективные права и инкрементирует permissions_version (инвариант I-P2) —
 * иначе кэш в приложении не узнает об изменении и отзыв права не сработает.
 *
 * Второе правило той же силы: изменение прав пишется в аудит той же транзакцией
 * (FR-AUD-1). Выдача доступа без следа в журнале неотличима от компрометации.
 */
@Service
public class MdAssignmentService {

    private final MdUserRepository userRepository;
    private final MdRoleRepository roleRepository;
    private final MdPermissionRepository permissionRepository;
    private final MdPermissionService permissionService;
    private final MdScopeService scopeService;
    private final AuditLogService auditLogService;

    public MdAssignmentService(MdUserRepository userRepository,
                               MdRoleRepository roleRepository,
                               MdPermissionRepository permissionRepository,
                               MdPermissionService permissionService,
                               MdScopeService scopeService,
                               AuditLogService auditLogService) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.permissionService = permissionService;
        this.scopeService = scopeService;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public List<Long> getUserRoleIds(Long userId) {
        requireUser(userId);
        return roleRepository.getUserRoleIds(userId);
    }

    /** Полная замена набора ролей пользователя (семантика PUT из ТЗ-04 разд. 4.4). */
    @Transactional
    public long assignRoles(Long userId, List<Long> roleIds) {
        scopeService.acquireMutationLock();
        requireUser(userId);
        List<Long> requested = roleIds != null ? roleIds : List.of();

        for (Long roleId : requested) {
            roleRepository.findById(roleId).orElseThrow(() ->
                    ApiException.notFound(ErrorCode.ROLE_NOT_FOUND, "Роль не найдена: " + roleId));
        }

        Set<Long> before = new TreeSet<>(roleRepository.getUserRoleIds(userId));
        guardLastAdmin(userId, requested);

        roleRepository.assignRolesToUser(userId, requested);
        scopeService.recalculateFor(userId);

        Set<Long> after = new TreeSet<>(requested);
        var names = roleNames();
        auditLogService.logChange("md_user_roles", String.valueOf(userId), "U",
                List.of("roles"),
                Map.of("roles", named(before, names)),
                Map.of("roles", named(after, names),
                        "granted", named(diff(after, before), names),
                        "revoked", named(diff(before, after), names)));

        return permissionService.getPermissionVersion(userId);
    }

    /** Полная замена персональных прав поверх ролей (FR-PERM-5). */
    @Transactional
    public long replacePersonalPermissions(Long userId, List<MdRoleRepository.PermissionPair> permissions) {
        requireUser(userId);
        List<MdRoleRepository.PermissionPair> requested = permissions != null ? permissions : List.of();

        // Права выдаются только на живые пары каталога (FR-PERM-1): устаревшая
        // пара ничего не открывает, и выданное по ней право неотличимо от
        // ошибки настройки доступа.
        var grantable = permissionService.getGrantablePairs();
        for (var p : requested) {
            if (!grantable.contains(p.formCode() + "." + p.action())) {
                throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED,
                        "Пара форма/действие недоступна для выдачи: " + p.formCode() + "." + p.action());
            }
        }

        Set<String> before = new TreeSet<>(permissionRepository.getUserPersonalPermissions(userId));

        permissionRepository.replaceUserPermissions(userId, requested);
        permissionService.recalculateEffectivePermissions(userId);

        Set<String> after = new TreeSet<>(permissionRepository.getUserPersonalPermissions(userId));
        auditLogService.logChange("md_user_permissions", String.valueOf(userId), "U",
                List.of("permissions"),
                Map.of("permissions", List.copyOf(before)),
                Map.of("permissions", List.copyOf(after),
                        "granted", List.copyOf(diff(after, before)),
                        "revoked", List.copyOf(diff(before, after))));

        return permissionService.getPermissionVersion(userId);
    }

    @Transactional(readOnly = true)
    public List<MdPermissionRepository.EffectivePermissionItem> getEffectivePermissions(Long userId) {
        requireUser(userId);
        return permissionRepository.getEffectivePermissionsWithSource(userId);
    }

    /**
     * Нельзя снять роль admin с последнего администратора: система осталась бы
     * без единого пользователя, способного управлять доступом (сценарий F-04).
     */
    private void guardLastAdmin(Long userId, List<Long> newRoleIds) {
        var adminRole = roleRepository.findByPcode(MdPref.ROLE_ADMIN).orElse(null);
        if (adminRole == null) {
            return;
        }
        boolean hadAdmin = roleRepository.getUserRoleIds(userId).contains(adminRole.id());
        boolean keepsAdmin = newRoleIds.contains(adminRole.id());
        if (hadAdmin && !keepsAdmin && userRepository.countUsersWithRole(adminRole.id()) <= 1) {
            throw ApiException.conflict(ErrorCode.LAST_ADMIN,
                    "Нельзя снять роль администратора с последнего администратора системы");
        }
    }

    private void requireUser(Long userId) {
        userRepository.findById(userId).orElseThrow(() ->
                ApiException.notFound(ErrorCode.USER_NOT_FOUND, "Пользователь не найден"));
    }

    /** Одним запросом: идентификатор в имя. В журнале аудита имя роли читается, а идентификатор нет. */
    private Map<Long, String> roleNames() {
        return roleRepository.listRoles().stream()
                .collect(Collectors.toMap(MdRoleRepository.RoleRecord::id,
                        MdRoleRepository.RoleRecord::name, (a, b) -> a));
    }

    private static List<String> named(Set<Long> ids, Map<Long, String> names) {
        return ids.stream().map(id -> names.getOrDefault(id, "id:" + id)).toList();
    }

    /** Что есть в from и нет в to. */
    private static <T extends Comparable<T>> Set<T> diff(Set<T> from, Set<T> to) {
        return from.stream().filter(x -> !to.contains(x))
                .collect(Collectors.toCollection(TreeSet::new));
    }
}
