package com.greenwhite.dwh.instance.fnd.jobs;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawRow;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawWriter;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** AC-31: обслуживающие задания основы — очистка неудачных загрузок и сверка двух баз. */
class FndMaintenanceJobsTest extends EmbeddedPostgresTest {

    private static final String SOURCE = "src_test_jobs";

    @Autowired
    private FndLoadService loads;
    @Autowired
    private FndRawWriter rawWriter;
    @Autowired
    private FndJobRunner jobs;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private TransactionTemplate tx;

    private FndActor actor;

    @BeforeEach
    void cleanState() {
        actor = actors.system();
        tx.executeWithoutResult(status -> {
            actors.apply(actor);
            jdbc.sql("select set_config('dwh.maintenance', 'on', true)").query(String.class).single();
            jdbc.sql("delete from fnd_load_log").update();
            jdbc.sql("update fnd_loads set superseded_by = null").update();
            jdbc.sql("delete from fnd_loads").update();
            jdbc.sql("delete from security_events where event_type = :event")
                    .param("event", FndXdbCheckJob.EVENT).update();
            jdbc.sql("delete from fnd_job_queue").update();
            jdbc.sql("delete from fnd_job_runs").update();
            jdbc.sql("update fnd_job_schedule set last_enqueued = null").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
    }

    @Test
    @DisplayName("AC-31: сид расписания содержит оба обработчика основы")
    void scheduleIsSeeded() {
        List<String> codes = jdbc.sql("select code from fnd_job_schedule where code in (:cleanup, :check)")
                .param("cleanup", FndLoadCleanupJob.CODE).param("check", FndXdbCheckJob.CODE)
                .query(String.class).list();
        assertThat(codes).containsExactlyInAnyOrder(FndLoadCleanupJob.CODE, FndXdbCheckJob.CODE);
    }

    @Test
    @DisplayName("AC-31: очистка удаляет строки неудачной загрузки и не трогает применённую")
    void cleanupRemovesOnlyFailedRows() {
        long failed = loads.begin(SOURCE, UUID.randomUUID(), LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"), "v1", actor);
        rawWriter.write(failed, null, rows(100));
        loads.fail(failed, "сбой TEST", actor);

        long applied = loads.begin(SOURCE, UUID.randomUUID(), LocalDate.parse("2026-02-01"),
                LocalDate.parse("2026-02-28"), "v1", actor);
        rawWriter.write(applied, null, rows(5));
        loads.apply(applied, 5, 5, 0, actor);

        jobs.enqueue(FndLoadCleanupJob.CODE);
        assertThat(jobs.runQueued()).isEqualTo(1);

        assertThat(rawWriter.read(failed)).isEmpty();
        assertThat(rawWriter.read(applied)).hasSize(5);
        assertThat(jdbc.sql("select status from fnd_job_runs where handler = :h")
                .param("h", FndLoadCleanupJob.CODE).query(String.class).list()).containsExactly("done");
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("AC-31: сверка находит строки raw без загрузки и без файла и пишет xdb_mismatch")
    void xdbCheckReportsOrphans() {
        long applied = loads.begin(SOURCE, UUID.randomUUID(), LocalDate.parse("2026-03-01"),
                LocalDate.parse("2026-03-31"), "v1", actor);
        rawWriter.write(applied, null, rows(2));
        loads.apply(applied, 2, 2, 0, actor);

        UUID orphanFile = UUID.randomUUID();
        dwhJdbc.sql("insert into raw.rows (load_id, row_no, fields) values (999999, 1, '{}'::jsonb)").update();
        dwhJdbc.sql("insert into raw.rows (load_id, source_file_id, row_no, fields)"
                        + " values (:load, :file, 99, '{}'::jsonb)")
                .param("load", applied).param("file", orphanFile).update();

        jobs.enqueue(FndXdbCheckJob.CODE);
        assertThat(jobs.runQueued()).isEqualTo(1);

        List<String> events = jdbc.sql("select details::text from security_events where event_type = :event")
                .param("event", FndXdbCheckJob.EVENT).query(String.class).list();
        assertThat(events).hasSize(2);
        assertThat(events).anyMatch(details -> details.contains("999999"));
        assertThat(events).anyMatch(details -> details.contains(orphanFile.toString()));
        // Данные сверка не трогает
        assertThat(dwhJdbc.sql("select count(*) from raw.rows").query(Long.class).single()).isEqualTo(4L);
    }

    @Test
    @DisplayName("AC-7: задания попадают в очередь по расписанию и исполняются без планировщика Spring")
    void scheduleEnqueuesDueJobs() {
        assertThat(jobs.enqueueDue()).isGreaterThanOrEqualTo(2);
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single())
                .isGreaterThanOrEqualTo(2L);
        // Сразу после постановки срок следующего запуска ещё не наступил
        assertThat(jobs.enqueueDue()).isZero();
        assertThat(jobs.runQueued()).isGreaterThanOrEqualTo(2);
        assertThat(jdbc.sql("select count(*) from fnd_job_runs where status = 'done'")
                .query(Long.class).single()).isGreaterThanOrEqualTo(2L);
    }

    // ---------- AC-7: очередь под нагрузкой, путь failed, выключатель ----------

    @Autowired
    private tools.jackson.databind.ObjectMapper json;
    @Autowired
    private org.springframework.transaction.PlatformTransactionManager transactions;

    /** Воркер с тестовыми обработчиками: бины расписания не нужны — очередь принимает любой код обработчика. */
    private FndJobRunner testRunner(FndJobHandler... handlers) {
        return new FndJobRunner(jdbc, json, transactions, List.of(handlers));
    }

    private static FndJobHandler handler(String code, java.util.function.Consumer<Map<String, Object>> body) {
        return new FndJobHandler() {
            @Override
            public String code() {
                return code;
            }

            @Override
            public void run(Map<String, Object> args) {
                body.accept(args);
            }
        };
    }

    private long enqueueRaw(String handlerCode, String args) {
        return jdbc.sql("insert into fnd_job_queue (handler, args) values (:h, cast(:a as jsonb)) returning id")
                .param("h", handlerCode).param("a", args).query(Long.class).single();
    }

    @Test
    @DisplayName("AC-7: два воркера берут разные задания (for update skip locked), третий вызов пуст и не ждёт дольше 1 с")
    void twoWorkersTakeDifferentJobs() throws Exception {
        java.util.concurrent.CountDownLatch started = new java.util.concurrent.CountDownLatch(2);
        java.util.concurrent.CountDownLatch gate = new java.util.concurrent.CountDownLatch(1);
        FndJobRunner runner = testRunner(handler("test.block", args -> {
            started.countDown();
            try {
                assertThat(gate.await(30, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }));
        long first = enqueueRaw("test.block", "{}");
        long second = enqueueRaw("test.block", "{}");
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var c1 = pool.submit(runner::runNext);
            var c2 = pool.submit(runner::runNext);
            assertThat(started.await(30, java.util.concurrent.TimeUnit.SECONDS))
                    .as("оба воркера держат по заданию, не дожидаясь чужого коммита").isTrue();
            long begun = System.nanoTime();
            assertThat(runner.runNext()).as("третий вызов при двух занятых заданиях").isEmpty();
            assertThat(java.time.Duration.ofNanos(System.nanoTime() - begun)).isLessThan(java.time.Duration.ofSeconds(1));
            gate.countDown();
            assertThat(c1.get(30, java.util.concurrent.TimeUnit.SECONDS)).contains(true);
            assertThat(c2.get(30, java.util.concurrent.TimeUnit.SECONDS)).contains(true);
        } finally {
            gate.countDown();
            pool.shutdownNow();
        }
        assertThat(jdbc.sql("select queue_id from fnd_job_runs where handler = 'test.block' and status = 'done'")
                .query(Long.class).list()).containsExactlyInAnyOrder(first, second);
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("AC-7: исключение обработчика — запуск failed с текстом ошибки и args; ошибка SQL внутри обработчика не ломает фиксацию")
    void handlerFailureIsRecorded() {
        FndJobRunner runner = testRunner(
                handler("test.fail", args -> {
                    throw new IllegalStateException("boom TEST " + args.get("k"));
                }),
                handler("test.sqlfail", args -> jdbc.sql("select 1 from fnd_no_such_table_test").query().listOfRows()));
        enqueueRaw("test.fail", "{\"k\": \"v\"}");
        enqueueRaw("test.sqlfail", "{}");
        enqueueRaw("test.unknown", "{}");

        assertThat(runner.runQueued()).isZero();

        List<Map<String, Object>> runs = jdbc.sql("select handler, status, error, args::text as args from fnd_job_runs"
                + " where handler like 'test.%' order by id").query().listOfRows();
        assertThat(runs).extracting(r -> r.get("status")).containsExactly("failed", "failed", "failed");
        assertThat((String) runs.get(0).get("error")).contains("boom TEST v");
        assertThat((String) runs.get(0).get("args")).contains("\"k\"").contains("\"v\"");
        assertThat((String) runs.get(1).get("error")).contains("fnd_no_such_table_test");
        assertThat((String) runs.get(2).get("error")).contains("test.unknown");
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("AC-7: jobs_enabled=false в md_settings каркаса — воркер ничего не берёт; после включения — выполняет")
    void jobsEnabledSwitch() {
        FndJobRunner runner = testRunner(handler("test.noop", args -> { }));
        enqueueRaw("test.noop", "{}");
        jdbc.sql("insert into md_settings (user_id, key, value) values (null, :key, 'false')")
                .param("key", FndJobRunner.JOBS_ENABLED_KEY).update();
        try {
            assertThat(runner.runNext()).isEmpty();
            assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isEqualTo(1L);
            assertThat(jdbc.sql("select count(*) from fnd_job_runs").query(Long.class).single()).isZero();
        } finally {
            jdbc.sql("delete from md_settings where user_id is null and key = :key")
                    .param("key", FndJobRunner.JOBS_ENABLED_KEY).update();
        }
        assertThat(runner.runQueued()).isEqualTo(1);
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }

    private static List<FndRawRow> rows(int count) {
        return java.util.stream.IntStream.rangeClosed(1, count)
                .mapToObj(number -> new FndRawRow(number, null, number, Map.of("n", number)))
                .toList();
    }
}
