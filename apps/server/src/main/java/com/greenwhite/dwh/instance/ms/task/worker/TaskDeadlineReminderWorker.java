package com.greenwhite.dwh.instance.ms.task.worker;

import com.greenwhite.dwh.instance.ms.notify.service.MsNotificationService;
import com.greenwhite.dwh.instance.ms.task.repository.MsTaskRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

@Component
public class TaskDeadlineReminderWorker {

    private static final Logger log = LoggerFactory.getLogger(TaskDeadlineReminderWorker.class);
    private static final Duration DEADLINE_WINDOW = Duration.ofHours(24);

    private final MsTaskRepository taskRepository;
    private final MsNotificationService notificationService;

    public TaskDeadlineReminderWorker(MsTaskRepository taskRepository, MsNotificationService notificationService) {
        this.taskRepository = taskRepository;
        this.notificationService = notificationService;
    }

    @Scheduled(fixedDelay = 600000, initialDelay = 30000)
    public void scanAndNotifyDeadlines() {
        try {
            List<MsTaskRepository.TaskDeadlineCandidate> rows = taskRepository.findUpcomingDeadlines(DEADLINE_WINDOW);

            if (rows.isEmpty()) {
                return;
            }

            for (var row : rows) {
                // Avoid flooding: check if notification was already sent in last 24h
                boolean alreadySent = notificationService.hasRecentNotification(
                        row.userId(),
                        "task_deadline_" + row.taskId(),
                        DEADLINE_WINDOW
                );

                if (!alreadySent) {
                    notificationService.sendInAppNotification(
                            row.userId(),
                            "deadline_warning",
                            "Приближается дедлайн по задаче #" + row.taskId(),
                            "Срок выполнения задачи '" + row.title() + "' истекает в ближайшие 24 часа.",
                            "/tasks",
                            "task_deadline_" + row.taskId()
                    );
                    log.info("Deadline notification sent for task #{} to user #{}", row.taskId(), row.userId());
                }
            }
        } catch (Exception e) {
            log.warn("TaskDeadlineReminderWorker error: {}", e.getMessage());
        }
    }
}
