package com.greenwhite.dwh.instance.fnd.jobs;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Снимает задания основы с очереди {@code fnd_job_queue} и пишет результат в {@code fnd_job_runs}
 * (02 п.15; AC-7, AC-31). Планировщика здесь нет намеренно: момент запуска выбирает экземпляр,
 * а порядок «поставить в очередь → выполнить» одинаков и в бою, и в тестах.
 */
@Component
public class FndJobRunner {

    private static final Logger log = LoggerFactory.getLogger(FndJobRunner.class);

    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final Map<String, FndJobHandler> handlers = new HashMap<>();

    public FndJobRunner(JdbcClient jdbc, ObjectMapper json, List<FndJobHandler> handlers) {
        this.jdbc = jdbc;
        this.json = json;
        handlers.forEach(handler -> this.handlers.put(handler.code(), handler));
    }

    /** Ставит в очередь задания, у которых подошёл срок по расписанию. */
    @Transactional
    public int enqueueDue() {
        List<String> due = jdbc.sql("""
                        select code from fnd_job_schedule
                         where enabled
                           and (last_enqueued is null
                                or last_enqueued + make_interval(secs => interval_sec) <= now())
                        """).query(String.class).list();
        for (String code : due) {
            jdbc.sql("""
                            insert into fnd_job_queue (handler, args, schedule_code)
                            select handler, args, code from fnd_job_schedule where code = :code
                            """).param("code", code).update();
            jdbc.sql("update fnd_job_schedule set last_enqueued = now() where code = :code")
                    .param("code", code).update();
        }
        return due.size();
    }

    /**
     * Выполняет задания, чей срок наступил. Каждое снимается из очереди, а его результат остаётся
     * в {@code fnd_job_runs}: успешные — {@code done}, упавшие — {@code failed} с текстом ошибки.
     */
    public int runQueued() {
        List<Map<String, Object>> queued = jdbc.sql("select id, handler, args::text as args from fnd_job_queue"
                + " where run_at <= now() order by id").query().listOfRows();
        int done = 0;
        for (Map<String, Object> job : queued) {
            long queueId = ((Number) job.get("id")).longValue();
            String handlerCode = (String) job.get("handler");
            long runId = jdbc.sql("insert into fnd_job_runs (queue_id, handler, args, status)"
                            + " values (:queue, :handler, cast(:args as jsonb), 'running') returning id")
                    .param("queue", queueId).param("handler", handlerCode)
                    .param("args", job.get("args")).query(Long.class).single();
            try {
                FndJobHandler handler = handlers.get(handlerCode);
                if (handler == null) {
                    throw new IllegalStateException("Обработчик " + handlerCode + " не зарегистрирован");
                }
                handler.run(args(job.get("args")));
                jdbc.sql("update fnd_job_runs set status = 'done', finished_at = now() where id = :id")
                        .param("id", runId).update();
                done++;
            } catch (RuntimeException failure) {
                log.error("job_failed handler={} queue_id={}", handlerCode, queueId, failure);
                jdbc.sql("update fnd_job_runs set status = 'failed', finished_at = now(), error = :error"
                                + " where id = :id")
                        .param("error", failure.toString()).param("id", runId).update();
            } finally {
                jdbc.sql("delete from fnd_job_queue where id = :id").param("id", queueId).update();
            }
        }
        return done;
    }

    /** Ставит задание в очередь вне расписания — например, шагом поставки или сверкой по требованию. */
    @Transactional
    public void enqueue(String scheduleCode) {
        int queued = jdbc.sql("""
                        insert into fnd_job_queue (handler, args, schedule_code)
                        select handler, args, code from fnd_job_schedule where code = :code
                        """).param("code", scheduleCode).update();
        if (queued == 0) {
            throw new IllegalArgumentException("Задание " + scheduleCode + " отсутствует в расписании");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> args(Object rawArgs) {
        if (rawArgs == null) {
            return Map.of();
        }
        return json.readValue((String) rawArgs, Map.class);
    }
}
