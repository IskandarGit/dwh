package com.greenwhite.dwh.instance.upl.worker;

import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Запускатель очереди заданий основы: раз в несколько секунд ставит в очередь задания расписания, чей срок подошёл,
 * и выполняет очередь. Без него загруженный файл навсегда остаётся «получен». В тестах выключен
 * ({@code dwh.fnd.jobs.ticker-enabled=false}) — тесты вызывают {@code runQueued()} сами.
 */
@Component
@ConditionalOnProperty(name = "dwh.fnd.jobs.ticker-enabled", matchIfMissing = true)
public class UplJobQueueWorker {

    private static final Logger log = LoggerFactory.getLogger(UplJobQueueWorker.class);

    private final FndJobRunner runner;

    public UplJobQueueWorker(FndJobRunner runner) {
        this.runner = runner;
    }

    @Scheduled(fixedDelayString = "${dwh.fnd.jobs.tick:PT5S}")
    public void tick() {
        try {
            runner.enqueueDue();
            runner.runQueued();
        } catch (RuntimeException failure) {
            log.error("job_tick_failed", failure);
        }
    }
}
