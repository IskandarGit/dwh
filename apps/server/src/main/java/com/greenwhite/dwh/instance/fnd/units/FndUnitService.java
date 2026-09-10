package com.greenwhite.dwh.instance.fnd.units;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.FndSqlErrors;
import com.greenwhite.dwh.instance.fnd.units.FndConversion.FndCoefficientRef;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

/**
 * Единицы экземпляра и пересчёт по датированному коэффициенту (13 инв.3; 18 п.14; AC-18…AC-24).
 *
 * <p>В ядре нет ни одного кода единицы и ни одного множителя: и то и другое заводит экземпляр
 * через {@link #registerUnit} и {@link #publishCoefficient}. Пересчёт идёт только по прямому
 * опубликованному коэффициенту {@code from → to} на дату: обратный множитель и цепочки
 * {@code a → b → c} не выводятся (доп.5), иначе получилось бы «значение по памяти».
 */
@Service
public class FndUnitService {

    /** Таблица версий коэффициента: стандарт версий блока C. */
    public static final String COEFFICIENT_VERSIONS = "fnd_unit_coefficient_versions";

    private final JdbcClient jdbc;
    private final FndActors actors;
    private final FndVersioning versioning;
    private final ObjectMapper json;

    public FndUnitService(JdbcClient jdbc, FndActors actors, FndVersioning versioning, ObjectMapper json) {
        this.jdbc = jdbc;
        this.actors = actors;
        this.versioning = versioning;
        this.json = json;
    }

    /**
     * Заводит единицу. {@code baseUnitCode} указывает на существующую единицу; базовая единица
     * ссылается сама на себя (AC-18). Без базовой единицы — отказ {@code fnd_unit_base_required}:
     * иначе {@link #toBase} не отличил бы «базовая» от «база не задана». Проверки кода и обязательного
     * имени на узбекском — ограничения БД.
     */
    @Transactional
    public long registerUnit(String code, Map<String, String> nameI18n, String baseUnitCode, FndActor actor) {
        if (baseUnitCode == null || baseUnitCode.isBlank()) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_UNIT_BASE_REQUIRED);
        }
        actors.apply(actor);
        String names = json.writeValueAsString(nameI18n == null ? Map.of() : nameI18n);
        return FndSqlErrors.translating(() -> jdbc.sql("insert into fnd_units (code, name_i18n, base_unit_code)"
                        + " values (:code, cast(:names as jsonb), :base) returning id")
                .param("code", code).param("names", names).param("base", baseUnitCode)
                .query(Long.class).single());
    }

    /** Единица по коду — как её видит экземпляр. */
    @Transactional(readOnly = true)
    public Optional<FndUnit> findUnit(String code) {
        return jdbc.sql("select id, code, name_i18n::text as name_i18n, base_unit_code from fnd_units"
                        + " where code = :code")
                .param("code", code)
                .query((rs, rowNum) -> new FndUnit(rs.getLong("id"), rs.getString("code"),
                        rs.getString("name_i18n"), rs.getString("base_unit_code")))
                .optional();
    }

    /**
     * Публикует значение коэффициента с датой начала действия: заголовок пары заводится при первом
     * вызове, значение кладётся в новую версию стандарта блока C и закрывает предыдущую (AC-19).
     */
    @Transactional
    public FndCoefficientRef publishCoefficient(String fromUnit, String toUnit, BigDecimal factor,
                                                LocalDate validFrom, FndActor actor) {
        if (factor == null) {
            throw new IllegalArgumentException("Множитель не задан");
        }
        actors.apply(actor);
        long coefficientId = coefficientId(fromUnit, toUnit)
                .orElseGet(() -> FndSqlErrors.translating(() -> jdbc
                        .sql("insert into fnd_unit_coefficients (from_unit, to_unit) values (:from, :to) returning id")
                        .param("from", fromUnit).param("to", toUnit).query(Long.class).single()));
        int version = versioning.createDraft(COEFFICIENT_VERSIONS, coefficientId, actor);
        versioning.updateDraft(COEFFICIENT_VERSIONS, coefficientId, version, 0, Map.of("factor", factor), actor);
        versioning.publish(COEFFICIENT_VERSIONS, coefficientId, version, validFrom, null, actor);
        return new FndCoefficientRef(coefficientId, version);
    }

    /**
     * Пересчёт значения на дату. Коэффициента нет — {@link FndCoefficientMissingException},
     * значение не возвращается (AC-21). Округления в основе нет: умножение numeric как есть (AC-20, AC-23).
     */
    @Transactional(readOnly = true)
    public FndConversion convert(BigDecimal value, String fromUnit, String toUnit, LocalDate date) {
        if (value == null) {
            throw new IllegalArgumentException("Значение не задано: пересчитывать нечего");
        }
        if (fromUnit.equals(toUnit)) {
            return new FndConversion(value, toUnit, null, date);
        }
        long coefficientId = coefficientId(fromUnit, toUnit)
                .orElseThrow(() -> new FndCoefficientMissingException(fromUnit, toUnit, date));
        int version = versioning.versionAt(COEFFICIENT_VERSIONS, coefficientId, date)
                .orElseThrow(() -> new FndCoefficientMissingException(fromUnit, toUnit, date));
        BigDecimal factor = jdbc.sql("select factor from " + COEFFICIENT_VERSIONS
                        + " where coefficient_id = :id and version = :v")
                .param("id", coefficientId).param("v", version).query(BigDecimal.class).single();
        return new FndConversion(value.multiply(factor), toUnit,
                new FndCoefficientRef(coefficientId, version), date);
    }

    /** Пересчёт в базовую единицу (13 инв.3): база единицы берётся из справочника, не из кода. */
    @Transactional(readOnly = true)
    public FndConversion toBase(BigDecimal value, String unitCode, LocalDate date) {
        FndUnit unit = findUnit(unitCode)
                .orElseThrow(() -> new ConstraintViolationException(ConstraintErrorCode.FND_UNIT_UNKNOWN));
        String base = unit.baseUnitCode();
        if (base == null) {
            // Схема (V107) этого не допускает; ветка — защита от данных, заведённых мимо фасада
            throw new ConstraintViolationException(ConstraintErrorCode.FND_UNIT_BASE_REQUIRED);
        }
        if (base.equals(unitCode)) {
            return new FndConversion(value, unitCode, null, date);
        }
        return convert(value, unitCode, base, date);
    }

    private Optional<Long> coefficientId(String fromUnit, String toUnit) {
        return jdbc.sql("select id from fnd_unit_coefficients where from_unit = :from and to_unit = :to")
                .param("from", fromUnit).param("to", toUnit).query(Long.class).optional();
    }

    /** Единица экземпляра; {@code nameI18n} отдаётся как JSON-текст — ядру его содержимое безразлично. */
    public record FndUnit(long id, String code, String nameI18n, String baseUnitCode) {
    }
}
