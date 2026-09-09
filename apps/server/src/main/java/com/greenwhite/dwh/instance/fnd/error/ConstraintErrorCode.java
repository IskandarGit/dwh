package com.greenwhite.dwh.instance.fnd.error;

import java.util.Arrays;
import java.util.Optional;

/**
 * Коды нарушений ограничений таблиц {@code fnd_*} (02 п.16; AC-9а/9б) и логические коды основы.
 * Имена ограничений — по регламенту {@code <table>_(uk|fk|ck|ex)_<suffix>}; каждое ограничение БД типов u/f/c/x
 * имеет элемент здесь и наоборот (CI-тест AC-9а). Элементы без имени ограничения — коды сервисов (AC-11, 15, 16).
 */
public enum ConstraintErrorCode {

    // fnd_job_schedule, fnd_job_queue, fnd_job_runs (блок B, V100)
    FND_JOB_SCHEDULE_CK_INTERVAL("fnd_job_schedule_ck_interval"),
    FND_JOB_QUEUE_FK_SCHEDULE("fnd_job_queue_fk_schedule"),
    FND_JOB_RUNS_CK_STATUS("fnd_job_runs_ck_status"),

    // fnd_units (блок D)
    FND_UNITS_UK_CODE("fnd_units_uk_code"),
    FND_UNITS_FK_BASE_UNIT("fnd_units_fk_base_unit"),
    FND_UNITS_CK_CODE("fnd_units_ck_code"),
    FND_UNITS_CK_NAME_UZ("fnd_units_ck_name_uz"),

    // fnd_unit_coefficients + fnd_unit_coefficient_versions (блок D, стандарт версий блока C)
    FND_UNIT_COEFFICIENTS_UK_PAIR("fnd_unit_coefficients_uk_pair"),
    FND_UNIT_COEFFICIENTS_FK_FROM("fnd_unit_coefficients_fk_from"),
    FND_UNIT_COEFFICIENTS_FK_TO("fnd_unit_coefficients_fk_to"),
    FND_UNIT_COEFFICIENTS_CK_DISTINCT("fnd_unit_coefficients_ck_distinct"),
    FND_UNIT_COEFFICIENT_VERSIONS_FK_COEFFICIENT("fnd_unit_coefficient_versions_fk_coefficient"),
    FND_UNIT_COEFFICIENT_VERSIONS_CK_STATUS("fnd_unit_coefficient_versions_ck_status"),
    FND_UNIT_COEFFICIENT_VERSIONS_CK_VALID_ORDER("fnd_unit_coefficient_versions_ck_valid_order"),
    FND_UNIT_COEFFICIENT_VERSIONS_CK_VERSION_POSITIVE("fnd_unit_coefficient_versions_ck_version_positive"),
    FND_UNIT_COEFFICIENT_VERSIONS_CK_FACTOR_POSITIVE("fnd_unit_coefficient_versions_ck_factor_positive"),
    FND_UNIT_COEFFICIENT_VERSIONS_EX_VALID("fnd_unit_coefficient_versions_ex_valid"),

    // fnd_loads + fnd_load_log (блок E)
    FND_LOADS_UK_PACKAGE_REF("fnd_loads_uk_package_ref"),
    FND_LOADS_CK_STATUS("fnd_loads_ck_status"),
    FND_LOADS_CK_ROWS("fnd_loads_ck_rows"),
    FND_LOADS_CK_PERIOD("fnd_loads_ck_period"),
    FND_LOADS_FK_SUPERSEDED_BY("fnd_loads_fk_superseded_by"),
    FND_LOAD_LOG_FK_LOAD("fnd_load_log_fk_load"),
    FND_LOAD_LOG_CK_FILE_SHA("fnd_load_log_ck_file_sha"),
    FND_LOAD_LOG_CK_ACTOR("fnd_load_log_ck_actor"),

    // логические коды основы (не ограничения БД)
    STALE_VERSION(null),
    FND_UNIT_UNKNOWN(null),
    FND_VERSION_DRAFT_EXISTS(null),
    FND_VERSION_UNKNOWN(null),
    FND_VERSION_NOT_AFTER_PREVIOUS(null),
    FND_VERSION_GAP(null),
    FND_VERSION_PUBLISHED_IMMUTABLE(null),
    AUDIT_ACTOR_MISSING(null),
    FND_LOAD_STATUS_TRANSITION(null),
    FND_LOAD_LOG_APPEND_ONLY(null),
    DWH_READ_FORBIDDEN(null),
    DWH_UNAVAILABLE(null);

    private final String constraintName;

    ConstraintErrorCode(String constraintName) {
        this.constraintName = constraintName;
    }

    /** Имя ограничения в БД; пусто для логических кодов. */
    public Optional<String> constraintName() {
        return Optional.ofNullable(constraintName);
    }

    /** Код в нижнем регистре — как он попадает в исключение и лог ({@code fnd_loads_ck_status}, {@code stale_version}). */
    public String code() {
        return name().toLowerCase();
    }

    public static Optional<ConstraintErrorCode> byConstraintName(String constraintName) {
        return Arrays.stream(values())
                .filter(c -> constraintName != null && constraintName.equals(c.constraintName))
                .findFirst();
    }

    /** По тексту серверной ошибки триггера/функции ({@code raise exception 'fnd_version_gap'}). */
    public static Optional<ConstraintErrorCode> byMessage(String message) {
        if (message == null) {
            return Optional.empty();
        }
        return Arrays.stream(values())
                .filter(c -> c.constraintName == null && message.contains(c.code()))
                .findFirst();
    }
}
