package com.greenwhite.dwh.instance.ms.notify.worker;

import com.greenwhite.dwh.instance.ms.notify.repository.MsOutboxRepository;
import com.greenwhite.dwh.spi.mail.MailMessage;
import com.greenwhite.dwh.spi.mail.MailProvider;
import com.greenwhite.dwh.spi.mail.MailSendResult;
import com.greenwhite.dwh.spi.messenger.MessengerMessage;
import com.greenwhite.dwh.spi.messenger.MessengerProvider;
import com.greenwhite.dwh.spi.messenger.MessengerSendResult;
import com.greenwhite.dwh.spi.sms.SmsMessage;
import com.greenwhite.dwh.spi.sms.SmsProvider;
import com.greenwhite.dwh.spi.sms.SmsSendResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class MsOutboxWorkerTest {

    private final MsOutboxRepository outboxRepository = Mockito.mock(MsOutboxRepository.class);
    private final MailProvider mailProvider = Mockito.mock(MailProvider.class);
    private final SmsProvider smsProvider = Mockito.mock(SmsProvider.class);
    private final MessengerProvider messengerProvider = Mockito.mock(MessengerProvider.class);

    private final MsOutboxWorker worker = new MsOutboxWorker(
            outboxRepository, mailProvider, smsProvider, messengerProvider);

    @Test
    @DisplayName("Успешная доставка Email отмечает запись как SUCCESS")
    void deliversEmailSuccessfully() {
        UUID claimToken = UUID.randomUUID();
        UUID idempotencyKey = UUID.randomUUID();
        var item = new MsOutboxRepository.OutboxRecord(
                1L, "email", "dev@example.com", "TASK_ASSIGNED",
                Map.of("subject", "Новая задача", "body", "Вам назначена задача #42"),
                "PROCESSING", 0, 3,
                Instant.now(), idempotencyKey, null, Instant.now(), null,
                claimToken, Instant.now()
        );

        when(outboxRepository.fetchPending(20)).thenReturn(List.of(item));
        when(mailProvider.send(any(MailMessage.class))).thenReturn(MailSendResult.success("msg-1", 50));

        worker.processOutbox();

        ArgumentCaptor<MailMessage> captor = ArgumentCaptor.forClass(MailMessage.class);
        verify(mailProvider).send(captor.capture());
        assertThat(captor.getValue().recipientEmail()).isEqualTo("dev@example.com");
        assertThat(captor.getValue().subject()).isEqualTo("Новая задача");
        assertThat(captor.getValue().htmlBody()).isEqualTo("Вам назначена задача #42");

        verify(outboxRepository).markSuccess(1L, claimToken);
    }

    @Test
    @DisplayName("Успешная доставка Telegram отмечает запись как SUCCESS")
    void deliversTelegramSuccessfully() {
        UUID claimToken = UUID.randomUUID();
        UUID idempotencyKey = UUID.randomUUID();
        var item = new MsOutboxRepository.OutboxRecord(
                2L, "telegram", "123456789", "TASK_ASSIGNED",
                Map.of("body", "Вам назначена задача #42"),
                "PROCESSING", 0, 3,
                Instant.now(), idempotencyKey, null, Instant.now(), null,
                claimToken, Instant.now()
        );

        when(outboxRepository.fetchPending(20)).thenReturn(List.of(item));
        when(messengerProvider.send(any(MessengerMessage.class))).thenReturn(MessengerSendResult.success("msg-2", 30));

        worker.processOutbox();

        ArgumentCaptor<MessengerMessage> captor = ArgumentCaptor.forClass(MessengerMessage.class);
        verify(messengerProvider).send(captor.capture());
        assertThat(captor.getValue().recipientChatId()).isEqualTo("123456789");
        assertThat(captor.getValue().textMarkdown()).isEqualTo("Вам назначена задача #42");

        verify(outboxRepository).markSuccess(2L, claimToken);
    }

    @Test
    @DisplayName("Ошибка провайдера вызывает markFailed с экспоненциальной задержкой")
    void handlesProviderFailureWithRetry() {
        UUID claimToken = UUID.randomUUID();
        UUID idempotencyKey = UUID.randomUUID();
        var item = new MsOutboxRepository.OutboxRecord(
                3L, "email", "fail@example.com", "TASK_ASSIGNED",
                Map.of("subject", "Тест", "body", "Текст"),
                "PROCESSING", 0, 3,
                Instant.now(), idempotencyKey, null, Instant.now(), null,
                claimToken, Instant.now()
        );

        when(outboxRepository.fetchPending(20)).thenReturn(List.of(item));
        when(mailProvider.send(any(MailMessage.class))).thenReturn(MailSendResult.failure("SMTP_ERR", "SMTP connection timeout", 100));

        worker.processOutbox();

        verify(outboxRepository).markFailed(
                eq(3L),
                eq(claimToken),
                eq(1),
                any(Instant.class),
                eq("Email failed: SMTP connection timeout"),
                eq(false)
        );
    }

    @Test
    @DisplayName("Превышение максимального числа попыток помечает запись как dead-letter")
    void marksDeadLetterWhenMaxAttemptsReached() {
        UUID claimToken = UUID.randomUUID();
        UUID idempotencyKey = UUID.randomUUID();
        var item = new MsOutboxRepository.OutboxRecord(
                4L, "sms", "+998901234567", "TASK_DEADLINE",
                Map.of("body", "Дедлайн"),
                "PROCESSING", 2, 3,
                Instant.now(), idempotencyKey, null, Instant.now(), null,
                claimToken, Instant.now()
        );

        when(outboxRepository.fetchPending(20)).thenReturn(List.of(item));
        when(smsProvider.send(any(SmsMessage.class))).thenReturn(SmsSendResult.failure("GW_ERR", "Gateway error", 50));

        worker.processOutbox();

        verify(outboxRepository).markFailed(
                eq(4L),
                eq(claimToken),
                eq(3),
                any(Instant.class),
                eq("SMS failed: Gateway error"),
                eq(true) // isDeadLetter = true
        );
    }
}
