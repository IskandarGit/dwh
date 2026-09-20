package com.greenwhite.dwh.instance.ms.notify.service;

import com.greenwhite.dwh.instance.ms.notify.repository.MsAnnouncementRepository;
import com.greenwhite.dwh.instance.ms.notify.repository.MsNotificationRepository;
import com.greenwhite.dwh.instance.ms.notify.repository.MsOutboxRepository;
import com.greenwhite.dwh.instance.ms.notify.sse.MsNotificationCreatedEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class MsNotificationService {

    private final MsNotificationRepository notificationRepository;
    private final MsOutboxRepository outboxRepository;
    private final MsAnnouncementRepository announcementRepository;
    private final ApplicationEventPublisher eventPublisher;

    public MsNotificationService(
            MsNotificationRepository notificationRepository,
            MsOutboxRepository outboxRepository,
            MsAnnouncementRepository announcementRepository,
            ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
        this.notificationRepository = notificationRepository;
        this.outboxRepository = outboxRepository;
        this.announcementRepository = announcementRepository;
    }

    @Transactional
    public void sendInAppNotification(Long userId, String type, String title, String body, String formLink, String sourceCode) {
        var created = notificationRepository.create(userId, type, title, body, formLink, sourceCode);
        // Доставка в открытые SSE-потоки произойдёт после коммита (MsSsePublisher)
        eventPublisher.publishEvent(new MsNotificationCreatedEvent(userId, created));
    }

    @Transactional
    public void enqueueExternalNotification(String channel, String recipient, String templateCode,
                                           Map<String, Object> payload, UUID idempotencyKey) {
        outboxRepository.enqueue(channel, recipient, templateCode, payload, idempotencyKey);
    }

    @Transactional(readOnly = true)
    public List<MsNotificationRepository.NotificationRecord> getUserNotifications(Long userId, int limit) {
        return notificationRepository.listUserNotifications(userId, limit);
    }

    @Transactional(readOnly = true)
    public int getUnreadCount(Long userId) {
        return notificationRepository.getUnreadCount(userId);
    }

    @Transactional
    public void markAsRead(Long notificationId, Long userId) {
        notificationRepository.markAsRead(notificationId, userId);
    }

    @Transactional
    public void markAllAsRead(Long userId) {
        notificationRepository.markAllAsRead(userId);
    }

    @Transactional(readOnly = true)
    public List<MsAnnouncementRepository.AnnouncementRecord> getActiveAnnouncements(Long userId, String language) {
        return announcementRepository.getActiveUnreadAnnouncements(userId, language);
    }

    @Transactional
    public void markAnnouncementAsRead(Long announcementId, Long userId) {
        announcementRepository.markAsRead(announcementId, userId);
    }

    @Transactional(readOnly = true)
    public boolean hasRecentNotification(Long userId, String sourceCode, java.time.Duration window) {
        return notificationRepository.hasRecentNotification(userId, sourceCode, java.time.Instant.now().minus(window));
    }
}
