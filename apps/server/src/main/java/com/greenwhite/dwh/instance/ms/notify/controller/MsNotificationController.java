package com.greenwhite.dwh.instance.ms.notify.controller;

import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.ms.notify.pref.MsNotifyPref;
import com.greenwhite.dwh.instance.ms.notify.repository.MsNotificationRepository;
import com.greenwhite.dwh.instance.ms.notify.service.MsNotificationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/api/v1/notify", "/api/v1/notifications"})
public class MsNotificationController {


    private final MsNotificationService notificationService;

    public MsNotificationController(MsNotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping("/inbox")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<List<MsNotificationRepository.NotificationRecord>> getInbox(
            @RequestParam(name = "limit", defaultValue = "50") int limit) {

        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ");

        return ResponseEntity.ok(notificationService.getUserNotifications(userId, limit));
    }

    @GetMapping("/unread-count")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<Map<String, Integer>> getUnreadCount() {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ");

        int count = notificationService.getUnreadCount(userId);
        return ResponseEntity.ok(Map.of("unread_count", count));
    }

    @PostMapping("/inbox/{id}/read")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<Void> markAsRead(@PathVariable("id") Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ");

        notificationService.markAsRead(id, userId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/inbox/read-all")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<Void> markAllAsRead() {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ");

        notificationService.markAllAsRead(userId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/preferences")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<List<com.greenwhite.dwh.instance.ms.notify.repository.MsNotificationPrefRepository.NotificationPrefRecord>> getPreferences() {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");

        return ResponseEntity.ok(notificationService.getUserPreferences(userId));
    }

    @PutMapping("/preferences")
    @RequiresPermission(form = MsNotifyPref.FORM_INBOX, action = "view")
    public ResponseEntity<Void> updatePreferences(
            @RequestBody List<MsNotificationService.PrefUpdateDto> updates) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");

        notificationService.updateUserPreferences(userId, updates);
        return ResponseEntity.noContent().build();
    }
}
