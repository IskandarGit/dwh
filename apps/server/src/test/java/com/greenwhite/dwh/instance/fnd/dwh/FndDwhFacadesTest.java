package com.greenwhite.dwh.instance.fnd.dwh;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.load.FndLoad;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

/** Блок F основы: фасады второй базы — запись raw и чтение витрин (AC-33…AC-36). */
class FndDwhFacadesTest extends EmbeddedPostgresTest {

    private static final String SOURCE = "src_test_dwh";

    @Autowired
    private FndRawWriter rawWriter;
    @Autowired
    private FndMartReader martReader;
    @Autowired
    private FndLoadService loads;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private ObjectMapper json;
    @Autowired
    private TransactionTemplate tx;

    private FndActor actor;

    @BeforeEach
    void cleanDwh() {
        actor = actors.system();
        tx.executeWithoutResult(status -> {
            actors.apply(actor);
            jdbc.sql("select set_config('dwh.maintenance', 'on', true)").query(String.class).single();
            jdbc.sql("delete from fnd_load_log").update();
            jdbc.sql("update fnd_loads set superseded_by = null").update();
            jdbc.sql("delete from fnd_loads").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        dwhJdbc.sql("delete from cache.items").update();
        dwhJdbc.sql("delete from cache.generations").update();
    }

    @Test
    @DisplayName("AC-33: строки пишутся с load_id и читаются как записаны; чужой статус загрузки — отказ")
    void writeAndRead() {
        long loadId = newLoad();
        UUID fileId = newFile();
        rawWriter.write(loadId, fileId, List.of(
                new FndRawRow(1, "Лист1", 10, Map.of("code", "TEST-1")),
                new FndRawRow(2, "Лист1", 11, Map.of("code", "TEST-2")),
                new FndRawRow(3, null, null, Map.of("code", "TEST-3"))));

        List<FndRawRow> rows = rawWriter.read(loadId);
        assertThat(rows).hasSize(3);
        assertThat(rows.getFirst().sheet()).isEqualTo("Лист1");
        assertThat(rows.getFirst().sourceRowNo()).isEqualTo(10);
        assertThat(rows.getFirst().fields()).containsEntry("code", "TEST-1");
        assertThat(rows.get(2).sheet()).isNull();
        assertThat(dwhJdbc.sql("select count(*) from raw.rows where load_id = :id and source_file_id = :file"
                        + " and loaded_at is not null")
                .param("id", loadId).param("file", fileId).query(Long.class).single()).isEqualTo(3L);

        loads.apply(loadId, 3, 3, 0, actor);
        assertThat(codeOf(() -> rawWriter.write(loadId, fileId, List.of(new FndRawRow(4, null, null, Map.of())))))
                .isEqualTo(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);

        long failed = newLoad();
        loads.fail(failed, "сбой TEST", actor);
        assertThat(codeOf(() -> rawWriter.write(failed, fileId, List.of(new FndRawRow(1, null, null, Map.of())))))
                .isEqualTo(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);
        assertThat(codeOf(() -> rawWriter.write(-1, fileId, List.of(new FndRawRow(1, null, null, Map.of())))))
                .isEqualTo(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);

        // Фасад умеет только писать и читать: правки и удаления в контракте нет
        assertThat(FndRawWriter.class.getDeclaredMethods()).extracting(java.lang.reflect.Method::getName)
                .containsExactlyInAnyOrder("write", "read");
    }

    @Test
    @DisplayName("AC-34: запись пакетами атомарна — исключение источника на 501-й строке не оставляет ничего")
    void writeIsAtomic() {
        long loadId = newLoad();
        assertThatThrownBy(() -> rawWriter.write(loadId, null, failingAt(1000, 501)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(rawWriter.read(loadId)).isEmpty();
        assertThat(loads.find(loadId).orElseThrow().status()).isEqualTo(FndLoad.PENDING);

        List<FndRawRow> thousand = new ArrayList<>();
        for (int number = 1; number <= 1000; number++) {
            thousand.add(new FndRawRow(number, null, number, Map.of("n", number)));
        }
        rawWriter.write(loadId, null, thousand);
        assertThat(dwhJdbc.sql("select count(*) from raw.rows where load_id = :id")
                .param("id", loadId).query(Long.class).single()).isEqualTo(1000L);
    }

    @Test
    @DisplayName("AC-35: поколение кеша одно, чтение — только mart/cache и только связанными параметрами")
    void martReader() {
        assertThat(martReader.currentGeneration()).isEmpty();

        long generation = dwhJdbc.sql("insert into cache.generations (state, load_versions, switched_at)"
                        + " values ('current', cast(:versions as jsonb), now()) returning generation_id")
                .param("versions", "{\"" + SOURCE + "\": 1}").query(Long.class).single();
        FndMartReader.FndGeneration current = martReader.currentGeneration().orElseThrow();
        assertThat(current.generationId()).isEqualTo(generation);
        assertThat(current.loadVersions()).contains(SOURCE);
        assertThat(current.switchedAt()).isBefore(Instant.now().plusSeconds(1));

        assertThatThrownBy(() -> dwhJdbc.sql("insert into cache.generations (state, load_versions)"
                        + " values ('current', '{}'::jsonb)").update())
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("cache_generations_uk_current");

        dwhJdbc.sql("insert into cache.items (generation_id, item_key, load_versions, payload)"
                        + " values (:g, 'TEST-key', '{}'::jsonb, '{\"value\": 1}'::jsonb)")
                .param("g", generation).update();
        List<Map<String, Object>> items = martReader.read("cache", "items", Map.of("item_key", "TEST-key"));
        assertThat(items).hasSize(1);
        assertThat(items.getFirst()).containsEntry("item_key", "TEST-key");
        assertThat(martReader.read("cache", "items", Map.of("item_key", "нет такого"))).isEmpty();

        for (String forbidden : List.of("raw", "core", "public", "MART")) {
            assertThat(codeOf(() -> martReader.read(forbidden, "rows", Map.of())))
                    .isEqualTo(ConstraintErrorCode.DWH_READ_FORBIDDEN);
        }
        for (String table : List.of("items; drop table cache.items", "cache.items", "\"items\"", "items rows")) {
            assertThat(codeOf(() -> martReader.read("cache", table, Map.of())))
                    .isEqualTo(ConstraintErrorCode.DWH_READ_FORBIDDEN);
        }
        assertThat(codeOf(() -> martReader.read("cache", "items", Map.of("item_key; drop", "x"))))
                .isEqualTo(ConstraintErrorCode.DWH_READ_FORBIDDEN);
    }

    @Test
    @DisplayName("AC-36: pg-dwh недоступен — отказ за секунды и откат транзакции OLTP")
    void dwhUnavailable() {
        try (HikariDataSource closedPort = closedPortDataSource()) {
            FndMartReader reader = new FndMartReader(closedPort);
            FndRawWriter writer = new JdbcFndRawWriter(closedPort, jdbc, json);
            long loadId = newLoad();

            Instant start = Instant.now();
            assertThatThrownBy(reader::currentGeneration).isInstanceOf(DwhUnavailableException.class);
            assertThat(Duration.between(start, Instant.now())).isLessThan(Duration.ofSeconds(5));

            UUID packageRef = UUID.randomUUID();
            assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
                actors.apply(actor);
                loads.log(packageRef, "получен", null, null, actor, "до записи TEST", null);
                writer.write(loadId, null, List.of(new FndRawRow(1, null, null, Map.of("n", 1))));
            })).isInstanceOf(DwhUnavailableException.class);
            // Транзакция OLTP откатана: строки журнала, вставленной до обращения к pg-dwh, нет
            assertThat(jdbc.sql("select count(*) from fnd_load_log where package_ref = :p")
                    .param("p", packageRef).query(Long.class).single()).isZero();
        }
    }

    // ---------- вспомогательное ----------

    private HikariDataSource closedPortDataSource() {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:postgresql://localhost:1/dwh");
        dataSource.setUsername("unused");
        dataSource.setPassword("");
        dataSource.setConnectionTimeout(2000);
        dataSource.setInitializationFailTimeout(-1);
        dataSource.addDataSourceProperty("connectTimeout", "2");
        dataSource.addDataSourceProperty("loginTimeout", "2");
        return dataSource;
    }

    private long newLoad() {
        return loads.begin(SOURCE, UUID.randomUUID(), LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"), "v1", actor);
    }

    private UUID newFile() {
        return tx.execute(status -> jdbc.sql("""
                        insert into mf_files (sha256, original_name, size_bytes, mime_type,
                                              storage_bucket, storage_key)
                        values (:sha, 'TEST.xlsx', 10, 'application/vnd.ms-excel', 'test', :key)
                        returning id
                        """)
                .param("sha", UUID.randomUUID().toString().repeat(2).replace("-", "").substring(0, 64))
                .param("key", "test/" + UUID.randomUUID())
                .query(UUID.class).single());
    }

    /** Источник строк, который ломается на заданной строке: имитирует сбой разбора файла (AC-34). */
    private static Iterable<FndRawRow> failingAt(int total, int failAt) {
        return () -> new Iterator<>() {
            private int next = 1;

            @Override
            public boolean hasNext() {
                return next <= total;
            }

            @Override
            public FndRawRow next() {
                if (next == failAt) {
                    throw new IllegalStateException("источник строк сломался на " + failAt + " TEST");
                }
                int number = next++;
                return new FndRawRow(number, null, number, Map.of("n", number));
            }
        };
    }

    private ConstraintErrorCode codeOf(Runnable action) {
        Throwable error = catchThrowable(action::run);
        assertThat(error).isInstanceOf(ConstraintViolationException.class);
        return ((ConstraintViolationException) error).code();
    }
}
