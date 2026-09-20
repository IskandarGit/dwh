package com.greenwhite.dwh.instance.kauth.service;

import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
public class KauthSessionService {

    private final KauthSessionRepository sessionRepository;
    private final com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository loginAttemptRepository;

    public KauthSessionService(KauthSessionRepository sessionRepository) {
        this(sessionRepository, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public KauthSessionService(KauthSessionRepository sessionRepository,
                               com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository loginAttemptRepository) {
        this.sessionRepository = sessionRepository;
        this.loginAttemptRepository = loginAttemptRepository;
    }

    @Transactional(readOnly = true)
    public UserSecuritySummary getUserSecuritySummary(Long userId, com.greenwhite.dwh.instance.md.service.MdUserService.AuthUser user) {
        var activeSessions = sessionRepository.findActiveByUserId(userId);
        var recentAttempts = loginAttemptRepository != null
                ? loginAttemptRepository.findRecentAttemptsForLogin(user.login(), 10)
                : java.util.List.<com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository.LoginAttemptRecord>of();
        return new UserSecuritySummary(
                user.id(),
                user.login(),
                user.is2faEnabled(),
                user.forcePasswordChange(),
                null, // passwordChangedAt
                user.createdAt(),
                user.authenticationVersion(),
                activeSessions.size(),
                activeSessions,
                recentAttempts
        );
    }

    @Transactional(readOnly = true)
    public Optional<KauthSessionRepository.SessionRecord> getActiveSession(String rawToken) {
        String tokenHash = KauthPasswordHasher.sha256(rawToken);
        return sessionRepository.findActiveByTokenHash(tokenHash);
    }

    @Transactional
    public void updateLastSeen(Long sessionId) {
        sessionRepository.updateLastSeen(sessionId);
    }

    @Transactional(readOnly = true)
    public List<KauthSessionRepository.SessionRecord> getUserActiveSessions(Long userId) {
        return sessionRepository.findActiveByUserId(userId);
    }

    @Transactional
    public void closeSession(Long sessionId) {
        sessionRepository.close(sessionId);
    }

    @Transactional
    public void closeAllUserSessions(Long userId) {
        sessionRepository.closeAllUserSessions(userId);
    }

    @Transactional
    public void closeOtherSessions(Long userId, Long currentSessionId) {
        sessionRepository.closeOtherSessions(userId, currentSessionId);
    }

    @Transactional
    public int closeInactiveSessions(java.time.Instant cutoff) {
        return sessionRepository.closeInactiveSessions(cutoff);
    }
}

