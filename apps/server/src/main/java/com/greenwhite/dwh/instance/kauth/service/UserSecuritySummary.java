package com.greenwhite.dwh.instance.kauth.service;

import com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;

import java.time.Instant;
import java.util.List;

public record UserSecuritySummary(
        Long userId,
        String login,
        boolean is2faEnabled,
        boolean forcePasswordChange,
        Instant passwordChangedAt,
        Instant createdAt,
        long authVersion,
        int activeSessionsCount,
        List<KauthSessionRepository.SessionRecord> activeSessions,
        List<KauthLoginAttemptRepository.LoginAttemptRecord> recentLoginAttempts
) {}
