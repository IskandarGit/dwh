package com.greenwhite.dwh.instance.upl.format;

import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Source;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceSummary;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Strictness;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Чтение и запись анкеты файла (таблицы V111). Транзакции и актор аудита ставит сервис.
 */
@Repository
public class UplFormatRepository {

    private static final String SOURCE_COLUMNS = """
            id, code, name, owner_org, owner_contact, periodicity, sla_days, source_type,
            reconciliation_strictness, lock_version, created_at, created_by, modified_at, modified_by
            """;

    private static final String VERSION_COLUMNS = """
            source_id, version, valid_from, valid_to, status, published_at, published_by, lock_version,
            file_kind, encoding, delimiter, match_columns_by
            """;

    private final JdbcClient jdbc;

    public UplFormatRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public long insertSource(SourceData d, String actor) {
        return jdbc.sql("""
                        insert into upl_sources (code, name, owner_org, owner_contact, periodicity, sla_days,
                                                 source_type, reconciliation_strictness, created_by, modified_by)
                        values (:code, :name, :ownerOrg, :ownerContact, :periodicity, :slaDays,
                                :sourceType, :strictness, :actor, :actor)
                        returning id
                        """)
                .param("code", d.code())
                .param("name", d.name())
                .param("ownerOrg", d.ownerOrg())
                .param("ownerContact", d.ownerContact())
                .param("periodicity", d.periodicity().db())
                .param("slaDays", d.slaDays())
                .param("sourceType", d.sourceType().db())
                .param("strictness", d.strictness().db())
                .param("actor", actor)
                .query(Long.class)
                .single();
    }

    public Optional<Source> findSource(long id) {
        return jdbc.sql("select " + SOURCE_COLUMNS + " from upl_sources where id = :id")
                .param("id", id)
                .query(this::mapSource)
                .optional();
    }

    public int updateSource(long id, int expectedLockVersion, SourceData d, String actor) {
        return jdbc.sql("""
                        update upl_sources
                        set name = :name,
                            owner_org = :ownerOrg,
                            owner_contact = :ownerContact,
                            periodicity = :periodicity,
                            sla_days = :slaDays,
                            source_type = :sourceType,
                            reconciliation_strictness = :strictness,
                            lock_version = lock_version + 1,
                            modified_at = now(),
                            modified_by = :actor
                        where id = :id and lock_version = :lv
                        """)
                .param("name", d.name())
                .param("ownerOrg", d.ownerOrg())
                .param("ownerContact", d.ownerContact())
                .param("periodicity", d.periodicity().db())
                .param("slaDays", d.slaDays())
                .param("sourceType", d.sourceType().db())
                .param("strictness", d.strictness().db())
                .param("actor", actor)
                .param("id", id)
                .param("lv", expectedLockVersion)
                .update();
    }

    public List<SourceSummary> listSources(String afterCode, int limit) {
        return jdbc.sql("""
                        select s.id, s.code, s.name, s.periodicity,
                               (select max(v.version) from upl_format_versions v
                                 where v.source_id = s.id and v.status <> 'draft') as last_published_version,
                               exists (select 1 from upl_format_versions v
                                        where v.source_id = s.id and v.status = 'draft') as has_draft
                        from upl_sources s
                        where (:after::text is null or s.code > :after)
                        order by s.code
                        limit :limit
                        """)
                .param("after", afterCode)
                .param("limit", limit)
                .query(this::mapSummary)
                .list();
    }

    public long countSources() {
        return jdbc.sql("select count(*) from upl_sources")
                .query(Long.class)
                .single();
    }

    public List<FormatVersion> listVersions(long sourceId) {
        return jdbc.sql("select " + VERSION_COLUMNS + " from upl_format_versions where source_id = :s order by version")
                .param("s", sourceId)
                .query(this::mapVersion)
                .list();
    }

    public Optional<FormatVersion> findVersion(long sourceId, int version) {
        Optional<FormatVersion> header = jdbc.sql("select " + VERSION_COLUMNS
                        + " from upl_format_versions where source_id = :s and version = :v")
                .param("s", sourceId)
                .param("v", version)
                .query(this::mapVersion)
                .optional();
        return header.map(h -> h.withSheets(loadSheets(sourceId, version)));
    }

    public Optional<Integer> latestVersion(long sourceId) {
        return jdbc.sql("select version from upl_format_versions where source_id = :s order by version desc limit 1")
                .param("s", sourceId)
                .query(Integer.class)
                .optional();
    }

    public void replaceSheets(long sourceId, int version, List<Sheet> sheets) {
        jdbc.sql("delete from upl_format_sheets where source_id = :s and version = :v")
                .param("s", sourceId)
                .param("v", version)
                .update();
        for (int i = 0; i < sheets.size(); i++) {
            Sheet sheet = sheets.get(i);
            long sheetId = insertSheet(sourceId, version, i + 1, sheet);
            List<Column> columns = sheet.columns();
            for (int j = 0; j < columns.size(); j++) {
                insertColumn(sheetId, j + 1, columns.get(j));
            }
        }
    }

    private long insertSheet(long sourceId, int version, int ordinal, Sheet sheet) {
        return jdbc.sql("""
                        insert into upl_format_sheets (source_id, version, ordinal, sheet_name, header_row, total_row_marker)
                        values (:s, :v, :ordinal, :sheetName, :headerRow, :totalRowMarker)
                        returning id
                        """)
                .param("s", sourceId)
                .param("v", version)
                .param("ordinal", ordinal)
                .param("sheetName", sheet.sheetName())
                .param("headerRow", sheet.headerRow())
                .param("totalRowMarker", sheet.totalRowMarker())
                .query(Long.class)
                .single();
    }

    private void insertColumn(long sheetId, int ordinal, Column c) {
        jdbc.sql("""
                        insert into upl_format_columns (sheet_id, ordinal, file_position, name_in_file, target_field,
                                                        data_type, required, source_unit, base_unit,
                                                        key_mask, key_pad_length, key_pad_max, ref_book_code)
                        values (:sheetId, :ordinal, :filePosition, :nameInFile, :targetField,
                                :dataType, :required, :sourceUnit, :baseUnit,
                                :keyMask, :keyPadLength, :keyPadMax, :refBookCode)
                        """)
                .param("sheetId", sheetId)
                .param("ordinal", ordinal)
                .param("filePosition", c.filePosition())
                .param("nameInFile", c.nameInFile())
                .param("targetField", c.targetField())
                .param("dataType", c.dataType().db())
                .param("required", c.required())
                .param("sourceUnit", c.sourceUnit())
                .param("baseUnit", c.baseUnit())
                .param("keyMask", c.keyMask())
                .param("keyPadLength", c.keyPadLength())
                .param("keyPadMax", c.keyPadMax())
                .param("refBookCode", c.refBookCode())
                .update();
    }

    private List<Sheet> loadSheets(long sourceId, int version) {
        Map<Long, List<Column>> columnsBySheet = new HashMap<>();
        jdbc.sql("""
                        select id, sheet_id, ordinal, file_position, name_in_file, target_field, data_type, required,
                               source_unit, base_unit, key_mask, key_pad_length, key_pad_max, ref_book_code
                        from upl_format_columns
                        where sheet_id in (select id from upl_format_sheets where source_id = :s and version = :v)
                        order by sheet_id, ordinal
                        """)
                .param("s", sourceId)
                .param("v", version)
                .query((ResultSet rs) -> {
                    Column column = mapColumn(rs);
                    columnsBySheet.computeIfAbsent(rs.getLong("sheet_id"), k -> new ArrayList<>()).add(column);
                });
        return jdbc.sql("""
                        select id, ordinal, sheet_name, header_row, total_row_marker
                        from upl_format_sheets
                        where source_id = :s and version = :v
                        order by ordinal
                        """)
                .param("s", sourceId)
                .param("v", version)
                .query((rs, rowNum) -> new Sheet(
                        rs.getLong("id"),
                        rs.getInt("ordinal"),
                        rs.getString("sheet_name"),
                        rs.getInt("header_row"),
                        rs.getString("total_row_marker"),
                        List.copyOf(columnsBySheet.getOrDefault(rs.getLong("id"), List.of()))))
                .list();
    }

    private Source mapSource(ResultSet rs, int rowNum) throws SQLException {
        return new Source(
                rs.getLong("id"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("owner_org"),
                rs.getString("owner_contact"),
                Periodicity.fromDb(rs.getString("periodicity")),
                rs.getInt("sla_days"),
                SourceType.fromDb(rs.getString("source_type")),
                Strictness.fromDb(rs.getString("reconciliation_strictness")),
                rs.getInt("lock_version"),
                toInstant(rs.getTimestamp("created_at")),
                rs.getString("created_by"),
                toInstant(rs.getTimestamp("modified_at")),
                rs.getString("modified_by"));
    }

    private SourceSummary mapSummary(ResultSet rs, int rowNum) throws SQLException {
        return new SourceSummary(
                rs.getLong("id"),
                rs.getString("code"),
                rs.getString("name"),
                Periodicity.fromDb(rs.getString("periodicity")),
                rs.getObject("last_published_version", Integer.class),
                rs.getBoolean("has_draft"));
    }

    private FormatVersion mapVersion(ResultSet rs, int rowNum) throws SQLException {
        return new FormatVersion(
                rs.getLong("source_id"),
                rs.getInt("version"),
                rs.getObject("valid_from", LocalDate.class),
                rs.getObject("valid_to", LocalDate.class),
                rs.getString("status"),
                toInstant(rs.getTimestamp("published_at")),
                rs.getString("published_by"),
                rs.getInt("lock_version"),
                FileKind.fromDb(rs.getString("file_kind")),
                rs.getString("encoding"),
                rs.getString("delimiter"),
                MatchBy.fromDb(rs.getString("match_columns_by")),
                List.of());
    }

    private Column mapColumn(ResultSet rs) throws SQLException {
        return new Column(
                rs.getLong("id"),
                rs.getInt("ordinal"),
                rs.getObject("file_position", Integer.class),
                rs.getString("name_in_file"),
                rs.getString("target_field"),
                DataType.fromDb(rs.getString("data_type")),
                rs.getBoolean("required"),
                rs.getString("source_unit"),
                rs.getString("base_unit"),
                rs.getString("key_mask"),
                rs.getObject("key_pad_length", Integer.class),
                rs.getObject("key_pad_max", Integer.class),
                rs.getString("ref_book_code"));
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }
}
