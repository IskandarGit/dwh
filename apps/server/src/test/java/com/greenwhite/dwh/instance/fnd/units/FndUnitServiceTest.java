package com.greenwhite.dwh.instance.fnd.units;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.units.FndConversion.FndCoefficientRef;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersion;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * Блок D основы: единицы и датированные коэффициенты (AC-18…AC-24).
 *
 * <p>Конфигурации двух ведомств (AC-18, AC-41) заданы синтетическими кодами: реальных отраслевых
 * единиц нет ни в ядре, ни в тестах — ядро обязано работать с любым набором единиц покупателя.
 */
class FndUnitServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate FIRST_HALF = LocalDate.parse("2026-03-01");
    private static final LocalDate SECOND_HALF = LocalDate.parse("2026-07-01");

    @Autowired
    private FndUnitService units;
    @Autowired
    private FndVersioning versioning;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate tx;

    private FndActor actor;

    /** Конфигурации экземпляров: коды единиц — параметр, а не знание ядра (AC-41). */
    static Stream<List<String>> departments() {
        return Stream.of(List.of("u_test_a", "u_test_b", "u_test_c"), List.of("unit.b1", "unit_b2", "unit-b3"));
    }

    @BeforeEach
    void cleanUnits() {
        actor = actors.system();
        tx.executeWithoutResult(status -> {
            actors.apply(actor);
            // Опубликованные версии защищены триггером — чистка идёт в режиме обслуживания (V102)
            jdbc.sql("select set_config('dwh.maintenance', 'on', true)").query(String.class).single();
            jdbc.sql("delete from fnd_unit_coefficient_versions").update();
            jdbc.sql("delete from fnd_unit_coefficients").update();
            jdbc.sql("delete from fnd_units").update();
        });
    }

    @ParameterizedTest(name = "конфигурация {0}")
    @MethodSource("departments")
    @DisplayName("AC-18: единицы экземпляра заводятся с базовой единицей и обязательным именем на узбекском")
    void registerUnits(List<String> codes) {
        String base = codes.get(1);
        long baseId = units.registerUnit(base, Map.of("uz", "Bazaviy birlik TEST"), base, actor);
        long derivedId = units.registerUnit(codes.get(0), Map.of("uz", "Ўлчов бирлиги TEST", "ru", "Единица TEST"),
                base, actor);
        assertThat(baseId).isPositive();
        assertThat(derivedId).isPositive();
        assertThat(units.findUnit(base).orElseThrow().baseUnitCode()).isEqualTo(base);
        // Узбекские кириллица и латиница сохраняются без потерь
        assertThat(units.findUnit(codes.get(0)).orElseThrow().nameI18n())
                .contains("Ўлчов бирлиги TEST").contains("Единица TEST");

        assertThat(codeOf(() -> units.registerUnit("", Map.of("uz", "TEST"), base, actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_CK_CODE);
        assertThat(codeOf(() -> units.registerUnit("u".repeat(33), Map.of("uz", "TEST"), base, actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_CK_CODE);
        assertThat(codeOf(() -> units.registerUnit("u test", Map.of("uz", "TEST"), base, actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_CK_CODE);
        assertThat(codeOf(() -> units.registerUnit(codes.get(2), Map.of("ru", "TEST"), base, actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_CK_NAME_UZ);
        assertThat(codeOf(() -> units.registerUnit(codes.get(2), Map.of("uz", "TEST"), "u_unknown_test", actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_FK_BASE_UNIT);
        assertThat(codeOf(() -> units.registerUnit(base, Map.of("uz", "TEST"), base, actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNITS_UK_CODE);
    }

    @Test
    @DisplayName("AC-19: коэффициент публикуется версией стандарта; ноль, минус и пара из одной единицы — отказ")
    void coefficientIsVersioned() {
        registerPair();
        FndCoefficientRef ref = units.publishCoefficient("u_test_a", "u_test_b",
                new BigDecimal("1000"), LocalDate.parse("2026-01-01"), actor);

        FndVersion version = versioning.find(FndUnitService.COEFFICIENT_VERSIONS, ref.coefficientId(), ref.version())
                .orElseThrow();
        assertThat(ref.version()).isEqualTo(1);
        assertThat(version.status()).isEqualTo(FndVersion.PUBLISHED);
        assertThat(version.publishedBy()).isEqualTo(actor.name());
        assertThat(factorOf(ref)).isEqualByComparingTo("1000");
        assertThat(jdbc.sql("select data_type from information_schema.columns where table_name ="
                        + " 'fnd_unit_coefficient_versions' and column_name = 'factor'")
                .query(String.class).single()).isEqualTo("numeric");

        assertThat(codeOf(() -> units.publishCoefficient("u_test_a", "u_test_c", BigDecimal.ZERO,
                LocalDate.parse("2026-01-01"), actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNIT_COEFFICIENT_VERSIONS_CK_FACTOR_POSITIVE);
        assertThat(codeOf(() -> units.publishCoefficient("u_test_a", "u_test_c", new BigDecimal("-1"),
                LocalDate.parse("2026-01-01"), actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNIT_COEFFICIENT_VERSIONS_CK_FACTOR_POSITIVE);
        assertThat(codeOf(() -> units.publishCoefficient("u_test_a", "u_test_a", BigDecimal.TEN,
                LocalDate.parse("2026-01-01"), actor)))
                .isEqualTo(ConstraintErrorCode.FND_UNIT_COEFFICIENTS_CK_DISTINCT);
    }

    @Test
    @DisplayName("AC-20: пересчёт берёт коэффициент, действующий на дату, и возвращает ссылку на его версию")
    void convertUsesCoefficientOfTheDate() {
        registerPair();
        FndCoefficientRef first = units.publishCoefficient("u_test_a", "u_test_b",
                new BigDecimal("1000"), LocalDate.parse("2026-01-01"), actor);
        FndCoefficientRef second = units.publishCoefficient("u_test_a", "u_test_b",
                new BigDecimal("1200"), SECOND_HALF, actor);

        FndConversion early = units.convert(new BigDecimal("2.5"), "u_test_a", "u_test_b", FIRST_HALF);
        FndConversion late = units.convert(new BigDecimal("2.5"), "u_test_a", "u_test_b", SECOND_HALF);

        assertThat(early.value()).isEqualByComparingTo("2500");
        assertThat(late.value()).isEqualByComparingTo("3000");
        assertThat(early.coefficient()).isEqualTo(first);
        assertThat(late.coefficient()).isEqualTo(second);
        assertThat(early.date()).isEqualTo(FIRST_HALF);
        assertThat(early.unit()).isEqualTo("u_test_b");
    }

    @Test
    @DisplayName("AC-21: нет коэффициента на дату, обратный и цепочка — отказ; значение не возвращается")
    void missingCoefficientIsAnError() {
        registerPair();
        units.publishCoefficient("u_test_a", "u_test_b", new BigDecimal("1000"),
                LocalDate.parse("2026-01-01"), actor);
        // Пара a -> c существует только черновиком: в пересчёт черновик не попадает
        long draftPair = tx.execute(status -> {
            actors.apply(actor);
            return jdbc.sql("insert into fnd_unit_coefficients (from_unit, to_unit)"
                            + " values ('u_test_a', 'u_test_c') returning id")
                    .query(Long.class).single();
        });
        versioning.createDraft(FndUnitService.COEFFICIENT_VERSIONS, draftPair, actor);

        assertThatThrownBy(() -> units.convert(BigDecimal.ONE, "u_test_a", "u_test_b",
                LocalDate.parse("2025-12-31")))
                .isInstanceOf(FndCoefficientMissingException.class);
        assertThatThrownBy(() -> units.convert(BigDecimal.ONE, "u_test_b", "u_test_a", FIRST_HALF))
                .isInstanceOf(FndCoefficientMissingException.class);
        FndCoefficientMissingException chain = (FndCoefficientMissingException) catchThrowable(
                () -> units.convert(BigDecimal.ONE, "u_test_a", "u_test_c", FIRST_HALF));
        assertThat(chain.fromUnit()).isEqualTo("u_test_a");
        assertThat(chain.toUnit()).isEqualTo("u_test_c");
        assertThat(chain.date()).isEqualTo(FIRST_HALF);

        FndConversion identity = units.convert(new BigDecimal("7.5"), "u_test_a", "u_test_a", FIRST_HALF);
        assertThat(identity.value()).isEqualByComparingTo("7.5");
        assertThat(identity.coefficient()).isNull();
    }

    @Test
    @DisplayName("AC-22: пересчёт в базовую единицу идёт по справочнику; базовая — тождество, чужая — отказ")
    void toBase() {
        registerPair();
        FndCoefficientRef ref = units.publishCoefficient("u_test_a", "u_test_b", new BigDecimal("1000"),
                LocalDate.parse("2026-01-01"), actor);

        FndConversion converted = units.toBase(new BigDecimal("2.5"), "u_test_a", FIRST_HALF);
        assertThat(converted.value()).isEqualByComparingTo("2500");
        assertThat(converted.unit()).isEqualTo("u_test_b");
        assertThat(converted.coefficient()).isEqualTo(ref);

        FndConversion identity = units.toBase(new BigDecimal("3"), "u_test_b", FIRST_HALF);
        assertThat(identity.value()).isEqualByComparingTo("3");
        assertThat(identity.coefficient()).isNull();

        assertThat(codeOf(() -> units.toBase(BigDecimal.ONE, "u_unknown_test", FIRST_HALF)))
                .isEqualTo(ConstraintErrorCode.FND_UNIT_UNKNOWN);
    }

    @Test
    @DisplayName("AC-23: малый множитель и большое значение считаются точно; null — отказ, а не ноль")
    void boundaryValues() {
        registerPair();
        units.publishCoefficient("u_test_a", "u_test_b", new BigDecimal("0.000001"),
                LocalDate.parse("2026-01-01"), actor);

        FndConversion converted = units.convert(new BigDecimal("1000000000000000"), "u_test_a", "u_test_b", FIRST_HALF);
        assertThat(converted.value()).isEqualByComparingTo("1000000000");

        assertThatThrownBy(() -> units.convert(null, "u_test_a", "u_test_b", FIRST_HALF))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> units.publishCoefficient("u_test_a", "u_test_c", null,
                LocalDate.parse("2026-01-01"), actor))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ---------- вспомогательное ----------

    private void registerPair() {
        units.registerUnit("u_test_b", Map.of("uz", "Bazaviy birlik TEST"), "u_test_b", actor);
        units.registerUnit("u_test_a", Map.of("uz", "Birlik A TEST"), "u_test_b", actor);
        units.registerUnit("u_test_c", Map.of("uz", "Birlik C TEST"), "u_test_c", actor);
    }

    private BigDecimal factorOf(FndCoefficientRef ref) {
        return jdbc.sql("select factor from fnd_unit_coefficient_versions"
                        + " where coefficient_id = :id and version = :v")
                .param("id", ref.coefficientId()).param("v", ref.version()).query(BigDecimal.class).single();
    }

    private ConstraintErrorCode codeOf(Runnable action) {
        Throwable error = catchThrowable(action::run);
        assertThat(error).isInstanceOf(ConstraintViolationException.class);
        return ((ConstraintViolationException) error).code();
    }
}
