package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Оргструктура экземпляра (ADR-0013). Дерево, на которое опирается скоуп данных.
 *
 * Инварианты, которые держит приложение, а не база:
 * I-ORG-1 узел нельзя перенести под собственного потомка (цикл отрезал бы ветку от корня);
 * I-ORG-2 узел с детьми или с назначенными сотрудниками не удаляется молча.
 */
@Service
public class MdOrgUnitService {

    private final MdOrgUnitRepository orgUnitRepository;
    private final MdScopeService scopeService;
    private final AuditLogService auditLogService;

    public MdOrgUnitService(MdOrgUnitRepository orgUnitRepository,
                            MdScopeService scopeService,
                            AuditLogService auditLogService) {
        this.orgUnitRepository = orgUnitRepository;
        this.scopeService = scopeService;
        this.auditLogService = auditLogService;
    }

    @Transactional(readOnly = true)
    public List<MdOrgUnitRepository.OrgUnitRecord> listAll() {
        return orgUnitRepository.listAll();
    }

    @Transactional(readOnly = true)
    public MdOrgUnitRepository.OrgUnitRecord getById(Long id) {
        requirePositiveId(id);
        return orgUnitRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Узел оргструктуры не найден"));
    }

    @Transactional
    public MdOrgUnitRepository.OrgUnitRecord create(Long parentId, String code, String name, String kind, int orderNo) {
        scopeService.acquireMutationLock();
        code = requiredText(code, "Код");
        name = requiredText(name, "Название");
        kind = kind == null ? "department" : requiredText(kind, "Вид узла");
        if (parentId != null) {
            getById(parentId);
        } else if (orgUnitRepository.hasRoot()) {
            // Экземпляр принадлежит одному клиенту (ADR-0004), поэтому дерево одно.
            // Без этой проверки ограничение БД срабатывало бы конфликтом без объяснения.
            throw ApiException.conflict(ErrorCode.CONFLICT,
                    "Корень оргструктуры уже существует — укажите родительский узел");
        }
        if (orgUnitRepository.existsByCode(code)) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "Узел с таким кодом уже существует");
        }
        var unit = orgUnitRepository.create(parentId, code, name, kind, orderNo);
        scopeService.recalculateForUnitSubtree(unit.id());

        auditLogService.logChange("md_org_units", String.valueOf(unit.id()), "I",
                List.of("code", "name", "kind", "parent_id"),
                null,
                Map.of("code", code, "name", name, "kind", unit.kind(),
                        "parent_id", parentId != null ? parentId : "null"));

        return unit;
    }

    @Transactional
    public void update(Long id, Long parentId, String name, String kind, String state, Integer orderNo) {
        update(id, true, parentId, name, kind, state, orderNo);
    }

    @Transactional
    public void update(Long id, boolean parentIdPresent, Long parentId, String name, String kind, String state, Integer orderNo) {
        scopeService.acquireMutationLock();
        var unit = getById(id);
        Long finalParentId = parentIdPresent ? parentId : unit.parentId();

        String newName = name != null ? requiredText(name, "Название") : unit.name();
        String newKind = kind != null ? requiredText(kind, "Вид узла") : unit.kind();
        String newState = state != null ? state : unit.state();
        if (!"A".equals(newState) && !"P".equals(newState)) {
            throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, "Состояние должно быть A или P");
        }
        int newOrderNo = orderNo != null ? orderNo : unit.orderNo();

        if (finalParentId == null && unit.parentId() != null) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "Некорневому узлу необходимо указать родителя");
        }
        if (finalParentId != null) {
            getById(finalParentId);
            if (unit.parentId() == null) {
                throw ApiException.conflict(ErrorCode.CONFLICT, "Корень оргструктуры нельзя перенести под другой узел");
            }
        }

        // I-ORG-1: перенос под собственного потомка отрезал бы ветку от корня — молча.
        if (finalParentId != null && orgUnitRepository.isDescendant(id, finalParentId)) {
            throw ApiException.conflict(ErrorCode.CONFLICT,
                    "Узел нельзя перенести под собственного потомка");
        }

        var affectedUsers = new TreeSet<>(scopeService.getUserIdsAffectedByUnit(id));
        orgUnitRepository.update(id, finalParentId, newName, newKind, newState, newOrderNo);
        affectedUsers.addAll(scopeService.getUserIdsAffectedByUnit(id));
        for (Long userId : affectedUsers) {
            scopeService.recalculateFor(userId);
        }

        auditLogService.logChange("md_org_units", String.valueOf(id), "U",
                List.of("parent_id", "name", "kind", "state", "order_no"),
                Map.of("name", unit.name(), "kind", unit.kind(), "state", unit.state(),
                        "parent_id", unit.parentId() != null ? unit.parentId() : "null"),
                Map.of("name", newName, "kind", newKind, "state", newState,
                        "parent_id", finalParentId != null ? finalParentId : "null"));
    }

    @Transactional
    public void delete(Long id) {
        scopeService.acquireMutationLock();
        var unit = getById(id);

        // I-ORG-2: у узла есть дети или сотрудники — удаление здесь означало бы
        // либо каскад по дереву, либо потерю привязок. И то и другое молча.
        if (orgUnitRepository.hasChildren(id)) {
            throw ApiException.conflict(ErrorCode.CONFLICT,
                    "У узла есть подчинённые узлы — сначала перенесите или удалите их");
        }
        if (orgUnitRepository.isAssignedToUsers(id)) {
            throw ApiException.conflict(ErrorCode.CONFLICT,
                    "К узлу привязаны сотрудники — сначала снимите привязку");
        }

        var affectedUsers = scopeService.getUserIdsAffectedByUnit(id);
        orgUnitRepository.delete(id);
        for (Long userId : affectedUsers) {
            scopeService.recalculateFor(userId);
        }

        auditLogService.logChange("md_org_units", String.valueOf(id), "D",
                List.of("code", "name"),
                Map.of("code", unit.code(), "name", unit.name()),
                null);
    }

    private static void requirePositiveId(Long id) {
        if (id == null || id <= 0) {
            throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, "Идентификатор узла должен быть положительным числом");
        }
    }

    private static String requiredText(String value, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isBlank()) {
            throw ApiException.badRequest(ErrorCode.VALIDATION_FAILED, field + " не может быть пустым");
        }
        return normalized;
    }
}
