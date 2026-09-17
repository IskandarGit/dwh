package com.greenwhite.dwh.instance.config.idempotency;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.mockito.Mockito.*;

class IdempotencyCleanupWorkerTest {

    @Test
    @DisplayName("Воркер очистки вызывает cleanupOldKeys с настроенным retention-days")
    void shouldCallCleanupOldKeys() {
        IdempotencyService service = Mockito.mock(IdempotencyService.class);
        when(service.cleanupOldKeys(14)).thenReturn(10);

        IdempotencyCleanupWorker worker = new IdempotencyCleanupWorker(service, 14);
        worker.cleanupOldKeys();

        verify(service).cleanupOldKeys(14);
    }

    @Test
    @DisplayName("Исключение в сервисе не ломает выполнение воркера")
    void shouldHandleExceptionGracefully() {
        IdempotencyService service = Mockito.mock(IdempotencyService.class);
        when(service.cleanupOldKeys(anyInt())).thenThrow(new RuntimeException("Database error"));

        IdempotencyCleanupWorker worker = new IdempotencyCleanupWorker(service, 14);
        worker.cleanupOldKeys();

        verify(service).cleanupOldKeys(14);
    }
}
