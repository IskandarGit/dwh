package com.greenwhite.dwh.instance.fnd.error;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.fnd.units.FndConversion.FndCoefficientRef;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * Блок B основы: AC-9а — enum {@link ConstraintErrorCode} и ограничения {@code pg_constraint} таблиц {@code fnd_*}
 * совпадают в обе стороны, имена — по регламенту; AC-9б — фасады переводят нарушение каждого класса
 * (uk/fk/ck/ex) в {@link ConstraintViolationException} с кодом, транзакция откатана.
 */
class FndConstraintMappingTest extends EmbeddedPostgresTest {

    private static final Pattern NAME = Pattern.compile("^fnd_[a-z0-9_]+_(uk|fk|ck|ex)_[a-z0-9_]+$");

    @Autowired
    private FndUnitService units;
    @Autowired
    private FndVersioning versioning;
    @Autowired
    private FndLoadService loads;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate tx;

    private FndActor actor;

    @BeforeEach
    void clean() {
        actor = actors.system();
        tx.executeWithoutResult(status -> {
            actors.apply(actor);
            jdbc.sql("select set_config('dwh.maintenance', 'on', true)").query(String.class).single();
            jdbc.sql("delete from fnd_unit_coefficient_versions").update();
            jdbc.sql("delete from fnd_unit_coefficients").update();
            jdbc.sql("delete from fnd_units").update();
            jdbc.sql("delete from fnd_load_log").update();
            jdbc.sql("update fnd_loads set superseded_by = null").update();
            jdbc.sql("delete from fnd_loads").update();
        });
    }

    @Test
    @DisplayName("AC-9а: каждое ограничение u/f/c/x таблиц fnd_* есть в enum, каждый элемент enum с именем — в базе")
    void enumAndConstraintsMatchBothWays() {
        // Таблицы fnd_test_* заводят тесты стандарта версий (FndVersioningTest) — это фикстуры, не схема ядра
        Set<String> database = Set.copyOf(jdbc.sql("""
                        select con.conname from pg_constraint con
                          join pg_class rel on rel.oid = con.conrelid
                          join pg_namespace ns on ns.oid = rel.relnamespace
                         where ns.nspname = 'public' and rel.relname like 'fnd\\_%'
                           and rel.relname not like 'fnd\\_test\\_%'
                           and con.contype in ('u', 'f', 'c', 'x')
                        """).query(String.class).list());
        Set<String> enumerated = Arrays.stream(ConstraintErrorCode.values())
                .map(ConstraintErrorCode::constraintName)
                .flatMap(java.util.Optional::stream)
                .collect(Collectors.toSet());

        assertThat(database).as("ограничения в базе").isNotEmpty();
        assertThat(database.stream().filter(name -> !NAME.matcher(name).matches()).sorted().toList())
                .as("имена не по регламенту <table>_(uk|fk|ck|ex)_<suffix>").isEmpty();
        assertThat(database.stream().filter(name -> !enumerated.contains(name)).sorted().toList())
                .as("ограничения базы без элемента ConstraintErrorCode").isEmpty();
        assertThat(enumerated.stream().filter(name -> !database.contains(name)).sorted().toList())
                .as("элементы ConstraintErrorCode без ограничения в базе").isEmpty();
        assertThat(Arrays.stream(ConstraintErrorCode.values())
                .filter(code -> code.constraintName().isPresent())
                .filter(code -> !code.name().equalsIgnoreCase(code.constraintName().get()))
                .toList()).as("имя элемента enum = имя ограничения в верхнем регистре").isEmpty();
    }

    @Test
    @DisplayName("AC-9б: uk/fk/ck/ex через фасады — ConstraintViolationException с кодом, транзакция откатана")
    void facadesTranslateEachConstraintClass() {
        String base = "u_map_base";
        units.registerUnit(base, Map.of("uz", "Bazaviy birlik TEST"), base, actor);
        units.registerUnit("u_map_a", Map.of("uz", "Birlik A TEST"), base, actor);

        // uk — дубль кода единицы
        ConstraintViolationException uk = violation(() ->
                units.registerUnit("u_map_a", Map.of("uz", "Dubl TEST"), base, actor));
        assertThat(uk.code()).isEqualTo(ConstraintErrorCode.FND_UNITS_UK_CODE);
        assertThat(uk.getMessage()).isEqualTo("fnd_units_uk_code");
        assertThat(uk.getCause()).as("SQL-текст остаётся причиной, код — контракт").isNotNull();

        // fk — несуществующая базовая единица
        ConstraintViolationException fk = violation(() ->
                units.registerUnit("u_map_b", Map.of("uz", "Birlik B TEST"), "u_map_missing", actor));
        assertThat(fk.code()).isEqualTo(ConstraintErrorCode.FND_UNITS_FK_BASE_UNIT);
        assertThat(units.findUnit("u_map_b")).as("транзакция откатана").isEmpty();

        // ck — счётчики строк не сходятся
        long loadId = loads.begin("src_map_test", UUID.randomUUID(), LocalDate.parse("2026-01-01"),
                LocalDate.parse("2026-01-31"), "v1", actor);
        ConstraintViolationException ck = violation(() -> loads.apply(loadId, 10, 2, 1, actor));
        assertThat(ck.code()).isEqualTo(ConstraintErrorCode.FND_LOADS_CK_ROWS);
        assertThat(loads.find(loadId).orElseThrow().status()).as("транзакция откатана").isEqualTo("pending");

        // ex — пересечение интервалов опубликованных версий одного коэффициента
        FndCoefficientRef first = units.publishCoefficient("u_map_a", base, BigDecimal.TEN,
                LocalDate.parse("2026-01-01"), actor);
        versioning.supersede(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), first.version(), actor);
        int closed = versioning.createDraft(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), actor);
        versioning.updateDraft(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), closed, 0,
                Map.of("factor", BigDecimal.TEN), actor);
        versioning.publish(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), closed,
                LocalDate.parse("2026-01-01"), LocalDate.parse("2026-12-31"), actor);
        int overlapping = versioning.createDraft(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), actor);
        versioning.updateDraft(FndUnitService.COEFFICIENT_VERSIONS, first.coefficientId(), overlapping, 0,
                Map.of("factor", BigDecimal.ONE), actor);
        ConstraintViolationException ex = violation(() -> versioning.publish(FndUnitService.COEFFICIENT_VERSIONS,
                first.coefficientId(), overlapping, LocalDate.parse("2026-06-01"), null, actor));
        assertThat(ex.code()).isEqualTo(ConstraintErrorCode.FND_UNIT_COEFFICIENT_VERSIONS_EX_VALID);
        List<String> statuses = jdbc.sql("select status from fnd_unit_coefficient_versions"
                        + " where coefficient_id = :id order by version")
                .param("id", first.coefficientId()).query(String.class).list();
        assertThat(statuses).as("черновик остался черновиком — откат").containsExactly("superseded", "published", "draft");
    }

    private static ConstraintViolationException violation(Runnable action) {
        Throwable error = catchThrowable(action::run);
        assertThat(error).isInstanceOf(ConstraintViolationException.class);
        return (ConstraintViolationException) error;
    }
}
