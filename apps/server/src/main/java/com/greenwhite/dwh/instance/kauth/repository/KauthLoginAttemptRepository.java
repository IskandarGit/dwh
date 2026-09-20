package com.greenwhite.dwh.instance.kauth.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;

@Repository
public class KauthLoginAttemptRepository {

    private final JdbcClient jdbcClient;

    public KauthLoginAttemptRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public void recordAttempt(String login, String ip, boolean isSuccess, String failureReason) {
        jdbcClient.sql("""
                insert into kauth_login_attempts (login, ip, is_success, failure_reason, attempt_at)
                values (:login, cast(:ip as inet), :isSuccess, :failureReason, now())
                """)
                .param("login", login)
                .param("ip", ip)
                .param("isSuccess", isSuccess)
                .param("failureReason", failureReason)
                .update();
    }

    public int countFailedAttemptsForIpSince(String ip, Instant since) {
        return jdbcClient.sql("""
                select count(*) from kauth_login_attempts
                where ip = cast(:ip as inet) and not is_success and attempt_at >= :since
                """)
                .param("ip", ip)
                .param("since", Timestamp.from(since))
                .query(Integer.class)
                .single();
    }

    public int countFailedAttemptsForLoginSince(String login, Instant since) {
        return jdbcClient.sql("""
                select count(*) from kauth_login_attempts
                where login = :login and not is_success and attempt_at >= :since
                """)
                .param("login", login)
                .param("since", Timestamp.from(since))
                .query(Integer.class)
                .single();
    }

    public record LoginAttemptRecord(
            Long id,
            String login,
            String ip,
            boolean isSuccess,
            String failureReason,
            Instant attemptAt
    ) {}

    public java.util.List<LoginAttemptRecord> findRecentAttemptsForLogin(String login, int limit) {
        return jdbcClient.sql("""
                select id, login, host(ip) as ip, is_success, failure_reason, attempt_at
                from kauth_login_attempts
                where lower(login) = lower(:login)
                order by attempt_at desc, id desc
                limit :limit
                """)
                .param("login", login)
                .param("limit", limit)
                .query((rs, rowNum) -> new LoginAttemptRecord(
                        rs.getLong("id"),
                        rs.getString("login"),
                        rs.getString("ip"),
                        rs.getBoolean("is_success"),
                        rs.getString("failure_reason"),
                        rs.getTimestamp("attempt_at").toInstant()
                ))
                .list();
    }
}
