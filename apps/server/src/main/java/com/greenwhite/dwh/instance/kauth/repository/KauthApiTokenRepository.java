package com.greenwhite.dwh.instance.kauth.repository;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.greenwhite.dwh.instance.common.error.ApiException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class KauthApiTokenRepository {

    private static final RowMapper<ApiTokenRecord> ROW_MAPPER = (rs, rowNum) -> new ApiTokenRecord(
            rs.getLong("id"),
            rs.getLong("user_id"),
            rs.getString("name"),
            rs.getString("token_prefix"),
            rs.getString("token_hash"),
            rs.getTimestamp("expires_at") != null ? rs.getTimestamp("expires_at").toInstant() : null,
            rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("last_used_at") != null ? rs.getTimestamp("last_used_at").toInstant() : null,
            rs.getTimestamp("revoked_at") != null ? rs.getTimestamp("revoked_at").toInstant() : null,
            rs.getLong("auth_version")
    );

    private static final String SELECT = """
            select c.auth_version, c.id, c.user_id, c.name, c.token_prefix, c.token_hash, c.expires_at, c.created_at, c.last_used_at, c.revoked_at
            from kauth_api_tokens c join md_users u on u.id = c.user_id
            """;
    private static final String ACTIVE = """
            c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
            and u.state = 'A' and u.auth_version = c.auth_version
            """;

    private final JdbcClient jdbcClient;

    public KauthApiTokenRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public ApiTokenRecord create(Long userId, long authenticationVersion, String name, String tokenPrefix, String tokenHash, Instant expiresAt) {
        return jdbcClient.sql("""
                insert into kauth_api_tokens (user_id, auth_version, name, token_prefix, token_hash, expires_at, created_at)
                select u.id, :authenticationVersion, :name, :tokenPrefix, :tokenHash, :expiresAt, now()
                from md_users u
                where u.id = :userId and u.state = 'A' and u.auth_version = :authenticationVersion
                returning auth_version, id, user_id, name, token_prefix, token_hash, expires_at, created_at, last_used_at, revoked_at
                """)
                .param("userId", userId)
                .param("authenticationVersion", authenticationVersion)
                .param("name", name)
                .param("tokenPrefix", tokenPrefix)
                .param("tokenHash", tokenHash)
                .param("expiresAt", expiresAt != null ? Timestamp.from(expiresAt) : null)
                .query(ROW_MAPPER)
                .optional().orElseThrow(ApiException::invalidCredentials);
    }

    public Optional<ApiTokenRecord> findActiveByTokenHash(String tokenHash) {
        return jdbcClient.sql(SELECT + " where c.token_hash = :tokenHash and " + ACTIVE)
                .param("tokenHash", tokenHash)
                .query(ROW_MAPPER)
                .optional();
    }

    public Optional<ApiTokenRecord> findActiveById(Long id) {
        return jdbcClient.sql(SELECT + " where c.id = :id and " + ACTIVE)
                .param("id", id)
                .query(ROW_MAPPER)
                .optional();
    }

    public List<ApiTokenRecord> findByUserId(Long userId) {
        return jdbcClient.sql(SELECT + " where c.user_id = :userId order by c.created_at desc")
                .param("userId", userId)
                .query(ROW_MAPPER)
                .list();
    }

    public void updateLastUsed(Long tokenId) {
        jdbcClient.sql("""
                update kauth_api_tokens
                set last_used_at = now()
                where id = :tokenId
                """)
                .param("tokenId", tokenId)
                .update();
    }

    public void revoke(Long tokenId, Long userId) {
        jdbcClient.sql("""
                update kauth_api_tokens
                set revoked_at = now()
                where id = :tokenId and user_id = :userId and revoked_at is null
                """)
                .param("tokenId", tokenId)
                .param("userId", userId)
                .update();
    }

    /** Массовый отзыв всех активных токенов пользователя (инвариант I-U1). */
    public void revokeAllUserTokens(Long userId) {
        jdbcClient.sql("update kauth_api_tokens set revoked_at = now() where user_id = :userId and revoked_at is null")
                .param("userId", userId)
                .update();
    }

    public record ApiTokenRecord(
            Long id,
            Long userId,
            String name,
            String tokenPrefix,
            @JsonIgnore String tokenHash,
            Instant expiresAt,
            Instant createdAt,
            Instant lastUsedAt,
            Instant revokedAt,
            @JsonIgnore long authenticationVersion
    ) {}
}
