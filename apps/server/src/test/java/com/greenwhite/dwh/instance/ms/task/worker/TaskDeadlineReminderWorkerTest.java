package com.greenwhite.dwh.instance.ms.task.worker;

import com.greenwhite.dwh.instance.ms.notify.service.MsNotificationService;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Duration;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class TaskDeadlineReminderWorkerTest {

    private final MsTaskRepository taskRepository = Mockito.mock(MsTaskRepository.class);
    private final MsNotificationService notificationService = Mockito.mock(MsNotificationService.class);
    private final TaskDeadlineReminderWorker worker = new TaskDeadlineReminderWorker(taskRepository, notificationService);

    @BeforeEach
    void setUp() {
        when(notificationService.isNotificationEnabled(anyLong(), anyString(), anyString())).thenReturn(true);
    }

    @Test
    @DisplayName("Отправляет уведомление о дедлайне, если оно не отправлялось ранее")
    void sendsDeadlineNotificationWhenNotSentRecently() {
        var candidate = new MsTaskRepository.TaskDeadlineCandidate(101L, "Сдать финансовый отчёт", 10L);
        when(taskRepository.findUpcomingDeadlines(any(Duration.class))).thenReturn(List.of(candidate));
        when(notificationService.hasRecentNotification(eq(10L), eq("task_deadline_101"), any(Duration.class))).thenReturn(false);

        worker.scanAndNotifyDeadlines();

        verify(notificationService).sendInAppNotification(
                eq(10L),
                eq("deadline_warning"),
                eq("Приближается дедлайн по задаче #101"),
                eq("Срок выполнения задачи 'Сдать финансовый отчёт' истекает в ближайшие 24 часа."),
                eq("/tasks"),
                eq("task_deadline_101")
        );
    }

    @Test
    @DisplayName("Не отправляет повторное уведомление, если оно уже отправлялось недавно")
    void suppressesNotificationWhenAlreadySentRecently() {
        var candidate = new MsTaskRepository.TaskDeadlineCandidate(102L, "Обновить сертификаты", 20L);
        when(taskRepository.findUpcomingDeadlines(any(Duration.class))).thenReturn(List.of(candidate));
        when(notificationService.hasRecentNotification(eq(20L), eq("task_deadline_102"), any(Duration.class))).thenReturn(true);

        worker.scanAndNotifyDeadlines();

        verify(notificationService, never()).sendInAppNotification(anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("Не отправляет уведомление, если отключено в настройках пользователя")
    void suppressesNotificationWhenDisabledInPreferences() {
        var candidate = new MsTaskRepository.TaskDeadlineCandidate(103L, "Провести аудит", 30L);
        when(taskRepository.findUpcomingDeadlines(any(Duration.class))).thenReturn(List.of(candidate));
        when(notificationService.isNotificationEnabled(eq(30L), eq("task_deadline_reminder"), eq("in_app"))).thenReturn(false);

        worker.scanAndNotifyDeadlines();

        verify(notificationService, never()).sendInAppNotification(anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("Корректно обрабатывает пустой список приближающихся дедлайнов")
    void handlesEmptyDeadlinesGracefully() {
        when(taskRepository.findUpcomingDeadlines(any(Duration.class))).thenReturn(List.of());

        worker.scanAndNotifyDeadlines();

        verify(notificationService, never()).sendInAppNotification(anyLong(), anyString(), anyString(), anyString(), anyString(), anyString());
    }
}
