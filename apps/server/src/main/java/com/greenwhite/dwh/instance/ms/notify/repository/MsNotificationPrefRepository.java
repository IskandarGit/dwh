package com.greenwhite.dwh.instance.ms.notify.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class MsNotificationPrefRepository {

    private final JdbcClient jdbcClient;

    public MsNotificationPrefRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<NotificationPrefRecord> findByUserId(Long userId) {
        return jdbcClient.sql("""
                select user_id, event_type, channel, is_enabled
                from ms_notification_prefs
                where user_id = :userId
                order by event_type, channel
                """)
                .param("userId", userId)
                .query((rs, rowNum) -> new NotificationPrefRecord(
                        rs.getLong("user_id"),
                        rs.getString("event_type"),
                        rs.getString("channel"),
                        rs.getBoolean("is_enabled")
                ))
                .list();
    }

    public void upsert(Long userId, String eventType, String channel, boolean isEnabled) {
        jdbcClient.sql("""
                insert into ms_notification_prefs (user_id, event_type, channel, is_enabled)
                values (:userId, :eventType, :channel, :isEnabled)
                on conflict (user_id, event_type, channel)
                do update set is_enabled = :isEnabled
                """)
                .param("userId", userId)
                .param("eventType", eventType)
                .param("channel", channel)
                .param("isEnabled", isEnabled)
                .update();
    }

    public boolean isEnabled(Long userId, String eventType, String channel, boolean defaultValue) {
        return jdbcClient.sql("""
                select is_enabled
                from ms_notification_prefs
                where user_id = :userId and event_type = :eventType and channel = :channel
                """)
                .param("userId", userId)
                .param("eventType", eventType)
                .param("channel", channel)
                .query(Boolean.class)
                .optional()
                .orElse(defaultValue);
    }

    public record NotificationPrefRecord(
            Long userId,
            String eventType,
            String channel,
            boolean isEnabled
    ) {}
}
