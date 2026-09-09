package com.greenwhite.dwh.instance.fnd.versioning;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.StaleVersionException;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * Блок C основы: версионность с датой действия (AC-10…AC-17). Стандарт проверяется на тестовой сущности
 * {@code fnd_test_things} + {@code fnd_test_thing_versions} — она создаётся тестом и в миграциях ядра
 * отсутствует (AC-10): ядро не знает ни одного прикладного справочника.
 */
class FndVersioningTest extends EmbeddedPostgresTest {

    private static final String VERSIONS = "fnd_test_thing_versions";

    @Autowired
    private FndVersioning versioning;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private FndActors actors;

    private FndActor actor;
    private long thing;
    private long otherThing;

    @BeforeEach
    void createTestEntity() {
        jdbc.sql("drop table if exists fnd_test_thing_versions").update();
        jdbc.sql("drop table if exists fnd_test_things").update();
        jdbc.sql("""
                create table fnd_test_things (
                    id   bigserial primary key,
                    code text not null
                )""").update();
        jdbc.sql("""
                create table fnd_test_thing_versions (
                    thing_id     bigint      not null references fnd_test_things (id),
                    version      integer     not null,
                    valid_from   date        not null,
                    valid_to     date,
                    status       text        not null default 'draft',
                    payload      text,
                    published_at timestamptz,
                    published_by text,
                    lock_version integer     not null default 0,
                    primary key (thing_id, version)
                )""").update();
        jdbc.sql("select fnd_versioning_enable('fnd_test_thing_versions', 'thing_id')").query().singleRow();
        actor = actors.system();
        thing = insertThing("TEST-A");
        otherThing = insertThing("TEST-B");
    }

    @Test
    @DisplayName("AC-10: стандарт даёт колонки, ключ, exclusion, триггеры и одну функцию версии на дату")
    void standardIsApplied() {
        List<String> columns = jdbc.sql("select column_name from information_schema.columns"
                + " where table_name = :t").param("t", VERSIONS).query(String.class).list();
        assertThat(columns).contains("version", "valid_from", "valid_to", "status",
                "published_at", "published_by", "lock_version");

        Map<String, Object> types = jdbc.sql("select data_type, is_nullable from information_schema.columns"
                        + " where table_name = :t and column_name = 'valid_from'")
                .param("t", VERSIONS).query().singleRow();
        assertThat(types).containsEntry("data_type", "date").containsEntry("is_nullable", "NO");
        assertThat(jdbc.sql("select is_nullable from information_schema.columns"
                        + " where table_name = :t and column_name = 'valid_to'")
                .param("t", VERSIONS).query(String.class).single()).isEqualTo("YES");

        List<String> constraints = jdbc.sql("select conname from pg_constraint where conrelid = :t::regclass")
                .param("t", VERSIONS).query(String.class).list();
        assertThat(constraints).contains(VERSIONS + "_pkey", VERSIONS + "_ex_valid",
                VERSIONS + "_ck_status", VERSIONS + "_ck_valid_order", VERSIONS + "_ck_version_positive");
        assertThat(jdbc.sql("select pg_get_constraintdef(oid) from pg_constraint"
                        + " where conrelid = :t::regclass and conname = :n")
                .param("t", VERSIONS).param("n", VERSIONS + "_pkey").query(String.class).single())
                .isEqualTo("PRIMARY KEY (thing_id, version)");

        List<String> triggers = jdbc.sql("select tgname from pg_trigger where tgrelid = :t::regclass"
                + " and not tgisinternal").param("t", VERSIONS).query(String.class).list();
        assertThat(triggers).contains(VERSIONS + "_bump_version", VERSIONS + "_deny_update_published");

        // Функция одна на все модули — по имени в схеме её ровно одна реализация
        assertThat(jdbc.sql("select count(*) from pg_proc where proname in"
                        + " ('fnd_version_at', 'bump_version', 'deny_update_published', 'fnd_versioning_enable')")
                .query(Long.class).single()).isEqualTo(4L);
    }

    @Test
    @DisplayName("AC-11: черновик 1 → публикация; действующая на дату; повторный черновик и чужой номер — отказ")
    void draftThenPublish() {
        assertThat(versioning.createDraft(VERSIONS, thing, actor)).isEqualTo(1);
        versioning.publish(VERSIONS, thing, 1, LocalDate.parse("2026-01-01"), null, actor);

        FndVersion published = versioning.find(VERSIONS, thing, 1).orElseThrow();
        assertThat(published.status()).isEqualTo(FndVersion.PUBLISHED);
        assertThat(published.publishedAt()).isNotNull();
        assertThat(published.publishedBy()).isEqualTo(actor.name());
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-06-15"))).contains(1);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2025-12-31"))).isEmpty();

        // черновик 2 в «действующей на дату» не участвует
        assertThat(versioning.createDraft(VERSIONS, thing, actor)).isEqualTo(2);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-06-15"))).contains(1);

        assertThat(codeOf(() -> versioning.createDraft(VERSIONS, thing, actor)))
                .isEqualTo(ConstraintErrorCode.FND_VERSION_DRAFT_EXISTS);
        assertThat(codeOf(() -> versioning.publish(VERSIONS, otherThing, 2,
                LocalDate.parse("2026-01-01"), null, actor)))
                .isEqualTo(ConstraintErrorCode.FND_VERSION_UNKNOWN);
    }

    @Test
    @DisplayName("AC-12: публикация новой версии закрывает предыдущую; дата не позже предыдущей — отказ без записи")
    void publishClosesPrevious() {
        publishVersion(thing, "2026-01-01", null);
        versioning.createDraft(VERSIONS, thing, actor);

        for (String tooEarly : List.of("2026-01-01", "2025-12-01")) {
            assertThat(codeOf(() -> versioning.publish(VERSIONS, thing, 2, LocalDate.parse(tooEarly), null, actor)))
                    .isEqualTo(ConstraintErrorCode.FND_VERSION_NOT_AFTER_PREVIOUS);
            FndVersion first = versioning.find(VERSIONS, thing, 1).orElseThrow();
            assertThat(first.validTo()).isNull();
            assertThat(first.status()).isEqualTo(FndVersion.PUBLISHED);
            assertThat(versioning.find(VERSIONS, thing, 2).orElseThrow().status()).isEqualTo(FndVersion.DRAFT);
        }

        versioning.publish(VERSIONS, thing, 2, LocalDate.parse("2026-07-01"), null, actor);
        FndVersion first = versioning.find(VERSIONS, thing, 1).orElseThrow();
        assertThat(first.validTo()).isEqualTo(LocalDate.parse("2026-06-30"));
        assertThat(first.status()).isEqualTo(FndVersion.PUBLISHED);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-06-30"))).contains(1);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-07-01"))).contains(2);
    }

    @Test
    @DisplayName("AC-13: опубликованная версия не меняется и не удаляется; черновик — свободно")
    void publishedIsImmutable() {
        publishVersion(thing, "2026-01-01", "2026-06-30");

        assertThat(directUpdateError("set payload = 'TEST'", thing, 1)).contains("fnd_version_published_immutable");
        assertThat(directUpdateError("set valid_from = date '2026-02-01'", thing, 1))
                .contains("fnd_version_published_immutable");
        assertThat(directUpdateError("set valid_to = date '2026-07-31'", thing, 1))
                .contains("fnd_version_published_immutable");
        assertThat(directUpdateError("set valid_to = null", thing, 1)).contains("fnd_version_published_immutable");
        assertThatThrownBy(() -> jdbc.sql("delete from " + VERSIONS + " where thing_id = :h and version = 1")
                .param("h", thing).update())
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("fnd_version_published_immutable");

        versioning.createDraft(VERSIONS, thing, actor);
        versioning.updateDraft(VERSIONS, thing, 2, 0, Map.of("payload", "TEST-draft"), actor);
        assertThat(jdbc.sql("delete from " + VERSIONS + " where thing_id = :h and version = 2")
                .param("h", thing).update()).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-14: интервалы опубликованных версий не пересекаются; черновик и снятая не мешают")
    void publishedIntervalsDoNotOverlap() {
        publishVersion(thing, "2026-01-01", "2026-06-30");

        // Проверяется само ограничение БД, поэтому строки вставляются напрямую, минуя порядок публикации
        for (String[] range : new String[][] {{"2026-06-30", null}, {"2026-03-01", "2026-04-01"},
                {"2025-01-01", "2026-01-01"}}) {
            Throwable error = catchThrowable(() -> insertVersionDirectly(thing, 2, range[0], range[1],
                    FndVersion.PUBLISHED));
            assertThat(error).as("интервал %s..%s", range[0], range[1])
                    .isInstanceOf(DataAccessException.class)
                    .hasMessageContaining(VERSIONS + "_ex_valid");
        }
        insertVersionDirectly(thing, 2, "2026-07-01", null, FndVersion.PUBLISHED);

        // draft и superseded в exclusion не участвуют: обе строки ложатся в занятый интервал
        insertVersionDirectly(thing, 3, "2026-02-01", "2026-03-01", FndVersion.DRAFT);
        insertVersionDirectly(thing, 4, "2026-02-01", "2026-03-01", FndVersion.SUPERSEDED);
        assertThat(jdbc.sql("select count(*) from " + VERSIONS + " where thing_id = :h")
                .param("h", thing).query(Long.class).single()).isEqualTo(4L);
    }

    @Test
    @DisplayName("AC-15: границы дат и номеров версий")
    void dateAndVersionBounds() {
        versioning.createDraft(VERSIONS, thing, actor);
        assertThatThrownBy(() -> versioning.publish(VERSIONS, thing, 1,
                LocalDate.parse("2026-06-30"), LocalDate.parse("2026-01-01"), actor))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining(VERSIONS + "_ck_valid_order");

        // один день — валидный интервал
        versioning.publish(VERSIONS, thing, 1, LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-01"), actor);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-01-01"))).contains(1);

        assertThatThrownBy(() -> insertVersionDirectly(otherThing, 0, "2026-01-01", null, FndVersion.DRAFT))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining(VERSIONS + "_ck_version_positive");
        assertThatThrownBy(() -> insertVersionDirectly(otherThing, -1, "2026-01-01", null, FndVersion.DRAFT))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining(VERSIONS + "_ck_version_positive");
        assertThatThrownBy(() -> insertVersionDirectly(thing, 3, "2027-01-01", null, FndVersion.DRAFT))
                .isInstanceOf(DataAccessException.class)
                .hasMessageContaining("fnd_version_gap");

        // Заголовки независимы: у второго заголовка номера начинаются заново
        assertThat(versioning.createDraft(VERSIONS, otherThing, actor)).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-16: оптимистическая блокировка черновика — второй клиент со старым lock_version получает отказ")
    void optimisticLocking() {
        versioning.createDraft(VERSIONS, thing, actor);
        assertThat(versioning.find(VERSIONS, thing, 1).orElseThrow().lockVersion()).isZero();

        versioning.updateDraft(VERSIONS, thing, 1, 0, Map.of("payload", "TEST-1"), actor);
        assertThat(versioning.find(VERSIONS, thing, 1).orElseThrow().lockVersion()).isEqualTo(1);

        assertThatThrownBy(() -> versioning.updateDraft(VERSIONS, thing, 1, 0, Map.of("payload", "TEST-2"), actor))
                .isInstanceOf(StaleVersionException.class)
                .extracting(e -> ((ConstraintViolationException) e).code())
                .isEqualTo(ConstraintErrorCode.STALE_VERSION);
        assertThat(payloadOf(thing, 1)).isEqualTo("TEST-1");

        versioning.updateDraft(VERSIONS, thing, 1, 1, Map.of("payload", "TEST-3"), actor);
        assertThat(versioning.find(VERSIONS, thing, 1).orElseThrow().lockVersion()).isEqualTo(2);
        assertThat(payloadOf(thing, 1)).isEqualTo("TEST-3");
    }

    @Test
    @DisplayName("AC-17: снятая версия освобождает интервал, остаётся в истории и не действует ни на одну дату")
    void supersede() {
        publishVersion(thing, "2026-01-01", "2026-06-30");
        versioning.createDraft(VERSIONS, thing, actor);
        versioning.publish(VERSIONS, thing, 2, LocalDate.parse("2026-07-01"), null, actor);

        versioning.supersede(VERSIONS, thing, 2, actor);
        assertThat(versioning.find(VERSIONS, thing, 2).orElseThrow().status()).isEqualTo(FndVersion.SUPERSEDED);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-08-01"))).isEmpty();

        versioning.createDraft(VERSIONS, thing, actor);
        versioning.publish(VERSIONS, thing, 3, LocalDate.parse("2026-07-01"), null, actor);
        assertThat(versioning.versionAt(VERSIONS, thing, LocalDate.parse("2026-08-01"))).contains(3);
        assertThat(jdbc.sql("select count(*) from " + VERSIONS + " where thing_id = :h").param("h", thing)
                .query(Long.class).single()).isEqualTo(3L);
    }

    // ---------- вспомогательное ----------

    private long insertThing(String code) {
        return jdbc.sql("insert into fnd_test_things (code) values (:c) returning id")
                .param("c", code).query(Long.class).single();
    }

    private void publishVersion(long headerId, String validFrom, String validTo) {
        int version = versioning.createDraft(VERSIONS, headerId, actor);
        versioning.publish(VERSIONS, headerId, version, LocalDate.parse(validFrom),
                validTo == null ? null : LocalDate.parse(validTo), actor);
    }

    private void insertVersionDirectly(long headerId, int version, String validFrom, String validTo, String status) {
        jdbc.sql("insert into " + VERSIONS + " (thing_id, version, valid_from, valid_to, status)"
                        + " values (:h, :v, cast(:from as date), cast(:to as date), :s)")
                .param("h", headerId).param("v", version).param("from", validFrom)
                .param("to", validTo).param("s", status).update();
    }

    private String directUpdateError(String assignment, long headerId, int version) {
        Throwable error = catchThrowable(() -> jdbc.sql("update " + VERSIONS + " " + assignment
                        + " where thing_id = :h and version = :v")
                .param("h", headerId).param("v", version).update());
        assertThat(error).as("изменение опубликованной версии: %s", assignment).isInstanceOf(DataAccessException.class);
        return error.getMessage();
    }

    private String payloadOf(long headerId, int version) {
        return jdbc.sql("select payload from " + VERSIONS + " where thing_id = :h and version = :v")
                .param("h", headerId).param("v", version).query(String.class).single();
    }

    private ConstraintErrorCode codeOf(Runnable action) {
        Throwable error = catchThrowable(action::run);
        assertThat(error).isInstanceOf(ConstraintViolationException.class);
        return ((ConstraintViolationException) error).code();
    }
}
