package com.greenwhite.dwh.instance.fnd.jobs;

import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Разовое задание в очереди основы: аргументы, неизвестный обработчик и общая транзакция с вызывающим. */
class FndJobEnqueueOnceTest extends EmbeddedPostgresTest {

    private static final String HANDLER = "test.once";

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private PlatformTransactionManager transactions;
    @Autowired
    private TransactionTemplate tx;

    private final List<Map<String, Object>> received = new ArrayList<>();

    @BeforeEach
    void cleanQueue() {
        received.clear();
        jdbc.sql("delete from fnd_job_queue").update();
        jdbc.sql("delete from fnd_job_runs").update();
    }

    private FndJobRunner runner() {
        FndJobHandler handler = new FndJobHandler() {
            @Override
            public String code() {
                return HANDLER;
            }

            @Override
            public void run(Map<String, Object> args) {
                received.add(args);
            }
        };
        return new FndJobRunner(jdbc, json, transactions, List.of(handler));
    }

    @Test
    @DisplayName("разовое задание попадает в очередь с аргументами и выполняется обработчиком")
    void enqueueOnceRunsHandlerWithArgs() {
        FndJobRunner runner = runner();

        runner.enqueueOnce(HANDLER, Map.of("packageId", "TEST-1"));

        List<Map<String, Object>> queued = jdbc.sql(
                        "select handler, args ->> 'packageId' as package_id, schedule_code from fnd_job_queue")
                .query().listOfRows();
        assertThat(queued).hasSize(1);
        assertThat(queued.get(0).get("handler")).isEqualTo(HANDLER);
        assertThat(queued.get(0).get("package_id")).isEqualTo("TEST-1");
        assertThat(queued.get(0).get("schedule_code")).isNull();

        assertThat(runner.runQueued()).isEqualTo(1);
        assertThat(received).containsExactly(Map.of("packageId", "TEST-1"));
        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
        assertThat(jdbc.sql("select status from fnd_job_runs").query(String.class).list())
                .containsExactly("done");
    }

    @Test
    @DisplayName("незарегистрированный обработчик — ошибка сразу, очередь пуста")
    void unknownHandlerIsRejected() {
        FndJobRunner runner = runner();

        assertThatThrownBy(() -> runner.enqueueOnce("test.unknown", Map.of()))
                .isInstanceOf(IllegalStateException.class);

        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("откат транзакции вызывающего убирает и задание")
    void rollbackRemovesJob() {
        FndJobRunner runner = runner();

        tx.executeWithoutResult(status -> {
            runner.enqueueOnce(HANDLER, Map.of());
            status.setRollbackOnly();
        });

        assertThat(jdbc.sql("select count(*) from fnd_job_queue").query(Long.class).single()).isZero();
    }
}
