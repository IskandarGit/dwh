package com.greenwhite.dwh.instance.rpt.repo;

import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.core.simple.JdbcClient.StatementSpec;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Чтение и запись описаний сводных отчётов (таблица {@code rpt_reports}, V118). Транзакции и актор аудита ставит сервис.
 */
@Repository
public class RptReportRepository {

    private static final String COLUMNS = """
            id, name, source_id, source_sheet, date_field, measure_kind, measure_field, divisor, decimals,
            ref_source_id, ref_sheet, key1_field, key1_ref_field, key2_field, key2_ref_field,
            level1_origin, level1_field, level2_origin, level2_field, lock_version, modified_at, modified_by
            """;

    private final JdbcClient jdbc;

    public RptReportRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Строка {@code rpt_reports}; {@code id}, {@code lockVersion}, {@code modifiedAt}, {@code modifiedBy} при записи не читаются. */
    public record Row(Long id, String name, long sourceId, int sourceSheet, String dateField, String measureKind,
                      String measureField, int divisor, int decimals, Long refSourceId, Integer refSheet,
                      String key1Field, String key1RefField, String key2Field, String key2RefField,
                      String level1Origin, String level1Field, String level2Origin, String level2Field,
                      int lockVersion, OffsetDateTime modifiedAt, String modifiedBy) { }

    public List<ReportItem> list() {
        return jdbc.sql("""
                        select r.id, r.name, s.name as source_name, r.modified_at
                          from rpt_reports r
                          join upl_sources s on s.id = r.source_id
                         order by lower(r.name), r.id
                        """)
                .query((rs, rowNum) -> new ReportItem(rs.getLong("id"), rs.getString("name"),
                        rs.getString("source_name"), rs.getObject("modified_at", OffsetDateTime.class)))
                .list();
    }

    public Optional<Row> find(long id) {
        return jdbc.sql("select " + COLUMNS + " from rpt_reports where id = :id")
                .param("id", id)
                .query(this::mapRow)
                .optional();
    }

    /** Есть ли другой отчёт с тем же названием без учёта регистра и пробелов по краям; {@code exceptId} — свой id или null. */
    public boolean nameTaken(String name, Long exceptId) {
        return jdbc.sql("""
                        select exists (select 1 from rpt_reports
                                        where lower(btrim(name)) = lower(btrim(:name))
                                          and (:exceptId::bigint is null or id <> :exceptId))
                        """)
                .param("name", name)
                .param("exceptId", exceptId)
                .query(Boolean.class)
                .single();
    }

    public long insert(Row row, String actor) {
        StatementSpec spec = jdbc.sql("""
                        insert into rpt_reports (name, source_id, source_sheet, date_field, measure_kind, measure_field,
                                                 divisor, decimals, ref_source_id, ref_sheet,
                                                 key1_field, key1_ref_field, key2_field, key2_ref_field,
                                                 level1_origin, level1_field, level2_origin, level2_field,
                                                 created_by, modified_by)
                        values (:name, :sourceId, :sourceSheet, :dateField, :measureKind, :measureField,
                                :divisor, :decimals, :refSourceId, :refSheet,
                                :key1Field, :key1RefField, :key2Field, :key2RefField,
                                :level1Origin, :level1Field, :level2Origin, :level2Field,
                                :actor, :actor)
                        returning id
                        """);
        return bind(spec, row)
                .param("actor", actor)
                .query(Long.class)
                .single();
    }

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
                            lock_version = lock_version + 1,
                            modified_at = now(),
                            modified_by = :actor
                        where id = :id and lock_version = :lv
                        """);
        return bind(spec, row)
                .param("actor", actor)
                .param("id", id)
                .param("lv", expectedLockVersion)
                .update();
    }

    private static StatementSpec bind(StatementSpec spec, Row row) {
        return spec.param("name", row.name())
                .param("sourceId", row.sourceId())
                .param("sourceSheet", row.sourceSheet())
                .param("dateField", row.dateField())
                .param("measureKind", row.measureKind())
                .param("measureField", row.measureField())
                .param("divisor", row.divisor())
                .param("decimals", row.decimals())
                .param("refSourceId", row.refSourceId())
                .param("refSheet", row.refSheet())
                .param("key1Field", row.key1Field())
                .param("key1RefField", row.key1RefField())
                .param("key2Field", row.key2Field())
                .param("key2RefField", row.key2RefField())
                .param("level1Origin", row.level1Origin())
                .param("level1Field", row.level1Field())
                .param("level2Origin", row.level2Origin())
                .param("level2Field", row.level2Field());
    }

    private Row mapRow(ResultSet rs, int rowNum) throws SQLException {
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
                rs.getString("modified_by"));
    }
}
