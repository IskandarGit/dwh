package com.greenwhite.dwh.instance.ms.task.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskStatusRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskTypeRepository;
import com.greenwhite.dwh.instance.search.SearchChangePublisher;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Выделенный сервис для управления динамическими статусами и типами задач (SRP).
 */
@Service
public class MsTaskStatusService {

    private final MsTaskStatusRepository statusRepository;
    private final MsTaskTypeRepository typeRepository;
    private final SearchChangePublisher searchChangePublisher;
    private final AuditLogService auditLogService;

    @org.springframework.beans.factory.annotation.Autowired
    public MsTaskStatusService(
            MsTaskStatusRepository statusRepository,
            MsTaskTypeRepository typeRepository,
            SearchChangePublisher searchChangePublisher,
            AuditLogService auditLogService) {
        this.statusRepository = statusRepository;
        this.typeRepository = typeRepository;
        this.searchChangePublisher = searchChangePublisher;
        this.auditLogService = auditLogService;
    }

    public MsTaskStatusService(
            MsTaskStatusRepository statusRepository,
            MsTaskTypeRepository typeRepository,
            SearchChangePublisher searchChangePublisher) {
        this(statusRepository, typeRepository, searchChangePublisher, null);
    }

    // =========================================================================
    // Dynamic Statuses
    // =========================================================================
    @Transactional
    @Cacheable(value = "taskStatuses", key = "'all'")
    public List<MsTaskStatusRepository.StatusRecord> listStatuses() {
        statusRepository.initDefaultStatusesIfEmpty();
        return statusRepository.listStatuses();
    }

    @Transactional
    @CacheEvict(value = "taskStatuses", allEntries = true)
    public MsTaskStatusRepository.StatusRecord createStatus(String pcode, String name, String color, int orderNo, boolean isTerminal) {
        if (name == null || name.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Название статуса обязательно");
        }
        var record = statusRepository.create(pcode, name, color, orderNo, isTerminal);
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_statuses", String.valueOf(record.id()), "I",
                    List.of("pcode", "name", "color", "order_no", "is_terminal"),
                    null, Map.of("name", name, "order_no", orderNo, "is_terminal", isTerminal));
        }
        return record;
    }

    @Transactional
    @CacheEvict(value = "taskStatuses", allEntries = true)
    public void updateStatusRecord(Long id, String name, String color, Integer orderNo, Boolean isTerminal) {
        statusRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Статус не найден"));
        statusRepository.update(id, name, color, orderNo, isTerminal);
        if (name != null) searchChangePublisher.statusChanged(id);
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_statuses", String.valueOf(id), "U",
                    List.of("name", "color", "order_no", "is_terminal"),
                    null, Map.of("name", name != null ? name : ""));
        }
    }

    @Transactional
    @CacheEvict(value = "taskStatuses", allEntries = true)
    public void deleteStatus(Long id) {
        var status = statusRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Статус не найден"));
        if (status.pcode() != null) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Нельзя удалить базовый системный статус");
        }
        boolean deleted = statusRepository.delete(id);
        if (!deleted) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Нельзя удалить статус, который используется в задачах");
        }
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_statuses", String.valueOf(id), "D",
                    List.of("id"), null, null);
        }
    }

    @Transactional
    @CacheEvict(value = "taskStatuses", allEntries = true)
    public void reorderStatuses(List<Long> orderedIds) {
        statusRepository.reorder(orderedIds);
    }

    // =========================================================================
    // Dynamic Types
    // =========================================================================
    @Transactional
    @Cacheable(value = "taskTypes", key = "'all'")
    public List<MsTaskTypeRepository.TypeRecord> listTypes() {
        typeRepository.initDefaultTypesIfEmpty();
        return typeRepository.listTypes();
    }

    @Transactional
    @CacheEvict(value = "taskTypes", allEntries = true)
    public MsTaskTypeRepository.TypeRecord createType(String code, String name, String icon, String color, int orderNo) {
        if (code == null || code.isBlank() || name == null || name.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Код и название типа обязательны");
        }
        String cleanCode = code.trim().toLowerCase().replaceAll("[^a-z0-9_]", "_");
        if (typeRepository.findByCode(cleanCode).isPresent()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Тип с таким кодом уже существует");
        }
        var record = typeRepository.create(cleanCode, name, icon, color, orderNo);
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_types", String.valueOf(record.id()), "I",
                    List.of("code", "name", "icon", "color", "order_no"),
                    null, Map.of("code", cleanCode, "name", name));
        }
        return record;
    }

    @Transactional
    @CacheEvict(value = "taskTypes", allEntries = true)
    public void updateType(Long id, String name, String icon, String color, Integer orderNo) {
        typeRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Тип задачи не найден"));
        typeRepository.update(id, name, icon, color, orderNo);
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_types", String.valueOf(id), "U",
                    List.of("name", "icon", "color", "order_no"),
                    null, Map.of("name", name != null ? name : ""));
        }
    }

    @Transactional
    @CacheEvict(value = "taskTypes", allEntries = true)
    public void deleteType(Long id) {
        var type = typeRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Тип задачи не найден"));
        if (type.isSystem()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Нельзя удалить системный тип задачи");
        }
        typeRepository.delete(id);
        if (auditLogService != null) {
            auditLogService.logChange("ms_task_types", String.valueOf(id), "D",
                    List.of("id"), null, null);
        }
    }

    @Transactional
    @CacheEvict(value = "taskTypes", allEntries = true)
    public void reorderTypes(List<Long> orderedIds) {
        typeRepository.reorder(orderedIds);
    }
}
