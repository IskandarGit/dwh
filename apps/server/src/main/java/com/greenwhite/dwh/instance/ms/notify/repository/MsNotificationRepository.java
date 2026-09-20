package com.greenwhite.dwh.instance.ms.notify.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public class MsNotificationRepository {

    private final JdbcClient jdbcClient;

    public MsNotificationRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public NotificationRecord create(Long userId, String type, String title, String body, String formLink, String sourceCode) {
        return jdbcClient.sql("""
                insert into ms_notifications (user_id, type, title, body, form_link, source_code, is_read, created_at)
                values (:userId, :type, :title, :body, :formLink, :sourceCode, false, now())
                returning id, user_id, type, title, body, form_link, source_code, is_read, created_at
                """)
                .param("userId", userId)
                .param("type", type)
                .param("title", title)
                .param("body", body)
                .param("formLink", formLink)
                .param("sourceCode", sourceCode)
                .query((rs, rowNum) -> new NotificationRecord(
                        rs.getLong("id"),
                        rs.getLong("user_id"),
                        rs.getString("type"),
                        rs.getString("title"),
                        rs.getString("body"),
                        rs.getString("form_link"),
                        rs.getString("source_code"),
                        rs.getBoolean("is_read"),
                        rs.getTimestamp("created_at").toInstant()
                ))
                .single();
    }

    public List<NotificationRecord> listUserNotifications(Long userId, int limit) {
        return jdbcClient.sql("""
                select id, user_id, type, title, body, form_link, source_code, is_read, created_at
                from ms_notifications
                where user_id = :userId
                order by created_at desc
                limit :limit
                """)
                .param("userId", userId)
                .param("limit", limit)
                .query((rs, rowNum) -> new NotificationRecord(
                        rs.getLong("id"),
                        rs.getLong("user_id"),
                        rs.getString("type"),
                        rs.getString("title"),
                        rs.getString("body"),
                        rs.getString("form_link"),
                        rs.getString("source_code"),
                        rs.getBoolean("is_read"),
                        rs.getTimestamp("created_at").toInstant()
                ))
                .list();
    }

    public int getUnreadCount(Long userId) {
        return jdbcClient.sql("""
                select count(*) from ms_notifications
                where user_id = :userId and not is_read
                """)
                .param("userId", userId)
                .query(Integer.class)
                .single();
    }

    public void markAsRead(Long notificationId, Long userId) {
        jdbcClient.sql("""
                update ms_notifications
                set is_read = true
                where id = :notificationId and user_id = :userId
                """)
                .param("notificationId", notificationId)
                .param("userId", userId)
                .update();
    }

    public void markAllAsRead(Long userId) {
        jdbcClient.sql("""
                update ms_notifications
                set is_read = true
                where user_id = :userId and not is_read
                """)
                .param("userId", userId)
                .update();
    }

    public boolean hasRecentNotification(Long userId, String sourceCode, Instant since) {
        return Boolean.TRUE.equals(jdbcClient.sql("""
                select exists(
                    select 1 from ms_notifications
                    where user_id = :userId
                      and source_code = :sourceCode
                      and created_at >= :since
                )
                """)
                .param("userId", userId)
                .param("sourceCode", sourceCode)
                .param("since", java.sql.Timestamp.from(since))
                .query(Boolean.class)
                .single());
    }

    public record NotificationRecord(
            Long id,
            Long userId,
            String type,
            String title,
            String body,
            String formLink,
            String sourceCode,
            boolean isRead,
            Instant createdAt
    ) {}
}
