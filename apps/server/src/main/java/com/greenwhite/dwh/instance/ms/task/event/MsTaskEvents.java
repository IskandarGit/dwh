package com.greenwhite.dwh.instance.ms.task.event;

import java.time.Instant;
import java.util.List;

/**
 * Доменные события задачника (FR-TASK-8, ADR-0006 разд. 2.3 правило 3).
 * Модуль `tasks` НЕ вызывает `notify` напрямую — он объявляет, что произошло;
 * кто и как на это реагирует, задача не знает.
 *
 * Все события несут получателей списком: решение «кому слать» принимает
 * задачник (он знает роли участников), а не подписчик.
 */
public final class MsTaskEvents {

    private MsTaskEvents() {}

    /** Пользователь назначен на задачу с указанием роли (R, E, O, etc.). */
    public record TaskAssigned(
            Long taskId,
            String taskTitle,
            List<Long> recipientUserIds,
            String involveKind,
            Long actorUserId
    ) {
        public TaskAssigned(Long taskId, String taskTitle, List<Long> recipientUserIds, Long actorUserId) {
            this(taskId, taskTitle, recipientUserIds, null, actorUserId);
        }
    }

    /** Изменён статус задачи. */
    public record TaskStatusChanged(
            Long taskId,
            String taskTitle,
            String newStatusName,
            boolean terminal,
            List<Long> recipientUserIds,
            Long actorUserId
    ) {}

    /** Добавлен комментарий к задаче. */
    public record TaskCommented(
            Long taskId,
            String taskTitle,
            List<Long> recipientUserIds,
            Long actorUserId
    ) {}

    /** Изменён дедлайн задачи. */
    public record TaskDeadlineChanged(
            Long taskId,
            String taskTitle,
            Instant oldDeadline,
            Instant newDeadline,
            List<Long> recipientUserIds,
            Long actorUserId
    ) {}

    /** Пользователь снят с задачи. */
    public record TaskMemberRemoved(
            Long taskId,
            String taskTitle,
            List<Long> recipientUserIds,
            String involveKind,
            Long actorUserId
    ) {}
}

