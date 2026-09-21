package com.greenwhite.dwh.instance.config.idempotency;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class IdempotencyServiceTest {

    private final IdempotencyRepository repository = Mockito.mock(IdempotencyRepository.class);
    private final IdempotencyService service = new IdempotencyService(repository);

    @Test
    @DisplayName("Вычисление хэша запроса должно быть детерминированным для одинаковых параметров")
    void shouldComputeDeterministicRequestHash() {
        byte[] body = "{\"title\":\"Sample task\"}".getBytes(StandardCharsets.UTF_8);

        String hash1 = service.computeRequestHash("POST", "/api/v1/tasks/items", null, body);
        String hash2 = service.computeRequestHash("POST", "/api/v1/tasks/items", null, body);

        assertThat(hash1).isNotNull().isEqualTo(hash2);

        byte[] differentBody = "{\"title\":\"Different task\"}".getBytes(StandardCharsets.UTF_8);
        String hash3 = service.computeRequestHash("POST", "/api/v1/tasks/items", null, differentBody);

        assertThat(hash1).isNotEqualTo(hash3);
    }

    @Test
    @DisplayName("Поиск существующего ключа должен возвращать запись из репозитория")
    void shouldFindExistingKey() {
        UUID key = UUID.randomUUID();
        var record = new IdempotencyRepository.IdempotencyRecord(
                key, 1L, "abc123hash", 200, "{\"id\":42}",
                IdempotencyRepository.State.COMPLETED, Instant.now()
        );

        when(repository.tryReserve(eq(key), eq(1L), eq("abc123hash"), any(UUID.class), any(Instant.class))).thenReturn(false);
        when(repository.findByKey(key)).thenReturn(Optional.of(record));

        var result = service.claim(key, 1L, "abc123hash");

        assertThat(result.state()).isEqualTo(IdempotencyService.ClaimState.REPLAY);
        assertThat(result.existing().key()).isEqualTo(key);
        assertThat(result.existing().responseStatus()).isEqualTo(200);
        assertThat(result.existing().responseBody()).isEqualTo("{\"id\":42}");
    }

    @Test
    @DisplayName("Завершение резервации должно сохранять ответ только по token владельца")
    void shouldCompleteOwnedReservation() {
        UUID key = UUID.randomUUID();
        UUID reservationToken = UUID.randomUUID();
        when(repository.complete(key, reservationToken, 201, "{\"id\":100}"))
                .thenReturn(true);

        service.complete(key, reservationToken, 201, "{\"id\":100}");

        verify(repository).complete(key, reservationToken, 201, "{\"id\":100}");
    }

    @Test
    @DisplayName("Успешный захват резервации должен возвращать ACQUIRED с reservation token")
    void shouldAcquireNewReservation() {
        UUID key = UUID.randomUUID();
        when(repository.tryReserve(eq(key), eq(2L), eq("reqhash"), any(UUID.class), any(Instant.class)))
                .thenReturn(true);

        var result = service.claim(key, 2L, "reqhash");

        assertThat(result.state()).isEqualTo(IdempotencyService.ClaimState.ACQUIRED);
        assertThat(result.reservationToken()).isNotNull();
    }

    @Test
    @DisplayName("Очистка устаревших ключей должна вызывать удаление записей старше N дней")
    void shouldCleanupOldKeys() {
        when(repository.deleteOlderThan(any(Instant.class))).thenReturn(5);

        int deleted = service.cleanupOldKeys(14);

        assertThat(deleted).isEqualTo(5);
        verify(repository).deleteOlderThan(any(Instant.class));
    }
}
