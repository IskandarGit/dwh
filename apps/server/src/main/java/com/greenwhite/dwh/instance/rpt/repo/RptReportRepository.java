package com.greenwhite.dwh.instance.rpt.repo;

import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.core.simple.JdbcClient.StatementSpec;
import org.springframework.stereotype.Repository;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * Чтение и запись описаний сводных отчётов: мера 1 — таблица {@code rpt_reports} (V118, V120), мера 2 —
 * {@code rpt_report_measures2} (V120). Транзакции и актор аудита ставит сервис.
 */
@Repository
public class RptReportRepository {

    private static final String COLUMNS = """
            id, name, source_id, source_sheet, date_field, measure_kind, measure_field, divisor, decimals,
            ref_source_id, ref_sheet, key1_field, key1_ref_field, key2_field, key2_ref_field,
            level1_origin, level1_field, level2_origin, level2_field, lock_version, modified_at, modified_by,
            measure_name, month_fields
            """;
    private static final String MEASURE2_COLUMNS = """
            name, source_id, source_sheet, date_field, month_fields, measure_kind, measure_field, divisor, decimals,
            ref_source_id, ref_sheet, key1_field, key1_ref_field, key2_field, key2_ref_field,
            level1_origin, level1_field, level2_origin, level2_field
            """;

    private final JdbcClient jdbc;

    public RptReportRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Строка {@code rpt_reports}; {@code id}, {@code lockVersion}, {@code modifiedAt}, {@code modifiedBy} при записи не читаются.
     * {@code monthFields} — 12 элементов (null — месяца нет) или null; {@code second} — мера 2 или null.
     */
    public record Row(Long id, String name, long sourceId, int sourceSheet, String dateField, String measureKind,
                      String measureField, int divisor, int decimals, Long refSourceId, Integer refSheet,
                      String key1Field, String key1RefField, String key2Field, String key2RefField,
                      String level1Origin, String level1Field, String level2Origin, String level2Field,
                      int lockVersion, OffsetDateTime modifiedAt, String modifiedBy,
                      String measureName, List<String> monthFields, MeasureRow second) {

        /** Мера 1 в том же виде, что мера 2; её название — {@code measureName}. */
        public MeasureRow first() {
            return new MeasureRow(measureName, sourceId, sourceSheet, dateField, monthFields, measureKind, measureField,
                    divisor, decimals, refSourceId, refSheet, key1Field, key1RefField, key2Field, key2RefField,
                    level1Origin, level1Field, level2Origin, level2Field);
        }

        private Row withSecond(MeasureRow value) {
            return new Row(id, name, sourceId, sourceSheet, dateField, measureKind, measureField, divisor, decimals,
                    refSourceId, refSheet, key1Field, key1RefField, key2Field, key2RefField,
                    level1Origin, level1Field, level2Origin, level2Field, lockVersion, modifiedAt, modifiedBy,
                    measureName, monthFields, value);
        }
    }

    /** Мера отчёта в колонках базы; у меры 2 — строка {@code rpt_report_measures2}. */
    public record MeasureRow(String name, long sourceId, int sourceSheet, String dateField, List<String> monthFields,
                             String measureKind, String measureField, int divisor, int decimals,
                             Long refSourceId, Integer refSheet,
                             String key1Field, String key1RefField, String key2Field, String key2RefField,
                             String level1Origin, String level1Field, String level2Origin, String level2Field) { }

    public List<ReportItem> list() {
        return jdbc.sql("""
                        select r.id, r.name, s.name as source_name, r.modified_at
                          from rpt_reports r
                          join upl_sources s on s.id = r.source_id
                         order by lower(r.name collate "und-x-icu"), r.id
                        """)
                .query((rs, rowNum) -> new ReportItem(rs.getLong("id"), rs.getString("name"),
                        rs.getString("source_name"), rs.getObject("modified_at", OffsetDateTime.class)))
                .list();
    }

    public Optional<Row> find(long id) {
        return jdbc.sql("select " + COLUMNS + " from rpt_reports where id = :id")
                .param("id", id)
                .query(RptReportRepository::mapRow)
                .optional()
                .map(row -> row.withSecond(findSecond(id).orElse(null)));
    }

    /** Есть ли другой отчёт с тем же названием без учёта регистра и пробелов по краям; {@code exceptId} — свой id или null. */
    public boolean nameTaken(String name, Long exceptId) {
        return jdbc.sql("""
                        select exists (select 1 from rpt_reports
                                        where lower(btrim(name) collate "und-x-icu") = lower(btrim(:name) collate "und-x-icu")
                                          and (:exceptId::bigint is null or id <> :exceptId))
                        """)
                .param("name", name)
                .param("exceptId", exceptId)
                .query(Boolean.class)
                .single();
    }

    /** Новый отчёт вместе с мерой 2 (если есть) — в транзакции вызывающего сервиса. */
    public long insert(Row row, String actor) {
        StatementSpec spec = jdbc.sql("""
                        insert into rpt_reports (name, source_id, source_sheet, date_field, measure_kind, measure_field,
                                                 divisor, decimals, ref_source_id, ref_sheet,
                                                 key1_field, key1_ref_field, key2_field, key2_ref_field,
                                                 level1_origin, level1_field, level2_origin, level2_field,
                                                 measure_name, month_fields, created_by, modified_by)
                        values (:name, :sourceId, :sourceSheet, :dateField, :measureKind, :measureField,
                                :divisor, :decimals, :refSourceId, :refSheet,
                                :key1Field, :key1RefField, :key2Field, :key2RefField,
                                :level1Origin, :level1Field, :level2Origin, :level2Field,
                                :measureName, :monthFields, :actor, :actor)
                        returning id
                        """);
        long id = bindReport(spec, row)
                .param("actor", actor)
                .query(Long.class)
                .single();
        replaceSecond(id, row.second(), actor);
        return id;
    }

    /** Правка с проверкой {@code lock_version}; 0 — версия устарела, мера 2 тогда не трогается. */
    public int update(long id, int expectedLockVersion, Row row, String actor) {
        StatementSpec spec = jdbc.sql("""
                        update rpt_reports
                        set name = :name,
                            source_id = :sourceId,
                            source_sheet = :sourceSheet,
                            date_field = :dateField,
                            measure_kind = :measureKind,
                            measure_field = :measureField,
                            divisor = :divisor,
                            decimals = :decimals,
                            ref_source_id = :refSourceId,
                            ref_sheet = :refSheet,
                            key1_field = :key1Field,
                            key1_ref_field = :key1RefField,
                            key2_field = :key2Field,
                            key2_ref_field = :key2RefField,
                            level1_origin = :level1Origin,
                            level1_field = :level1Field,
                            level2_origin = :level2Origin,
                            level2_field = :level2Field,
                            measure_name = :measureName,
                            month_fields = :monthFields,
                            lock_version = lock_version + 1,
                            modified_at = now(),
                            modified_by = :actor
                        where id = :id and lock_version = :lv
                        """);
        int updated = bindReport(spec, row)
                .param("actor", actor)
                .param("id", id)
                .param("lv", expectedLockVersion)
                .update();
        if (updated > 0) {
            replaceSecond(id, row.second(), actor);
        }
        return updated;
    }

    private Optional<MeasureRow> findSecond(long reportId) {
        return jdbc.sql("select " + MEASURE2_COLUMNS + " from rpt_report_measures2 where report_id = :id")
                .param("id", reportId)
                .query((rs, rowNum) -> mapMeasure(rs))
                .optional();
    }

    /** Мера 2 заменяется целиком: прежняя строка удаляется, новая пишется, если мера 2 задана. */
    private void replaceSecond(long reportId, MeasureRow second, String actor) {
        jdbc.sql("delete from rpt_report_measures2 where report_id = :id")
                .param("id", reportId)
                .update();
        if (second == null) {
            return;
        }
        StatementSpec spec = jdbc.sql("""
                        insert into rpt_report_measures2 (report_id, name, source_id, source_sheet, date_field, month_fields,
                                                          measure_kind, measure_field, divisor, decimals,
                                                          ref_source_id, ref_sheet,
                                                          key1_field, key1_ref_field, key2_field, key2_ref_field,
                                                          level1_origin, level1_field, level2_origin, level2_field,
                                                          created_by, modified_by)
                        values (:id, :name, :sourceId, :sourceSheet, :dateField, :monthFields,
                                :measureKind, :measureField, :divisor, :decimals,
                                :refSourceId, :refSheet,
                                :key1Field, :key1RefField, :key2Field, :key2RefField,
                                :level1Origin, :level1Field, :level2Origin, :level2Field,
                                :actor, :actor)
                        """);
        bindMeasure(spec, second)
                .param("id", reportId)
                .param("name", second.name())
                .param("actor", actor)
                .update();
    }

    private static StatementSpec bindReport(StatementSpec spec, Row row) {
        return bindMeasure(spec, row.first())
                .param("name", row.name())
                .param("measureName", row.measureName());
    }

    /** Колонки меры, общие для обеих таблиц; названия отчёта и меры ставит вызывающий. */
    private static StatementSpec bindMeasure(StatementSpec spec, MeasureRow measure) {
        return spec.param("sourceId", measure.sourceId())
                .param("sourceSheet", measure.sourceSheet())
                .param("dateField", measure.dateField())
                .param("monthFields", measure.monthFields() == null ? null : measure.monthFields().toArray(String[]::new))
                .param("measureKind", measure.measureKind())
                .param("measureField", measure.measureField())
                .param("divisor", measure.divisor())
                .param("decimals", measure.decimals())
                .param("refSourceId", measure.refSourceId())
                .param("refSheet", measure.refSheet())
                .param("key1Field", measure.key1Field())
                .param("key1RefField", measure.key1RefField())
                .param("key2Field", measure.key2Field())
                .param("key2RefField", measure.key2RefField())
                .param("level1Origin", measure.level1Origin())
                .param("level1Field", measure.level1Field())
                .param("level2Origin", measure.level2Origin())
                .param("level2Field", measure.level2Field());
    }

    private static Row mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new Row(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getLong("source_id"),
                rs.getInt("source_sheet"),
                rs.getString("date_field"),
                rs.getString("measure_kind"),
                rs.getString("measure_field"),
                rs.getInt("divisor"),
                rs.getInt("decimals"),
                rs.getObject("ref_source_id", Long.class),
                rs.getObject("ref_sheet", Integer.class),
                rs.getString("key1_field"),
                rs.getString("key1_ref_field"),
                rs.getString("key2_field"),
                rs.getString("key2_ref_field"),
                rs.getString("level1_origin"),
                rs.getString("level1_field"),
                rs.getString("level2_origin"),
                rs.getString("level2_field"),
                rs.getInt("lock_version"),
                rs.getObject("modified_at", OffsetDateTime.class),
                rs.getString("modified_by"),
                rs.getString("measure_name"),
                monthFields(rs),
                null);
    }

    private static MeasureRow mapMeasure(ResultSet rs) throws SQLException {
        return new MeasureRow(
                rs.getString("name"),
                rs.getLong("source_id"),
                rs.getInt("source_sheet"),
                rs.getString("date_field"),
                monthFields(rs),
                rs.getString("measure_kind"),
                rs.getString("measure_field"),
                rs.getInt("divisor"),
                rs.getInt("decimals"),
                rs.getObject("ref_source_id", Long.class),
                rs.getObject("ref_sheet", Integer.class),
                rs.getString("key1_field"),
                rs.getString("key1_ref_field"),
                rs.getString("key2_field"),
                rs.getString("key2_ref_field"),
                rs.getString("level1_origin"),
                rs.getString("level1_field"),
                rs.getString("level2_origin"),
                rs.getString("level2_field"));
    }

    /** {@code month_fields} с null-элементами; колонки нет значения — null. */
    private static List<String> monthFields(ResultSet rs) throws SQLException {
        Array array = rs.getArray("month_fields");
        if (array == null) {
            return null;
        }
        try {
            return Collections.unmodifiableList(Arrays.asList((String[]) array.getArray()));
        } finally {
            array.free();
        }
    }
}
