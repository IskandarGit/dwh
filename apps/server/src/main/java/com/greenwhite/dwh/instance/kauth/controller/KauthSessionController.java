package com.greenwhite.dwh.instance.kauth.controller;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.service.KauthSessionService;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/v1/iam")
public class KauthSessionController {

    private final KauthSessionService sessionService;
    private final com.greenwhite.dwh.instance.md.service.MdUserService userService;

    public KauthSessionController(KauthSessionService sessionService,
                                  com.greenwhite.dwh.instance.md.service.MdUserService userService) {
        this.sessionService = sessionService;
        this.userService = userService;
    }

    @GetMapping({"/profile/sessions", "/sessions"})
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "view")
    public ResponseEntity<List<ActiveSessionDto>> listActiveSessions() {
        var principal = SecurityContext.getPrincipal();
        Long userId = principal != null ? principal.userId() : null;
        if (userId == null) {
            throw ApiException.unauthorized("Пользователь не авторизован");
        }

        Long currentSessionId = principal.sessionId();
        List<ActiveSessionDto> list = sessionService.getUserActiveSessions(userId).stream()
                .map(s -> ActiveSessionDto.from(s, currentSessionId))
                .toList();
        return ResponseEntity.ok(list);
    }

    @DeleteMapping({"/profile/sessions/others", "/sessions/others"})
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "update")
    public ResponseEntity<Void> closeOtherSessions() {
        var principal = SecurityContext.getPrincipal();
        if (principal == null || principal.userId() == null) {
            throw ApiException.unauthorized("Пользователь не авторизован");
        }
        if (principal.sessionId() != null) {
            sessionService.closeOtherSessions(principal.userId(), principal.sessionId());
        }
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping({"/profile/sessions/{id}", "/sessions/{id}"})
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "update")
    public ResponseEntity<Void> closeSession(@PathVariable("id") Long id) {
        sessionService.closeSession(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping({"/users/{userId}/sessions", "/profile/sessions/users/{userId}"})
    @RequiresPermission(form = MdPref.FORM_USERS, action = "view")
    public ResponseEntity<List<KauthSessionRepository.SessionRecord>> listUserSessions(@PathVariable("userId") Long userId) {
        return ResponseEntity.ok(sessionService.getUserActiveSessions(userId));
    }

    @DeleteMapping({"/users/{userId}/sessions", "/profile/sessions/users/{userId}"})
    @RequiresPermission(form = MdPref.FORM_USERS, action = "block")
    public ResponseEntity<Void> closeAllUserSessions(@PathVariable("userId") Long userId) {
        sessionService.closeAllUserSessions(userId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping({"/users/{userId}/security", "/profile/sessions/users/{userId}/security"})
    @RequiresPermission(form = MdPref.FORM_USERS, action = "view")
    public ResponseEntity<com.greenwhite.dwh.instance.kauth.service.UserSecuritySummary> getUserSecuritySummary(
            @PathVariable("userId") Long userId) {
        var user = userService.findAuthUserById(userId)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.USER_NOT_FOUND, "Пользователь не найден"));
        return ResponseEntity.ok(sessionService.getUserSecuritySummary(userId, user));
    }

    @PostMapping({"/users/{userId}/force-password-change", "/profile/sessions/users/{userId}/force-password-change"})
    @RequiresPermission(form = MdPref.FORM_USERS, action = "update")
    public ResponseEntity<Void> forcePasswordChange(@PathVariable("userId") Long userId) {
        Long currentUserId = SecurityContext.getCurrentUserId();
        userService.setForcePasswordChange(userId, true, currentUserId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping({"/users/{userId}/reset-2fa", "/profile/sessions/users/{userId}/reset-2fa"})
    @RequiresPermission(form = MdPref.FORM_USERS, action = "update")
    public ResponseEntity<Void> reset2fa(@PathVariable("userId") Long userId) {
        Long currentUserId = SecurityContext.getCurrentUserId();
        userService.reset2fa(userId, currentUserId);
        return ResponseEntity.noContent().build();
    }

    public record ActiveSessionDto(
            Long id,
            Long userId,
            String ip,
            String userAgent,
            String deviceInfo,
            Instant createdAt,
            Instant lastSeenAt,
            Instant closedAt,
            boolean current
    ) {
        public static ActiveSessionDto from(KauthSessionRepository.SessionRecord record, Long currentSessionId) {
            return new ActiveSessionDto(
                    record.id(),
                    record.userId(),
                    record.ip(),
                    record.userAgent(),
                    record.deviceInfo(),
                    record.createdAt(),
                    record.lastSeenAt(),
                    record.closedAt(),
                    currentSessionId != null && currentSessionId.equals(record.id())
            );
        }
    }
}

