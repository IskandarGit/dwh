package com.greenwhite.dwh.instance.config.idempotency;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class IdempotencyRepository {

    public enum State {
        PENDING,
        COMPLETED
    }

    private final JdbcClient jdbcClient;

    public IdempotencyRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public record IdempotencyRecord(
            UUID key,
            Long userId,
            String requestHash,
            Integer responseStatus,
            String responseBody,
            State state,
            Instant createdAt
    ) {}

    public Optional<IdempotencyRecord> findByKey(UUID key) {
        return jdbcClient.sql("""
                select key, user_id, request_hash, response_status, response_body::text, state, created_at
                from idempotency_keys
                where key = :key
                """)
                .param("key", key)
                .query((rs, rowNum) -> new IdempotencyRecord(
                        UUID.fromString(rs.getString("key")),
                        rs.getObject("user_id", Long.class),
                        rs.getString("request_hash"),
                        rs.getObject("response_status", Integer.class),
                        rs.getString("response_body"),
                        State.valueOf(rs.getString("state")),
                        rs.getTimestamp("created_at").toInstant()
                ))
                .optional();
    }

    public boolean tryReserve(UUID key, Long userId, String requestHash, UUID reservationToken, Instant expiredCutoff) {
        return jdbcClient.sql("""
                insert into idempotency_keys
                    (key, user_id, request_hash, response_status, response_body, state, reservation_token, created_at)
                values (:key, :userId, :requestHash, null, null, 'PENDING', :reservationToken, now())
                on conflict (key) do update
                set reservation_token = :reservationToken,
                    user_id = :userId,
                    request_hash = :requestHash,
                    created_at = now()
                where idempotency_keys.state = 'PENDING'
                  and idempotency_keys.created_at < :expiredCutoff
                """)
                .param("key", key)
                .param("userId", userId)
                .param("requestHash", requestHash)
                .param("reservationToken", reservationToken)
                .param("expiredCutoff", Timestamp.from(expiredCutoff))
                .update() == 1;
    }

    public boolean tryReserve(UUID key, Long userId, String requestHash, UUID reservationToken) {
        return tryReserve(key, userId, requestHash, reservationToken, Instant.now().minusSeconds(120));
    }

    public boolean complete(UUID key, UUID reservationToken, int responseStatus, String responseBodyJson) {
        String safeBody = (responseBodyJson == null || responseBodyJson.isBlank()) ? "{}" : responseBodyJson;
        return jdbcClient.sql("""
                update idempotency_keys
                set response_status = :responseStatus,
                    response_body = :responseBody::jsonb,
                    state = 'COMPLETED',
                    reservation_token = null
                where key = :key
                  and state = 'PENDING'
                  and reservation_token = :reservationToken
                """)
                .param("key", key)
                .param("responseStatus", responseStatus)
                .param("responseBody", safeBody)
                .param("reservationToken", reservationToken)
                .update() == 1;
    }

    public void release(UUID key, UUID reservationToken) {
        jdbcClient.sql("""
                delete from idempotency_keys
                where key = :key
                  and state = 'PENDING'
                  and reservation_token = :reservationToken
                """)
                .param("key", key)
                .param("reservationToken", reservationToken)
                .update();
    }

    public int deleteOlderThan(Instant cutoff) {
        return jdbcClient.sql("delete from idempotency_keys where created_at < :cutoff")
                .param("cutoff", Timestamp.from(cutoff))
                .update();
    }
}
