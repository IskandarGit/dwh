package com.greenwhite.dwh.instance.config.idempotency;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Фоновый воркер очистки устаревших записей идемпотентности (I-04).
 * Записи старше retention-days (по умолчанию 14 дней) удаляются по расписанию.
 */
@Component
@Profile("!migrate")
public class IdempotencyCleanupWorker {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyCleanupWorker.class);

    private final IdempotencyService idempotencyService;
    private final int retentionDays;

    public IdempotencyCleanupWorker(
            IdempotencyService idempotencyService,
            @Value("${dwh.idempotency.retention-days:14}") int retentionDays
    ) {
        this.idempotencyService = idempotencyService;
        this.retentionDays = retentionDays;
    }

    @Scheduled(cron = "${dwh.idempotency.cleanup-cron:0 15 2 * * *}", zone = "UTC")
    public void cleanupOldKeys() {
        try {
            int deleted = idempotencyService.cleanupOldKeys(retentionDays);
            if (deleted > 0) {
                log.info("Удалено {} устаревших записей идемпотентности (> {} дн.)", deleted, retentionDays);
            }
        } catch (Exception e) {
            log.error("Ошибка при выполнении плановой очистки ключей идемпотентности: {}", e.getMessage(), e);
        }
    }
}
