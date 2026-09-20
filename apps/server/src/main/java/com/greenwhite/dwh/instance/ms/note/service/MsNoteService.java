package com.greenwhite.dwh.instance.ms.note.service;

import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.ms.note.repository.MsNoteRepository;
import com.greenwhite.dwh.instance.ms.note.repository.MsNoteRepository.NoteRecord;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class MsNoteService {

    private final MsNoteRepository noteRepository;
    private final AuditLogService auditLogService;
    private final com.greenwhite.dwh.instance.md.service.MdCustomFieldService customFieldService;
    private final com.greenwhite.dwh.instance.md.service.ModuleRegistryService moduleRegistryService;

    @org.springframework.beans.factory.annotation.Autowired
    public MsNoteService(MsNoteRepository noteRepository,
                         AuditLogService auditLogService,
                         com.greenwhite.dwh.instance.md.service.MdCustomFieldService customFieldService,
                         @org.springframework.beans.factory.annotation.Autowired(required = false) com.greenwhite.dwh.instance.md.service.ModuleRegistryService moduleRegistryService) {
        this.noteRepository = noteRepository;
        this.auditLogService = auditLogService;
        this.customFieldService = customFieldService;
        this.moduleRegistryService = moduleRegistryService;
    }

    public MsNoteService(MsNoteRepository noteRepository, AuditLogService auditLogService) {
        this(noteRepository, auditLogService, null, null);
    }

    private void checkModuleActive() {
        if (moduleRegistryService != null && !moduleRegistryService.isModuleActive("notes")) {
            throw ApiException.badRequest(com.greenwhite.dwh.core.error.ErrorCode.BAD_REQUEST, "Модуль 'notes' отключен администратором");
        }
    }

    public record NoteView(
            Long id,
            String title,
            String contentMd,
            String color,
            boolean isPinned,
            Map<String, Object> attributes,
            Long createdBy,
            Instant createdAt,
            Instant modifiedAt
    ) {
        public static NoteView from(NoteRecord r) {
            return new NoteView(
                    r.id(), r.title(), r.contentMd(), r.color(), r.isPinned(),
                    r.attributes(), r.createdBy(), r.createdAt(), r.modifiedAt()
            );
        }
    }

    @Transactional(readOnly = true)
    public List<NoteView> getNotes(Long userId, String search) {
        checkModuleActive();
        return noteRepository.findByOwner(userId, search).stream()
                .map(NoteView::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public NoteView getNote(Long id, Long userId) {
        checkModuleActive();
        var note = noteRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Заметка не найдена: " + id));
        if (!note.createdBy().equals(userId)) {
            throw ApiException.forbidden(com.greenwhite.dwh.core.error.ErrorCode.FORBIDDEN, "Нет доступа к чужой заметке");
        }
        return NoteView.from(note);
    }

    @Transactional
    public NoteView createNote(String title, String contentMd, String color, boolean isPinned,
                               Map<String, Object> attributes, Long userId) {
        checkModuleActive();
        if (title == null || title.isBlank()) {
            throw ApiException.badRequest(com.greenwhite.dwh.core.error.ErrorCode.BAD_REQUEST, "Заголовок заметки не может быть пустым");
        }

        if (customFieldService != null && attributes != null && !attributes.isEmpty()) {
            customFieldService.validateAttributes("NOTE", attributes);
        }

        var note = noteRepository.create(title.trim(), contentMd, color, isPinned, attributes, userId);

        auditLogService.logChange("ms_notes", String.valueOf(note.id()), "I",
                List.of("title", "color", "is_pinned"),
                null,
                Map.of("title", note.title(), "color", note.color(), "is_pinned", note.isPinned()));

        return NoteView.from(note);
    }

    @Transactional
    public NoteView updateNote(Long id, String title, String contentMd, String color, Boolean isPinned,
                               Map<String, Object> attributes, Long userId) {
        checkModuleActive();
        var existing = noteRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Заметка не найдена: " + id));
        if (!existing.createdBy().equals(userId)) {
            throw ApiException.forbidden(com.greenwhite.dwh.core.error.ErrorCode.FORBIDDEN, "Нет доступа к чужой заметке");
        }

        if (customFieldService != null && attributes != null && !attributes.isEmpty()) {
            customFieldService.validateAttributes("NOTE", attributes);
        }

        var updated = noteRepository.update(id, title, contentMd, color, isPinned, attributes, userId);

        auditLogService.logChange("ms_notes", String.valueOf(id), "U",
                List.of("title", "color", "is_pinned"),
                Map.of("title", existing.title(), "color", existing.color(), "is_pinned", existing.isPinned()),
                Map.of("title", updated.title(), "color", updated.color(), "is_pinned", updated.isPinned()));

        return NoteView.from(updated);
    }

    @Transactional
    public NoteView togglePinned(Long id, Long userId) {
        checkModuleActive();
        var existing = noteRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Заметка не найдена: " + id));
        if (!existing.createdBy().equals(userId)) {
            throw ApiException.forbidden(com.greenwhite.dwh.core.error.ErrorCode.FORBIDDEN, "Нет доступа к чужой заметке");
        }

        return updateNote(id, null, null, null, !existing.isPinned(), null, userId);
    }

    @Transactional
    public void deleteNote(Long id, Long userId) {
        checkModuleActive();
        var existing = noteRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Заметка не найдена: " + id));
        if (!existing.createdBy().equals(userId)) {
            throw ApiException.forbidden(com.greenwhite.dwh.core.error.ErrorCode.FORBIDDEN, "Нет доступа к чужой заметке");
        }

        noteRepository.delete(id);

        auditLogService.logChange("ms_notes", String.valueOf(id), "D",
                List.of("title"),
                Map.of("title", existing.title()),
                null);
    }
}
