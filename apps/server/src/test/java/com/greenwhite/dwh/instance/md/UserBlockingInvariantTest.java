package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.service.KauthUserSessionInvalidator;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * R6: инвариант I-U1 (FR-USR-4) — блокировка пользователя закрывает все его
 * сессии и отзывает все API-токены. Реализация: MdUserService.setUserState →
 * порт UserSessionInvalidator → KauthUserSessionInvalidator (та же транзакция).
 */
@Testcontainers
class UserBlockingInvariantTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_block_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;

    @BeforeAll
    static void migrate() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = JdbcClient.create(ds);
    }

    @Test
    @DisplayName("I-U1: инвалидация закрывает все сессии и отзывает все токены пользователя")
    void invalidatorClosesSessionsAndRevokesTokens() {
        Long userId = jdbc.sql("""
                        insert into md_users (name, login, email, password_hash, state, language, timezone,
                                              attributes, is_2fa_enabled, force_password_change)
                        values ('Block Test', 'block_test', 'block@test.local', 'x', 'A', 'ru', 'UTC',
                                '{}'::jsonb, false, false)
                        returning id
                        """).query(Long.class).single();

        jdbc.sql("""
                insert into kauth_sessions (user_id, token_hash, ip, user_agent)
                values (:u, 'sh1', '127.0.0.1'::inet, 'ua'), (:u, 'sh2', '127.0.0.1'::inet, 'ua')
                """).param("u", userId).update();
        jdbc.sql("""
                insert into kauth_api_tokens (user_id, name, token_prefix, token_hash)
                values (:u, 'integration', 'pfx1', 'th1'), (:u, 'backup', 'pfx2', 'th2')
                """).param("u", userId).update();

        new KauthUserSessionInvalidator(
                new KauthSessionRepository(jdbc),
                new KauthApiTokenRepository(jdbc))
                .invalidateAllAccess(userId);

        Long openSessions = jdbc.sql(
                        "select count(*) from kauth_sessions where user_id = :u and closed_at is null")
                .param("u", userId).query(Long.class).single();
        Long activeTokens = jdbc.sql(
                        "select count(*) from kauth_api_tokens where user_id = :u and revoked_at is null")
                .param("u", userId).query(Long.class).single();

        assertThat(openSessions).as("открытых сессий после блокировки").isZero();
        assertThat(activeTokens).as("активных токенов после блокировки").isZero();
    }
}
