package com.greenwhite.dwh.instance.ms.note.controller;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.ms.note.service.MsNoteService;
import com.greenwhite.dwh.instance.ms.note.service.MsNoteService.NoteView;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/notes")
public class MsNoteController {

    private final MsNoteService noteService;

    public MsNoteController(MsNoteService noteService) {
        this.noteService = noteService;
    }

    public record CreateNoteRequest(
            String title,
            String contentMd,
            String color,
            boolean isPinned,
            Map<String, Object> attributes
    ) {}

    public record UpdateNoteRequest(
            String title,
            String contentMd,
            String color,
            Boolean isPinned,
            Map<String, Object> attributes
    ) {}

    @GetMapping
    @RequiresPermission(form = "notes", action = "view")
    public ResponseEntity<List<NoteView>> getNotes(@RequestParam(required = false) String q) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(noteService.getNotes(userId, q));
    }

    @GetMapping("/{id}")
    @RequiresPermission(form = "notes", action = "view")
    public ResponseEntity<NoteView> getNote(@PathVariable Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(noteService.getNote(id, userId));
    }

    @PostMapping
    @RequiresPermission(form = "notes", action = "create")
    public ResponseEntity<NoteView> createNote(@RequestBody CreateNoteRequest body) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(noteService.createNote(
                body.title(), body.contentMd(), body.color(), body.isPinned(), body.attributes(), userId
        ));
    }

    @PutMapping("/{id}")
    @RequiresPermission(form = "notes", action = "update")
    public ResponseEntity<NoteView> updateNote(@PathVariable Long id, @RequestBody UpdateNoteRequest body) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(noteService.updateNote(
                id, body.title(), body.contentMd(), body.color(), body.isPinned(), body.attributes(), userId
        ));
    }

    @PostMapping("/{id}/pin")
    @RequiresPermission(form = "notes", action = "update")
    public ResponseEntity<NoteView> togglePin(@PathVariable Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(noteService.togglePinned(id, userId));
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(form = "notes", action = "delete")
    public ResponseEntity<Void> deleteNote(@PathVariable Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        noteService.deleteNote(id, userId);
        return ResponseEntity.noContent().build();
    }
}
