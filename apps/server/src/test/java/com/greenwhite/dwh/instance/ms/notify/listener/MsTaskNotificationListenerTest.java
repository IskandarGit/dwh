package com.greenwhite.dwh.instance.ms.notify.listener;

import com.greenwhite.dwh.instance.ms.notify.pref.MsNotifyPref;
import com.greenwhite.dwh.instance.ms.notify.service.MsNotificationService;
import com.greenwhite.dwh.instance.ms.task.event.MsTaskEvents;
import com.greenwhite.dwh.instance.ms.task.pref.MsTaskPref;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class MsTaskNotificationListenerTest {

    private final MsNotificationService notificationService = Mockito.mock(MsNotificationService.class);
    private final MsTaskNotificationListener listener = new MsTaskNotificationListener(notificationService);

    @BeforeEach
    void setUp() {
        when(notificationService.isNotificationEnabled(any(), any(), any())).thenReturn(true);
    }

    @Test
    @DisplayName("Ответственный получает уведомление с текстом назначения ответственным")
    void notifiesResponsibleWithRoleText() {
        var event = new MsTaskEvents.TaskAssigned(
                100L, "Подготовить отчёт", List.of(10L), MsTaskPref.INVOLVE_RESPONSIBLE, 1L);

        listener.onTaskAssigned(event);

        verify(notificationService).sendInAppNotification(
                eq(10L),
                eq(MsNotifyPref.TYPE_INFO),
                eq("Вы назначены ответственным за задачу"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-assigned-100-R"));
    }

    @Test
    @DisplayName("Соисполнитель получает уведомление с текстом добавления соисполнителем")
    void notifiesExecutorWithRoleText() {
        var event = new MsTaskEvents.TaskAssigned(
                100L, "Подготовить отчёт", List.of(20L), MsTaskPref.INVOLVE_EXECUTOR, 1L);

        listener.onTaskAssigned(event);

        verify(notificationService).sendInAppNotification(
                eq(20L),
                eq(MsNotifyPref.TYPE_INFO),
                eq("Вы добавлены соисполнителем задачи"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-assigned-100-E"));
    }

    @Test
    @DisplayName("Наблюдатель получает уведомление с текстом добавления наблюдателем")
    void notifiesObserverWithRoleText() {
        var event = new MsTaskEvents.TaskAssigned(
                100L, "Подготовить отчёт", List.of(30L), MsTaskPref.INVOLVE_OBSERVER, 1L);

        listener.onTaskAssigned(event);

        verify(notificationService).sendInAppNotification(
                eq(30L),
                eq(MsNotifyPref.TYPE_INFO),
                eq("Вы добавлены наблюдателем задачи"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-assigned-100-O"));
    }

    @Test
    @DisplayName("Автор действия не получает уведомление о собственном действии")
    void excludesActorFromNotification() {
        var event = new MsTaskEvents.TaskAssigned(
                100L, "Подготовить отчёт", List.of(1L, 2L), MsTaskPref.INVOLVE_EXECUTOR, 1L);

        listener.onTaskAssigned(event);

        verify(notificationService).sendInAppNotification(
                eq(2L),
                eq(MsNotifyPref.TYPE_INFO),
                eq("Вы добавлены соисполнителем задачи"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-assigned-100-E"));
        verify(notificationService, never()).sendInAppNotification(
                eq(1L), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("Смена дедлайна уведомляет участников с типом WARNING")
    void notifiesOnDeadlineChanged() {
        var event = new MsTaskEvents.TaskDeadlineChanged(
                100L, "Подготовить отчёт", Instant.now(), Instant.now().plusSeconds(86400), List.of(10L), 1L);

        listener.onTaskDeadlineChanged(event);

        verify(notificationService).sendInAppNotification(
                eq(10L),
                eq(MsNotifyPref.TYPE_WARNING),
                eq("Изменён дедлайн задачи"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-deadline-100"));
    }

    @Test
    @DisplayName("Снятие участника уведомляет с указанием роли")
    void notifiesOnMemberRemoved() {
        var event = new MsTaskEvents.TaskMemberRemoved(
                100L, "Подготовить отчёт", List.of(20L), MsTaskPref.INVOLVE_EXECUTOR, 1L);

        listener.onTaskMemberRemoved(event);

        verify(notificationService).sendInAppNotification(
                eq(20L),
                eq(MsNotifyPref.TYPE_INFO),
                eq("Вы сняты с роли соисполнителя задачи"),
                eq("Подготовить отчёт"),
                eq("/tasks/items/100"),
                eq("task-removed-100"));
    }

    @Test
    @DisplayName("Уведомление подавляется, если отключено в настройках пользователя")
    void suppressesNotificationWhenDisabledInPreferences() {
        when(notificationService.isNotificationEnabled(eq(40L), eq("task_assigned"), eq("in_app")))
                .thenReturn(false);

        var event = new MsTaskEvents.TaskAssigned(
                100L, "Подготовить отчёт", List.of(40L), MsTaskPref.INVOLVE_OBSERVER, 1L);

        listener.onTaskAssigned(event);

        verify(notificationService, never()).sendInAppNotification(
                any(), any(), any(), any(), any(), any());
    }
}
