package com.greenwhite.dwh.instance.kauth.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthOtpCodeRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthPasswordResetRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;

@Service
public class KauthAuthService {

    private static final int MAX_FAILED_ATTEMPTS_PER_IP = 10;
    private static final int MAX_FAILED_ATTEMPTS_PER_USER = 5;

    private final MdUserService userService;
    private final KauthSessionRepository sessionRepository;
    private final KauthLoginAttemptRepository loginAttemptRepository;
    private final KauthOtpCodeRepository otpCodeRepository;
    private final KauthPasswordResetRepository passwordResetRepository;
    private final KauthPasswordHasher passwordHasher;
    private final com.greenwhite.dwh.instance.md.service.PasswordValidator passwordValidator;
    private final com.greenwhite.dwh.instance.audit.service.AuditLogService auditLogService;
    private final KauthChannelService channelService;
    private final KauthOtpSender otpSender;
    private final SecureRandom secureRandom = new SecureRandom();

    public KauthAuthService(
            MdUserService userService,
            KauthSessionRepository sessionRepository,
            KauthLoginAttemptRepository loginAttemptRepository,
            KauthOtpCodeRepository otpCodeRepository,
            KauthPasswordResetRepository passwordResetRepository,
            KauthPasswordHasher passwordHasher,
            com.greenwhite.dwh.instance.md.service.PasswordValidator passwordValidator,
            com.greenwhite.dwh.instance.audit.service.AuditLogService auditLogService,
            KauthChannelService channelService,
            KauthOtpSender otpSender) {
        this.userService = userService;
        this.sessionRepository = sessionRepository;
        this.loginAttemptRepository = loginAttemptRepository;
        this.otpCodeRepository = otpCodeRepository;
        this.passwordResetRepository = passwordResetRepository;
        this.passwordHasher = passwordHasher;
        this.passwordValidator = passwordValidator;
        this.auditLogService = auditLogService;
        this.channelService = channelService;
        this.otpSender = otpSender;
    }


    @Transactional
    public LoginResult login(String login, String password, String ip, String userAgent, String deviceInfo) {
        Instant tenMinutesAgo = Instant.now().minusSeconds(600);

        int failedIp = loginAttemptRepository.countFailedAttemptsForIpSince(ip, tenMinutesAgo);
        if (failedIp >= MAX_FAILED_ATTEMPTS_PER_IP) {
            loginAttemptRepository.recordAttempt(login, ip, false, "IP_RATE_LIMITED");
            auditLogService.logSecurityEvent("IP_RATE_LIMITED", null, ip, userAgent, java.util.Map.of("login", login));
            throw ApiException.locked(ErrorCode.RATE_LIMITED, "Слишком много неудачных попыток входа с вашего IP");
        }

        int failedUser = loginAttemptRepository.countFailedAttemptsForLoginSince(login, tenMinutesAgo);
        if (failedUser >= MAX_FAILED_ATTEMPTS_PER_USER) {
            loginAttemptRepository.recordAttempt(login, ip, false, "USER_LOCKED");
            auditLogService.logSecurityEvent("LOGIN_LOCKED", null, ip, userAgent, java.util.Map.of("login", login));
            throw ApiException.locked(ErrorCode.LOGIN_LOCKED, "Учётная запись временно заблокирована из-за частых ошибок ввода пароля");
        }

        var userOpt = userService.findAuthUserByLogin(login);
        if (userOpt.isEmpty()) {
            loginAttemptRepository.recordAttempt(login, ip, false, "USER_NOT_FOUND");
            auditLogService.logSecurityEvent("LOGIN_FAILED", null, ip, userAgent, java.util.Map.of("login", login, "reason", "USER_NOT_FOUND"));
            throw ApiException.invalidCredentials();
        }

        var user = userOpt.get();
        if (MdPref.STATE_PASSIVE.equals(user.state())) {
            loginAttemptRepository.recordAttempt(login, ip, false, "USER_BLOCKED");
            auditLogService.logSecurityEvent("LOGIN_FAILED", user.id(), ip, userAgent, java.util.Map.of("login", login, "reason", "USER_BLOCKED"));
            throw ApiException.conflict(ErrorCode.USER_BLOCKED, "Учётная запись заблокирована");
        }

        if (!passwordHasher.verifyPassword(password, user.passwordHash())) {
            loginAttemptRepository.recordAttempt(login, ip, false, "INVALID_PASSWORD");
            auditLogService.logSecurityEvent("LOGIN_FAILED", user.id(), ip, userAgent, java.util.Map.of("login", login, "reason", "INVALID_PASSWORD"));
            throw ApiException.invalidCredentials();
        }

        loginAttemptRepository.recordAttempt(login, ip, true, null);
        auditLogService.logSecurityEvent("LOGIN_SUCCESS", user.id(), ip, userAgent,
                java.util.Map.of("login", login, "deviceInfo", deviceInfo != null ? deviceInfo : "web"));


        // FR-AUTH-5: второй фактор. Канал выбирает не код, а пользователь —
        // берём подтверждённый по порядку предпочтения. Нет канала — отказ со
        // внятной причиной, а не токен, которым нельзя воспользоваться.
        if (user.is2faEnabled()) {
            var channel = channelService.resolveOtpChannel(user.id());

            String otpToken = generateSecureToken();
            String otpCode = String.format("%06d", secureRandom.nextInt(1000000));

            otpCodeRepository.create(user.id(), user.authenticationVersion(), channel.channel(),
                    KauthPasswordHasher.sha256(otpCode), KauthPasswordHasher.sha256(otpToken),
                    "login", Instant.now().plusSeconds(300));

            // Отправка синхронная: код живёт пять минут, очередь с повторами
            // здесь работает против пользователя. Провал — отказ входа.
            otpSender.sendLoginCode(channel, otpCode);

            auditLogService.logSecurityEvent("OTP_SENT", user.id(), ip, userAgent,
                    java.util.Map.of("channel", channel.channel()));

            return LoginResult.requires2fa(otpToken, user.id());
        }

        // Issue Session
        String sessionToken = generateSecureToken();
        String sessionTokenHash = KauthPasswordHasher.sha256(sessionToken);
        var session = sessionRepository.create(
                user.id(), user.authenticationVersion(), sessionTokenHash, ip, userAgent, deviceInfo
        );

        return LoginResult.success(sessionToken, user, session);
    }

    @Transactional
    public LoginResult verifyOtp(String otpToken, String code, String ip, String userAgent, String deviceInfo) {
        if (otpToken == null || otpToken.isBlank()) {
            throw ApiException.badRequest(ErrorCode.OTP_INVALID, "Некорректный OTP токен");
        }

        // Код ищется по хешу выданного токена и только по нему. До V015 здесь
        // стоял extractUserIdFromOtpToken(), возвращавший захардкоженную 1L:
        // любой непустой токен приводил к коду администратора.
        var otp = otpCodeRepository.findActiveByTokenHash(KauthPasswordHasher.sha256(otpToken), "login")
                .orElseThrow(() -> ApiException.badRequest(ErrorCode.OTP_INVALID, "Некорректный OTP токен"));
        Long userId = otp.userId();
        if (otp.expiresAt().isBefore(Instant.now())) {
            throw ApiException.badRequest(ErrorCode.OTP_EXPIRED, "Срок действия OTP-кода истёк");
        }

        String inputHash = KauthPasswordHasher.sha256(code);
        if (!inputHash.equals(otp.codeHash())) {
            otpCodeRepository.decrementAttempts(otp.id());
            if (otp.attemptsLeft() <= 1) {
                throw ApiException.locked(ErrorCode.OTP_ATTEMPTS_EXCEEDED, "Превышено количество попыток ввода OTP");
            }
            throw ApiException.badRequest(ErrorCode.OTP_INVALID, "Неверный код подтверждения");
        }

        var user = userService.findAuthUserById(userId)
                .orElseThrow(() -> ApiException.badRequest(ErrorCode.OTP_INVALID, "Некорректный OTP токен"));
        if (!MdPref.STATE_ACTIVE.equals(user.state()) || user.authenticationVersion() != otp.authenticationVersion()
                || !otpCodeRepository.consume(otp.id(), userId, otp.authenticationVersion(), "login")) {
            throw ApiException.badRequest(ErrorCode.OTP_INVALID, "Некорректный OTP токен");
        }

        String sessionToken = generateSecureToken();
        String sessionTokenHash = KauthPasswordHasher.sha256(sessionToken);
        KauthSessionRepository.SessionRecord session;
        try {
            session = sessionRepository.create(user.id(), otp.authenticationVersion(), sessionTokenHash, ip, userAgent, deviceInfo);
        } catch (ApiException e) {
            if (e.getErrorCode() == ErrorCode.INVALID_CREDENTIALS) {
                throw ApiException.badRequest(ErrorCode.OTP_INVALID, "Некорректный OTP токен");
            }
            throw e;
        }

        return LoginResult.success(sessionToken, user, session);
    }

    @Transactional
    public void requestPasswordReset(String email) {
        userService.findAuthUserByEmail(email).ifPresent(user -> {
            String code = String.format("%06d", secureRandom.nextInt(1000000));
            String codeHash = KauthPasswordHasher.sha256(code);
            passwordResetRepository.create(user.id(), codeHash, Instant.now().plusSeconds(900));
        });
    }

    @Transactional
    public void confirmPasswordReset(String code, String newPassword) {
        String codeHash = KauthPasswordHasher.sha256(code);
        var reset = passwordResetRepository.findActiveByCodeHash(codeHash)
                .orElseThrow(() -> ApiException.badRequest(ErrorCode.RESET_CODE_INVALID, "Неверный или просроченный код сброса пароля"));

        var user = userService.findAuthUserById(reset.userId())
                .orElseThrow(() -> ApiException.notFound(ErrorCode.USER_NOT_FOUND, "Пользователь не найден"));

        passwordValidator.validate(newPassword, user.login());

        passwordResetRepository.markAsUsed(reset.id());

        String newHash = passwordHasher.hashPassword(newPassword);
        userService.setPasswordForReset(reset.userId(), newHash);
        sessionRepository.closeAllUserSessions(reset.userId());
    }


    private String generateSecureToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }


    public record LoginResult(
            boolean isOtpRequired,
            String otpToken,
            String rawSessionCookie,
            MdUserService.AuthUser user,
            KauthSessionRepository.SessionRecord session
    ) {
        public static LoginResult requires2fa(String otpToken, Long userId) {
            return new LoginResult(true, otpToken, null, null, null);
        }

        public static LoginResult success(String rawSessionCookie, MdUserService.AuthUser user, KauthSessionRepository.SessionRecord session) {
            return new LoginResult(false, null, rawSessionCookie, user, session);
        }
    }
}
