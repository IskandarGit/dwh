package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdScopeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Роли и матрица их прав (FR-PERM-2, FR-PERM-3).
 *
 * Каждая мутация оставляет след в аудите: изменение матрицы прав — самое
 * чувствительное действие в системе, и «кто кому что выдал» обязано
 * восстанавливаться по журналу без обращения к резервным копиям (FR-AUD-1).
 */
@Service
public class MdRoleService {

    private final MdRoleRepository roleRepository;
    private final MdPermissionService permissionService;
    private final AuditLogService auditLogService;
    private final MdScopeRepository scopeRepository;

    public MdRoleService(MdRoleRepository roleRepository,
                         MdPermissionService permissionService,
                         AuditLogService auditLogService,
                         MdScopeRepository scopeRepository) {
        this.roleRepository = roleRepository;
        this.permissionService = permissionService;
        this.auditLogService = auditLogService;
        this.scopeRepository = scopeRepository;
    }

    @Transactional(readOnly = true)
    public List<MdRoleRepository.RoleRecord> listRoles() {
        return roleRepository.listRoles();
    }

    @Transactional(readOnly = true)
    public Map<Long, Integer> countUsersPerRole() {
        return roleRepository.countUsersPerRole();
    }

    @Transactional
    public MdRoleRepository.RoleRecord createRole(String name, int orderNo) {
        scopeRepository.lockScopeMutation();
        var role = roleRepository.create(name, null, "A", orderNo);

        // ADR-0013: правило видимости заводится сразу и явно. Роль без строки
        // правила вела бы себя как ALL по умолчанию — это расширение доступа
        // по умолчанию, а такие вещи должны быть видны администратору в списке.
        scopeRepository.setRoleRule(role.id(), MdScopeService.RULE_ALL);

        auditLogService.logChange("md_roles", String.valueOf(role.id()), "I",
                List.of("name", "state", "order_no"),
                null,
                Map.of("id", role.id(), "name", name, "state", "A", "order_no", orderNo));

        return role;
    }

    @Transactional(readOnly = true)
    public MdRoleRepository.RoleRecord getRoleById(Long id) {
        return roleRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.ROLE_NOT_FOUND, "Роль не найдена"));
    }

    @Transactional
    public void updateRole(Long id, String name, String state, Integer orderNo) {
        scopeRepository.lockScopeMutation();
        var role = getRoleById(id);
        if (role.pcode() != null && "admin".equals(role.pcode()) && "P".equalsIgnoreCase(state)) {
            throw ApiException.forbidden(ErrorCode.SUPERADMIN_IMMUTABLE, "Роль администратора не может быть переведена в пассивный статус");
        }
        // Семантика частичного обновления: не переданное поле не меняется.
        // Раньше null в name уходил в базу и падал на not null, а не переданный
        // order_no молча обнулял порядок роли в списке.
        String newName = name != null ? name : role.name();
        String newState = state != null ? state : role.state();
        int newOrderNo = orderNo != null ? orderNo : role.orderNo();
        roleRepository.update(id, newName, newState, newOrderNo);
        if (state != null && !state.equals(role.state())) {
            List<Long> userIds = scopeRepository.getUserIdsByRole(id);
            for (Long uid : userIds) {
                scopeRepository.recalculateEffectiveScope(uid);
                permissionService.recalculateEffectivePermissions(uid);
            }
        }

        auditLogService.logChange("md_roles", String.valueOf(id), "U",
                List.of("name", "state", "order_no"),
                Map.of("name", role.name(), "state", role.state(), "order_no", role.orderNo()),
                Map.of("name", newName, "state", newState, "order_no", newOrderNo));
    }

    @Transactional
    public void deleteRole(Long id) {
        scopeRepository.lockScopeMutation();
        var role = getRoleById(id);
        if (role.pcode() != null) {
            throw ApiException.forbidden(ErrorCode.SUPERADMIN_IMMUTABLE, "Системные роли не могут быть удалены");
        }
        List<Long> userIds = roleRepository.getUserIdsByRole(id);
        if (!userIds.isEmpty()) {
            throw ApiException.conflict(ErrorCode.ROLE_NOT_FOUND, "Роль назначена пользователям и не может быть удалена");
        }
        roleRepository.delete(id);

        auditLogService.logChange("md_roles", String.valueOf(id), "D",
                List.of("name", "state"),
                Map.of("name", role.name(), "state", role.state()),
                null);
    }

    @Transactional(readOnly = true)
    public Set<String> getRolePermissions(Long roleId) {
        return roleRepository.getRolePermissions(roleId);
    }

    @Transactional
    public void setRolePermissions(Long roleId, List<MdRoleRepository.PermissionPair> permissions) {
        var role = getRoleById(roleId);

        // Матрица роли раньше не проверялась вовсе: в md_role_permissions можно
        // было записать любую пару, и она попадала в эффективные права (FR-PERM-1).
        var grantable = permissionService.getGrantablePairs();
        for (var p : permissions != null ? permissions : List.<MdRoleRepository.PermissionPair>of()) {
            if (!grantable.contains(p.formCode() + "." + p.action())) {
                throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED,
                        "Пара форма/действие недоступна для выдачи: " + p.formCode() + "." + p.action());
            }
        }

        // Снимок «до» нужен именно здесь: после replace старый набор восстановить неоткуда.
        Set<String> before = new TreeSet<>(roleRepository.getRolePermissions(roleId));

        roleRepository.replaceRolePermissions(roleId, permissions);
        List<Long> userIds = roleRepository.getUserIdsByRole(roleId);
        for (Long uid : userIds) {
            permissionService.recalculateEffectivePermissions(uid);
        }

        Set<String> after = new TreeSet<>(roleRepository.getRolePermissions(roleId));
        auditLogService.logChange("md_role_permissions", String.valueOf(roleId), "U",
                List.of("permissions"),
                Map.of("role", role.name(), "permissions", List.copyOf(before)),
                Map.of("role", role.name(),
                        "permissions", List.copyOf(after),
                        "granted", diff(after, before),
                        "revoked", diff(before, after),
                        "affected_users", userIds.size()));
    }

    /** Что есть в {@code from} и нет в {@code to} — читаемый диff для экрана аудита. */
    private static List<String> diff(Set<String> from, Set<String> to) {
        return from.stream().filter(p -> !to.contains(p)).toList();
    }
}
