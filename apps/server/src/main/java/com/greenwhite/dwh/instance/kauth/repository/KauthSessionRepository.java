package com.greenwhite.dwh.instance.kauth.repository;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.greenwhite.dwh.instance.common.error.ApiException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class KauthSessionRepository {

    private static final RowMapper<SessionRecord> ROW_MAPPER = (rs, rowNum) -> new SessionRecord(
            rs.getLong("id"),
            rs.getLong("user_id"),
            rs.getString("token_hash"),
            rs.getString("ip_str"),
            rs.getString("user_agent"),
            rs.getString("device_info"),
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("last_seen_at").toInstant(),
            rs.getTimestamp("closed_at") != null ? rs.getTimestamp("closed_at").toInstant() : null,
            rs.getLong("auth_version")
    );

    private static final String SELECT = """
            select c.auth_version, c.id, c.user_id, c.token_hash, host(c.ip) as ip_str, c.user_agent, c.device_info, c.created_at, c.last_seen_at, c.closed_at
            from kauth_sessions c join md_users u on u.id = c.user_id
            """;
    private static final String ACTIVE = """
            c.closed_at is null
            and u.state = 'A' and u.auth_version = c.auth_version
            """;

    private final JdbcClient jdbcClient;

    public KauthSessionRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public SessionRecord create(Long userId, long authenticationVersion, String tokenHash, String ip, String userAgent, String deviceInfo) {
        return jdbcClient.sql("""
                insert into kauth_sessions (user_id, auth_version, token_hash, ip, user_agent, device_info, created_at, last_seen_at)
                select u.id, :authenticationVersion, :tokenHash, cast(:ip as inet), :userAgent, :deviceInfo, now(), now()
                from md_users u
                where u.id = :userId and u.state = 'A' and u.auth_version = :authenticationVersion
                returning auth_version, id, user_id, token_hash, host(ip) as ip_str, user_agent, device_info, created_at, last_seen_at, closed_at
                """)
                .param("userId", userId)
                .param("authenticationVersion", authenticationVersion)
                .param("tokenHash", tokenHash)
                .param("ip", ip)
                .param("userAgent", userAgent)
                .param("deviceInfo", deviceInfo)
                .query(ROW_MAPPER)
                .optional().orElseThrow(ApiException::invalidCredentials);
    }

    public Optional<SessionRecord> findActiveByTokenHash(String tokenHash) {
        return jdbcClient.sql(SELECT + " where c.token_hash = :tokenHash and " + ACTIVE)
                .param("tokenHash", tokenHash)
                .query(ROW_MAPPER)
                .optional();
    }

    public Optional<SessionRecord> findActiveById(Long id) {
        return jdbcClient.sql(SELECT + " where c.id = :id and " + ACTIVE)
                .param("id", id)
                .query(ROW_MAPPER)
                .optional();
    }

    public void updateLastSeen(Long sessionId) {
        jdbcClient.sql("""
                update kauth_sessions
                set last_seen_at = now()
                where id = :sessionId and closed_at is null
                """)
                .param("sessionId", sessionId)
                .update();
    }

    public void close(Long sessionId) {
        jdbcClient.sql("""
                update kauth_sessions
                set closed_at = now()
                where id = :sessionId and closed_at is null
                """)
                .param("sessionId", sessionId)
                .update();
    }

    public void closeAllUserSessions(Long userId) {
        jdbcClient.sql("""
                update kauth_sessions
                set closed_at = now()
                where user_id = :userId and closed_at is null
                """)
                .param("userId", userId)
                .update();
    }

    public int closeInactiveSessions(Instant cutoff) {
        return jdbcClient.sql("""
                update kauth_sessions
                set closed_at = now()
                where closed_at is null and last_seen_at < :cutoff
                """)
                .param("cutoff", java.sql.Timestamp.from(cutoff))
                .update();
    }



    public void closeOtherSessions(Long userId, Long currentSessionId) {
        jdbcClient.sql("""
                update kauth_sessions
                set closed_at = now()
                where user_id = :userId and id <> :currentSessionId and closed_at is null
                """)
                .param("userId", userId)
                .param("currentSessionId", currentSessionId)
                .update();
    }

    public List<SessionRecord> findActiveByUserId(Long userId) {
        return jdbcClient.sql(SELECT + " where c.user_id = :userId and " + ACTIVE + " order by c.last_seen_at desc")
                .param("userId", userId)
                .query(ROW_MAPPER)
                .list();
    }

    public record SessionRecord(
            Long id,
            Long userId,
            @JsonIgnore String tokenHash,
            String ip,
            String userAgent,
            String deviceInfo,
            Instant createdAt,
            Instant lastSeenAt,
            Instant closedAt,
            @JsonIgnore long authenticationVersion
    ) {}
}
