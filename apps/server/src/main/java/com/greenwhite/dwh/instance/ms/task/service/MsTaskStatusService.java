package com.greenwhite.dwh.instance.ms.task.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskStatusRepository;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskTypeRepository;
import com.greenwhite.dwh.instance.search.SearchChangePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Выделенный сервис для управления динамическими статусами и типами задач (SRP).
 */
@Service
public class MsTaskStatusService {

    private final MsTaskStatusRepository statusRepository;
    private final MsTaskTypeRepository typeRepository;
    private final SearchChangePublisher searchChangePublisher;

    public MsTaskStatusService(
            MsTaskStatusRepository statusRepository,
            MsTaskTypeRepository typeRepository,
            SearchChangePublisher searchChangePublisher) {
        this.statusRepository = statusRepository;
        this.typeRepository = typeRepository;
        this.searchChangePublisher = searchChangePublisher;
    }

    // =========================================================================
    // Dynamic Statuses
    // =========================================================================
    @Transactional
    public List<MsTaskStatusRepository.StatusRecord> listStatuses() {
        statusRepository.initDefaultStatusesIfEmpty();
        return statusRepository.listStatuses();
    }

    @Transactional
    public MsTaskStatusRepository.StatusRecord createStatus(String pcode, String name, String color, int orderNo, boolean isTerminal) {
        if (name == null || name.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Название статуса обязательно");
        }
        return statusRepository.create(pcode, name, color, orderNo, isTerminal);
    }

    @Transactional
    public void updateStatusRecord(Long id, String name, String color, Integer orderNo, Boolean isTerminal) {
        statusRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Статус не найден"));
        statusRepository.update(id, name, color, orderNo, isTerminal);
        if (name != null) searchChangePublisher.statusChanged(id);
    }

    @Transactional
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
    }

    @Transactional
    public void reorderStatuses(List<Long> orderedIds) {
        statusRepository.reorder(orderedIds);
    }

    // =========================================================================
    // Dynamic Types
    // =========================================================================
    @Transactional
    public List<MsTaskTypeRepository.TypeRecord> listTypes() {
        typeRepository.initDefaultTypesIfEmpty();
        return typeRepository.listTypes();
    }

    @Transactional
    public MsTaskTypeRepository.TypeRecord createType(String code, String name, String icon, String color, int orderNo) {
        if (code == null || code.isBlank() || name == null || name.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Код и название типа обязательны");
        }
        String cleanCode = code.trim().toLowerCase().replaceAll("[^a-z0-9_]", "_");
        if (typeRepository.findByCode(cleanCode).isPresent()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Тип с таким кодом уже существует");
        }
        return typeRepository.create(cleanCode, name, icon, color, orderNo);
    }

    @Transactional
    public void updateType(Long id, String name, String icon, String color, Integer orderNo) {
        typeRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Тип задачи не найден"));
        typeRepository.update(id, name, icon, color, orderNo);
    }

    @Transactional
    public void deleteType(Long id) {
        var type = typeRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Тип задачи не найден"));
        if (type.isSystem()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Нельзя удалить системный тип задачи");
        }
        typeRepository.delete(id);
    }

    @Transactional
    public void reorderTypes(List<Long> orderedIds) {
        typeRepository.reorder(orderedIds);
    }
}
