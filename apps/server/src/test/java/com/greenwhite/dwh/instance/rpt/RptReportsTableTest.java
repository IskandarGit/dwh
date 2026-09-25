package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * И15 шаг 15а.3: таблица описаний сводных отчётов {@code rpt_reports} из V118 и V120 — колонки, ограничения и аудит по контракту.
 */
class RptReportsTableTest extends EmbeddedPostgresTest {

    /** Колонки раздела 1.1 контракта svod-api. */
    private static final List<String> CONTRACT_COLUMNS = List.of(
            "id", "name", "source_id", "source_sheet", "date_field", "measure_kind", "measure_field", "divisor", "decimals",
            "ref_source_id", "ref_sheet", "key1_field", "key1_ref_field", "key2_field", "key2_ref_field",
            "level1_origin", "level1_field", "level2_origin", "level2_field",
            "lock_version", "created_at", "created_by", "modified_at", "modified_by",
            "measure_name", "month_fields");

    private static final List<String> CONTRACT_CONSTRAINTS = List.of(
            "rpt_reports_ck_name", "rpt_reports_ck_period", "rpt_reports_ck_measure_name", "rpt_reports_ck_divisor",
            "rpt_reports_ck_decimals", "rpt_reports_ck_ref", "rpt_reports_ck_level1", "rpt_reports_ck_level2");

    /** Колонки таблицы второй меры из V120 (раздел 10.1 контракта svod-api). */
    private static final List<String> MEASURE2_COLUMNS = List.of(
            "report_id", "name", "source_id", "source_sheet", "date_field", "month_fields", "measure_kind", "measure_field",
            "divisor", "decimals", "ref_source_id", "ref_sheet", "key1_field", "key1_ref_field", "key2_field", "key2_ref_field",
            "level1_origin", "level1_field", "level2_origin", "level2_field",
            "created_at", "created_by", "modified_at", "modified_by");

    private static final List<String> MEASURE2_CONSTRAINTS = List.of(
            "rpt_m2_ck_name", "rpt_m2_ck_period", "rpt_m2_ck_divisor", "rpt_m2_ck_decimals",
            "rpt_m2_ck_ref", "rpt_m2_ck_level1", "rpt_m2_ck_level2");

    @Autowired
    private JdbcClient jdbc;

    @Test
    @DisplayName("И15: таблица rpt_reports есть со всеми колонками контракта")
    void tableHasAllContractColumns() {
        List<String> columns = jdbc
                .sql("select column_name from information_schema.columns where table_name = 'rpt_reports'")
                .query(String.class)
                .list();

        assertThat(CONTRACT_COLUMNS).hasSize(26);
        assertThat(columns).containsExactlyInAnyOrderElementsOf(CONTRACT_COLUMNS);
    }

    @Test
    @DisplayName("И15б: таблица rpt_report_measures2 есть со всеми колонками контракта")
    void measure2TableHasAllContractColumnsConstraintsAndAudit() {
        List<String> columns = jdbc
                .sql("select column_name from information_schema.columns where table_name = 'rpt_report_measures2'")
                .query(String.class)
                .list();
        assertThat(MEASURE2_COLUMNS).hasSize(24);
        assertThat(columns).containsExactlyInAnyOrderElementsOf(MEASURE2_COLUMNS);

        List<String> constraints = jdbc
                .sql("select conname from pg_constraint where conrelid = 'rpt_report_measures2'::regclass")
                .query(String.class)
                .list();
        assertThat(constraints).containsAll(MEASURE2_CONSTRAINTS);

        Long triggers = jdbc
                .sql("select count(*) from pg_trigger where tgrelid = 'rpt_report_measures2'::regclass and not tgisinternal")
                .query(Long.class)
                .single();
        assertThat(triggers).isGreaterThanOrEqualTo(1L);
    }

    @Test
    @DisplayName("И15б: date_field у rpt_reports необязателен, month_fields — массив текста")
    void dateFieldIsNullableAndMonthFieldsIsArray() {
        String dateFieldNullable = jdbc
                .sql("select is_nullable from information_schema.columns where table_name = 'rpt_reports' and column_name = 'date_field'")
                .query(String.class)
                .single();
        String monthFieldsType = jdbc
                .sql("select data_type from information_schema.columns where table_name = 'rpt_reports' and column_name = 'month_fields'")
                .query(String.class)
                .single();

        assertThat(dateFieldNullable).isEqualTo("YES");
        assertThat(monthFieldsType).isEqualTo("ARRAY");
    }

    @Test
    @DisplayName("И15: ограничения rpt_reports на месте")
    void tableHasContractConstraintsAndUniqueName() {
        List<String> constraints = jdbc
                .sql("select conname from pg_constraint where conrelid = 'rpt_reports'::regclass")
                .query(String.class)
                .list();
        assertThat(constraints).containsAll(CONTRACT_CONSTRAINTS);
        assertThat(constraints).doesNotContain("rpt_reports_ck_measure");

        List<String> indexes = jdbc
                .sql("select indexname from pg_indexes where tablename = 'rpt_reports'")
                .query(String.class)
                .list();
        assertThat(indexes).contains("rpt_reports_uk_name");
    }

    @Test
    @DisplayName("И15: изменения rpt_reports пишутся в аудит")
    void tableChangesAreAudited() {
        Long triggers = jdbc
                .sql("select count(*) from pg_trigger where tgrelid = 'rpt_reports'::regclass and not tgisinternal")
                .query(Long.class)
                .single();

        assertThat(triggers).isGreaterThanOrEqualTo(1L);
    }
}
