package com.greenwhite.dwh.instance.fnd.jobs;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Снимает задания основы с очереди {@code fnd_job_queue} и пишет результат в {@code fnd_job_runs}
 * (02 п.15; AC-7, AC-31). Планировщика здесь нет намеренно: момент запуска выбирает экземпляр,
 * а порядок «поставить в очередь → выполнить» одинаков и в бою, и в тестах.
 *
 * <p>Каждое задание — одна транзакция OLTP: строка очереди берётся {@code for update skip locked},
 * поэтому два воркера не выполнят одно задание дважды, а незанятые строки не ждут чужой коммит.
 * Падение процесса посреди задания откатывает всё разом — запуск {@code running}, инкремент
 * {@code attempts} и снятие с очереди: задание остаётся в очереди без изменений и будет взято снова.
 * Лимита попыток нет; счётчик {@code attempts} растёт в той же транзакции, в которой строка очереди
 * удаляется, поэтому его значение никто не читает (см. open-questions: лимит попыток). Обработчик
 * исполняется во вложенной транзакции (savepoint): его ошибка БД не портит внешнюю, запуск
 * фиксируется как {@code failed}, и задание снимается с очереди.
 * Выключатель {@code jobs_enabled=false} в {@code md_settings} каркаса ({@code user_id is null})
 * останавливает выборку.
 */
@Component
public class FndJobRunner {

    /** Ключ выключателя в {@code md_settings} каркаса; строки нет — задания выполняются. */
    public static final String JOBS_ENABLED_KEY = "jobs_enabled";

    private static final Logger log = LoggerFactory.getLogger(FndJobRunner.class);

    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate jobTx;
    private final TransactionTemplate handlerTx;
    private final Map<String, FndJobHandler> handlers = new HashMap<>();

    public FndJobRunner(JdbcClient jdbc, ObjectMapper json, PlatformTransactionManager transactions,
                        List<FndJobHandler> handlers) {
        this.jdbc = jdbc;
        this.json = json;
        this.jobTx = new TransactionTemplate(transactions);
        this.jobTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.handlerTx = new TransactionTemplate(transactions);
        this.handlerTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
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
     * Выполняет задания, чей срок наступил, по одному до пустой очереди. Каждое снимается из очереди,
     * а его результат остаётся в {@code fnd_job_runs}: успешные — {@code done}, упавшие — {@code failed}
     * с текстом ошибки и {@code args}.
     *
     * @return число успешно выполненных заданий
     */
    public int runQueued() {
        int done = 0;
        while (true) {
            Optional<Boolean> outcome = runNext();
            if (outcome.isEmpty()) {
                return done;
            }
            if (outcome.get()) {
                done++;
            }
        }
    }

    /**
     * Берёт одно задание и выполняет его в собственной транзакции.
     *
     * @return пусто — очередь пуста или задания выключены; иначе {@code true} при успехе, {@code false} при сбое
     */
    public Optional<Boolean> runNext() {
        return Optional.ofNullable(jobTx.execute(status -> {
            if (!jobsEnabled()) {
                return null;
            }
            List<Map<String, Object>> jobs = jdbc.sql("""
                            select id, handler, args::text as args from fnd_job_queue
                             where run_at <= now()
                             order by id
                               for update skip locked
                             limit 1
                            """).query().listOfRows();
            if (jobs.isEmpty()) {
                return null;
            }
            return execute(jobs.get(0));
        }));
    }

    private boolean execute(Map<String, Object> job) {
        long queueId = ((Number) job.get("id")).longValue();
        String handlerCode = (String) job.get("handler");
        String rawArgs = (String) job.get("args");
        jdbc.sql("update fnd_job_queue set attempts = attempts + 1 where id = :id").param("id", queueId).update();
        long runId = jdbc.sql("insert into fnd_job_runs (queue_id, handler, args, status)"
                        + " values (:queue, :handler, cast(:args as jsonb), 'running') returning id")
                .param("queue", queueId).param("handler", handlerCode)
                .param("args", rawArgs).query(Long.class).single();
        boolean success;
        try {
            handlerTx.executeWithoutResult(nested -> handler(handlerCode).run(args(rawArgs)));
            jdbc.sql("update fnd_job_runs set status = 'done', finished_at = now() where id = :id")
                    .param("id", runId).update();
            success = true;
        } catch (RuntimeException failure) {
            log.error("job_failed handler={} queue_id={}", handlerCode, queueId, failure);
            jdbc.sql("update fnd_job_runs set status = 'failed', finished_at = now(), error = :error"
                            + " where id = :id")
                    .param("error", describe(failure)).param("id", runId).update();
            success = false;
        }
        jdbc.sql("delete from fnd_job_queue where id = :id").param("id", queueId).update();
        return success;
    }

    private FndJobHandler handler(String code) {
        FndJobHandler handler = handlers.get(code);
        if (handler == null) {
            throw new IllegalStateException("Обработчик " + code + " не зарегистрирован");
        }
        return handler;
    }

    private boolean jobsEnabled() {
        return jdbc.sql("select value from md_settings where user_id is null and key = :key")
                .param("key", JOBS_ENABLED_KEY).query(String.class).optional()
                .map(value -> !"false".equalsIgnoreCase(value.trim()))
                .orElse(true);
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

    /**
     * Ставит в очередь разовое задание с аргументами — вне расписания. Участвует в транзакции вызывающего:
     * запись прикладного модуля и задание появляются вместе или не появляются вовсе.
     */
    @Transactional
    public void enqueueOnce(String handlerCode, Map<String, Object> args) {
        handler(handlerCode);
        jdbc.sql("insert into fnd_job_queue (handler, args) values (:handler, cast(:args as jsonb))")
                .param("handler", handlerCode)
                .param("args", json.writeValueAsString(args))
                .update();
    }

    /** Текст ошибки для {@code fnd_job_runs.error}: исключение и цепочка причин, чтобы не терять текст SQLException. */
    static String describe(Throwable failure) {
        StringBuilder text = new StringBuilder(failure.toString());
        for (Throwable cause = failure.getCause(); cause != null; cause = cause.getCause()) {
            text.append(" <- ").append(cause);
        }
        return text.toString();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> args(String rawArgs) {
        if (rawArgs == null) {
            return Map.of();
        }
        return json.readValue(rawArgs, Map.class);
    }
}
