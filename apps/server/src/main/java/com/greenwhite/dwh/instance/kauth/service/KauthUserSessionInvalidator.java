package com.greenwhite.dwh.instance.kauth.service;

import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.md.service.UserSessionInvalidator;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Реализация порта md.UserSessionInvalidator (инвариант I-U1):
 * закрывает сессии и отзывает API-токены.
 * REQUIRED сохраняет атомарность как внутри MD use case, так и при отдельном вызове.
 */
@Component
public class KauthUserSessionInvalidator implements UserSessionInvalidator {

    private final KauthSessionRepository sessionRepository;
    private final KauthApiTokenRepository apiTokenRepository;

    public KauthUserSessionInvalidator(KauthSessionRepository sessionRepository,
                                       KauthApiTokenRepository apiTokenRepository) {
        this.sessionRepository = sessionRepository;
        this.apiTokenRepository = apiTokenRepository;
    }

    @Override
    @Transactional
    public void invalidateAllAccess(Long userId) {
        sessionRepository.closeAllUserSessions(userId);
        apiTokenRepository.revokeAllUserTokens(userId);
    }
}
