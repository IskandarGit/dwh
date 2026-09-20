package com.greenwhite.dwh.instance.kauth;

import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.provider.ProviderRegistry;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.kauth.repository.KauthChannelRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthLoginAttemptRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthOtpCodeRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthPasswordResetRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.service.KauthAuthService;
import com.greenwhite.dwh.instance.kauth.service.KauthChannelService;
import com.greenwhite.dwh.instance.kauth.service.KauthOtpSender;
import com.greenwhite.dwh.instance.kauth.service.KauthPasswordHasher;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import com.greenwhite.dwh.instance.md.service.PasswordValidator;
import com.greenwhite.dwh.spi.common.ProviderHealth;
import com.greenwhite.dwh.spi.mail.MailProvider;
import com.greenwhite.dwh.spi.messenger.MessengerMessage;
import com.greenwhite.dwh.spi.messenger.MessengerProvider;
import com.greenwhite.dwh.spi.messenger.MessengerSendResult;
import com.greenwhite.dwh.spi.sms.SmsProvider;
import com.greenwhite.dwh.spi.storage.StorageProvider;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * FR-AUTH-5: вход по второму фактору.
 *
 * Пересмотр M3 30.08 нашёл здесь два дефекта, каждый из которых делал 2FA
 * неработоспособной, а вместе — ещё и опасной:
 *
 * 1. Код создавался в базе и никуда не отправлялся: вызова провайдера не было.
 * 2. Проверка кода искала его так:
 *    {@code Long userId = extractUserIdFromOtpToken(otpToken); // return 1L;}
 *    — токен не был связан ни с чем, и любой непустой токен приводил к коду
 *    администратора.
 *
 * Эти тесты закрепляют оба свойства: код действительно уходит в канал, а найти
 * его можно только по своему токену.
 */
@Testcontainers
class KauthOtpLoginIntegrationTest {

    private static final Pattern CODE = Pattern.compile("(\\d{6})");
    private static final String PASSWORD = "OtpProbe-Pass-2026"; // gitleaks:allow -- isolated test credential

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_otp_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;
    static KauthAuthService authService;
    static KauthChannelService channelService;
    static KauthChannelRepository channelRepository;
    static KauthOtpCodeRepository otpCodeRepository;
    static CapturingMessenger messenger;

    @BeforeAll
    static void setup() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);

        var mapper = new ObjectMapper();
        var userRepository = new MdUserRepository(jdbc, mapper);
        var auditLogService = new AuditLogService(new AuditLogRepository(jdbc, mapper), null,
                new AuditDataRedactor());
        channelRepository = new KauthChannelRepository(jdbc);
        otpCodeRepository = new KauthOtpCodeRepository(jdbc);
        messenger = new CapturingMessenger();

        var registry = new ProviderRegistry(
                List.of(storageStub()), List.of(mailStub()), List.of(smsStub()), List.of(messenger),
                "local", "console_mail", "console_sms", "telegram");
        var sender = new KauthOtpSender(registry);
        channelService = new KauthChannelService(channelRepository, otpCodeRepository, sender, auditLogService,
                new com.greenwhite.dwh.instance.kauth.service.KauthCredentialGuard(new KauthSessionRepository(jdbc),
                        new com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository(jdbc)));

        var scopes = new com.greenwhite.dwh.instance.md.service.MdScopeService(
                new com.greenwhite.dwh.instance.md.repository.MdScopeRepository(jdbc),
                new com.greenwhite.dwh.instance.md.repository.MdOrgUnitRepository(jdbc),
                new com.greenwhite.dwh.instance.md.service.MdPermissionService(new com.greenwhite.dwh.instance.md.repository.MdPermissionRepository(jdbc)),
                auditLogService);
        var userService = new com.greenwhite.dwh.instance.md.service.MdUserService(
                userRepository,
                new com.greenwhite.dwh.instance.md.repository.MdRoleRepository(jdbc),
                new com.greenwhite.dwh.instance.md.service.MdCustomFieldService(new com.greenwhite.dwh.instance.md.repository.MdCustomFieldRepository(jdbc, mapper), auditLogService),
                new KauthPasswordHasher(),
                new PasswordValidator(),
                Mockito.mock(com.greenwhite.dwh.instance.md.service.UserSessionInvalidator.class),
                Mockito.mock(com.greenwhite.dwh.instance.search.SearchChangePublisher.class),
                auditLogService,
                scopes);

        authService = new KauthAuthService(
                userService,
                new KauthSessionRepository(jdbc),
                new KauthLoginAttemptRepository(jdbc),
                otpCodeRepository,
                new KauthPasswordResetRepository(jdbc),
                new KauthPasswordHasher(),
                new PasswordValidator(),
                auditLogService,
                channelService,
                sender);
    }

    @Test
    @DisplayName("Код второго фактора действительно уходит в канал пользователя")
    void loginCodeIsDelivered() {
        Long userId = createUserWith2fa("otp_delivery", "chat-delivery");
        messenger.sent.clear();

        var result = authService.login("otp_delivery", PASSWORD, "10.0.0.1", "ua", "dev");

        assertThat(result.isOtpRequired()).isTrue();
        assertThat(messenger.sent).hasSize(1);
        assertThat(messenger.sent.getFirst().recipientChatId()).isEqualTo("chat-delivery");
        assertThat(extractCode(messenger.sent.getFirst().textMarkdown())).hasSize(6);
    }

    @Test
    @DisplayName("Свой токен и свой код открывают сессию своего пользователя")
    void ownTokenOpensOwnSession() {
        Long userId = createUserWith2fa("otp_own", "chat-own");
        messenger.sent.clear();

        var login = authService.login("otp_own", PASSWORD, "10.0.0.2", "ua", "dev");
        String code = extractCode(messenger.sent.getFirst().textMarkdown());

        var verified = authService.verifyOtp(login.otpToken(), code, "10.0.0.2", "ua", "dev");

        assertThat(verified.isOtpRequired()).isFalse();
        assertThat(verified.user().id()).isEqualTo(userId);
        assertThat(verified.rawSessionCookie()).isNotBlank();
    }

    @Test
    @DisplayName("Чужой код по своему токену не подходит: коды больше не общие")
    void othersCodeDoesNotFitOwnToken() {
        createUserWith2fa("otp_first", "chat-first");
        createUserWith2fa("otp_second", "chat-second");

        messenger.sent.clear();
        var first = authService.login("otp_first", PASSWORD, "10.0.0.3", "ua", "dev");
        String firstCode = extractCode(messenger.sent.getFirst().textMarkdown());

        messenger.sent.clear();
        var second = authService.login("otp_second", PASSWORD, "10.0.0.4", "ua", "dev");

        assertThatThrownBy(() -> authService.verifyOtp(second.otpToken(), firstCode, "10.0.0.4", "ua", "dev"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Неверный код");
    }

    @Test
    @DisplayName("Выдуманный токен не открывает ничего — регрессия на захардкоженный userId=1")
    void forgedTokenIsRejected() {
        createUserWith2fa("otp_victim", "chat-victim");
        messenger.sent.clear();
        var login = authService.login("otp_victim", PASSWORD, "10.0.0.5", "ua", "dev");
        String code = extractCode(messenger.sent.getFirst().textMarkdown());

        // До V015 любой непустой токен приводил к коду пользователя с id = 1
        assertThatThrownBy(() -> authService.verifyOtp("forged-token", code, "10.0.0.6", "ua", "dev"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Некорректный OTP токен");
    }

    @Test
    @DisplayName("Без подтверждённого канала вход отклоняется, а код не выпускается")
    void loginWithoutVerifiedChannelIsRejected() {
        Long userId = createUser("otp_no_channel");
        enable2fa(userId);
        // канал привязан, но не подтверждён — отправлять код туда нельзя
        channelRepository.bindOrUpdate(userId, "telegram", "chat-unverified", false);
        long before = countOtpCodes(userId);

        assertThatThrownBy(() -> authService.login("otp_no_channel", PASSWORD, "10.0.0.7", "ua", "dev"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("подтверждённого канала связи нет");

        assertThat(countOtpCodes(userId))
                .as("код, который некуда отправить, выпускать нельзя").isEqualTo(before);
    }

    @Test
    @DisplayName("Привязка канала подтверждается кодом, пришедшим на этот адрес")
    void channelBecomesVerifiedOnlyAfterConfirmation() {
        Long userId = createUser("otp_bind");
        messenger.sent.clear();

        String verifyToken = channelService.bindChannel(principal(userId), "telegram", "chat-bind");
        assertThat(channelRepository.findByUserIdAndChannel(userId, "telegram").orElseThrow().isVerified())
                .as("до подтверждения канал не считается своим").isFalse();

        String code = extractCode(messenger.sent.getFirst().textMarkdown());
        channelService.confirmChannel(principal(userId), verifyToken, code);

        assertThat(channelRepository.findByUserIdAndChannel(userId, "telegram").orElseThrow().isVerified()).isTrue();
    }

    @Test
    @DisplayName("Неверный код подтверждения канала не делает его подтверждённым")
    void wrongConfirmationCodeKeepsChannelUnverified() {
        Long userId = createUser("otp_bind_wrong");
        messenger.sent.clear();
        String verifyToken = channelService.bindChannel(principal(userId), "telegram", "chat-bind-wrong");

        assertThatThrownBy(() -> channelService.confirmChannel(principal(userId), verifyToken, "000000"))
                .isInstanceOf(ApiException.class);

        assertThat(channelRepository.findByUserIdAndChannel(userId, "telegram").orElseThrow().isVerified()).isFalse();
    }

    private static com.greenwhite.dwh.instance.common.security.SecurityContext.KauthPrincipal principal(Long userId) {
        var session = new KauthSessionRepository(jdbc).create(userId, 0, java.util.UUID.randomUUID().toString(), "127.0.0.1", "test", "test");
        return new com.greenwhite.dwh.instance.common.security.SecurityContext.KauthPrincipal(userId, "test", "test", session.id(), false, java.util.Set.of(), 1, false, 0, null);
    }

    // ------------------------------------------------------------- вспомогательное

    private static String extractCode(String text) {
        Matcher m = CODE.matcher(text);
        assertThat(m.find()).as("в сообщении должен быть шестизначный код").isTrue();
        return m.group(1);
    }

    private static Long createUser(String login) {
        String hash = new KauthPasswordHasher().hashPassword(PASSWORD);
        return jdbc.sql("""
                        insert into md_users (name, login, email, password_hash, state, language, timezone,
                                              attributes, is_2fa_enabled, force_password_change)
                        values (:login, :login, :login || '@test.local', :hash, 'A', 'ru', 'UTC',
                                '{}'::jsonb, false, false)
                        returning id
                        """)
                .param("login", login)
                .param("hash", hash)
                .query(Long.class).single();
    }

    private static Long createUserWith2fa(String login, String chatId) {
        Long userId = createUser(login);
        enable2fa(userId);
        channelRepository.bindOrUpdate(userId, "telegram", chatId, true);
        return userId;
    }

    private static void enable2fa(Long userId) {
        jdbc.sql("update md_users set is_2fa_enabled = true where id = :id").param("id", userId).update();
    }

    private static long countOtpCodes(Long userId) {
        return jdbc.sql("select count(*) from kauth_otp_codes where user_id = :id")
                .param("id", userId).query(Long.class).single();
    }

    /** Провайдер, который запоминает отправленное: только так видно, что код вообще уходит. */
    static class CapturingMessenger implements MessengerProvider {
        final List<MessengerMessage> sent = new ArrayList<>();

        @Override
        public String getProviderCode() {
            return "telegram";
        }

        @Override
        public MessengerSendResult send(MessengerMessage message) {
            sent.add(message);
            return MessengerSendResult.success("captured", 1);
        }

        @Override
        public ProviderHealth checkHealth() {
            return ProviderHealth.healthy(getProviderCode(), 1);
        }
    }

    private static StorageProvider storageStub() {
        StorageProvider stub = Mockito.mock(StorageProvider.class);
        when(stub.getProviderCode()).thenReturn("local");
        return stub;
    }

    private static MailProvider mailStub() {
        MailProvider stub = Mockito.mock(MailProvider.class);
        when(stub.getProviderCode()).thenReturn("console_mail");
        return stub;
    }

    private static SmsProvider smsStub() {
        SmsProvider stub = Mockito.mock(SmsProvider.class);
        when(stub.getProviderCode()).thenReturn("console_sms");
        return stub;
    }
}
