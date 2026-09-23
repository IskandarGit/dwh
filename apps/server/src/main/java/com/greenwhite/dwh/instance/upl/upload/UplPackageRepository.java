package com.greenwhite.dwh.instance.upl.upload;

import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Чтение и запись пакетов загрузки (таблицы V114). Транзакции и актор аудита ставит сервис.
 * Поля {@code jsonb} пишутся через {@code cast(:p as jsonb)}, а читаются как текст и разбираются здесь.
 */
@Repository
public class UplPackageRepository {

    private static final String PACKAGE_SELECT = """
            select p.id, p.public_id, p.source_id, s.code as source_code, s.name as source_name,
                   p.format_version, p.period_from, p.period_to, p.file_id, p.file_name, p.file_sha256,
                   p.file_size_bytes, p.status, p.rows_total, p.rows_accepted, p.rows_rejected, p.errors_total,
                   p.reject_code, p.reject_params::text as reject_params, p.load_id, p.raw_rows,
                   p.uploaded_at, p.uploaded_by
              from upl_packages p
              join upl_sources s on s.id = p.source_id
            """;

    private static final String ERROR_SELECT = """
            select ordinal, sheet, row_no, column_name, cell_value, code, params::text as params
              from upl_package_errors
             where package_id = :package
             order by ordinal
            """;

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    public UplPackageRepository(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public long insert(NewPackage p, String actorName) {
        return jdbc.sql("""
                        insert into upl_packages (source_id, format_version, period_from, period_to, file_id,
                                                  file_name, file_sha256, file_size_bytes,
                                                  uploaded_by_id, uploaded_by)
                        values (:sourceId, :formatVersion, :periodFrom, :periodTo, :fileId,
                                :fileName, :sha, :size, :userId, :actor)
                        returning id
                        """)
                .param("sourceId", p.sourceId())
                .param("formatVersion", p.formatVersion())
                .param("periodFrom", p.periodFrom())
                .param("periodTo", p.periodTo())
                .param("fileId", p.fileId())
                .param("fileName", p.fileName())
                .param("sha", p.fileSha256())
                .param("size", p.fileSizeBytes())
                .param("userId", p.uploadedById())
                .param("actor", actorName)
                .query(Long.class)
                .single();
    }

    public Optional<PackageRow> findById(long id) {
        return jdbc.sql(PACKAGE_SELECT + " where p.id = :id")
                .param("id", id)
                .query(this::mapPackage)
                .optional();
    }

    public Optional<PackageRow> findByPublicId(UUID publicId) {
        return jdbc.sql(PACKAGE_SELECT + " where p.public_id = :publicId")
                .param("publicId", publicId)
                .query(this::mapPackage)
                .optional();
    }

    /** Пакет с блокировкой строки до конца транзакции: второе одновременное «Применить» ждёт первое. */
    public Optional<PackageRow> lockByPublicId(UUID publicId) {
        return jdbc.sql(PACKAGE_SELECT + " where p.public_id = :publicId for update of p")
                .param("publicId", publicId)
                .query(this::mapPackage)
                .optional();
    }

    /** Страница списка: от новых к старым, {@code beforeId} — последний показанный id. */
    public List<PackageRow> list(Long beforeId, int limit) {
        return jdbc.sql(PACKAGE_SELECT + """
                         where (:before::bigint is null or p.id < :before)
                         order by p.id desc
                         limit :limit
                        """)
                .param("before", beforeId)
                .param("limit", limit)
                .query(this::mapPackage)
                .list();
    }

    public long count() {
        return jdbc.sql("select count(*) from upl_packages").query(Long.class).single();
    }

    /** Переводит пакет в «проверен»; возвращает 0, если пакет уже не в статусе «получен». */
    public int markVerified(long id, int total, int accepted, int rejected, int errorsTotal) {
        return jdbc.sql("""
                        update upl_packages
                           set status = 'verified',
                               rows_total = :total,
                               rows_accepted = :accepted,
                               rows_rejected = :rejected,
                               errors_total = :errors,
                               modified_at = now()
                         where id = :id and status = 'received'
                        """)
                .param("total", total)
                .param("accepted", accepted)
                .param("rejected", rejected)
                .param("errors", errorsTotal)
                .param("id", id)
                .update();
    }

    /** Переводит пакет в «отклонён системой»; возвращает 0, если пакет уже не в статусе «получен». */
    public int markRejected(long id, String rejectCode, Map<String, Object> rejectParams, Integer errorsTotal) {
        return jdbc.sql("""
                        update upl_packages
                           set status = 'rejected',
                               reject_code = :code,
                               reject_params = cast(:params as jsonb),
                               errors_total = :errors,
                               modified_at = now()
                         where id = :id and status = 'received'
                        """)
                .param("code", rejectCode)
                .param("params", json.writeValueAsString(rejectParams == null ? Map.of() : rejectParams))
                .param("errors", errorsTotal)
                .param("id", id)
                .update();
    }

    /** Запоминает номер загрузки основы у пакета «проверен»; 0 — пакет не «проверен» или номер уже есть. */
    public int setLoadId(long id, long loadId) {
        return jdbc.sql("""
                        update upl_packages
                           set load_id = :load,
                               modified_at = now()
                         where id = :id and status = 'verified' and load_id is null
                        """)
                .param("load", loadId)
                .param("id", id)
                .update();
    }

    /** Переводит пакет «проверен» в «применён»; 0 — пакет уже не «проверен». */
    public int markApplied(long id, int rawRows) {
        return jdbc.sql("""
                        update upl_packages
                           set status = 'applied',
                               raw_rows = :raw,
                               modified_at = now()
                         where id = :id and status = 'verified'
                        """)
                .param("raw", rawRows)
                .param("id", id)
                .update();
    }

    /** Закрывает пакет «проверен» причиной «отклонён системой» при применении; 0 — пакет уже не «проверен». */
    public int markApplyRejected(long id, String rejectCode, Map<String, Object> rejectParams, Integer rawRows) {
        return jdbc.sql("""
                        update upl_packages
                           set status = 'rejected',
                               reject_code = :code,
                               reject_params = cast(:params as jsonb),
                               raw_rows = :raw,
                               modified_at = now()
                         where id = :id and status = 'verified'
                        """)
                .param("code", rejectCode)
                .param("params", json.writeValueAsString(rejectParams == null ? Map.of() : rejectParams))
                .param("raw", rawRows)
                .param("id", id)
                .update();
    }

    public void insertErrors(long packageId, List<ErrorRow> errors) {
        for (ErrorRow error : errors) {
            jdbc.sql("""
                            insert into upl_package_errors (package_id, ordinal, sheet, row_no, column_name,
                                                            cell_value, code, params)
                            values (:package, :ordinal, :sheet, :rowNo, :column, :value, :code,
                                    cast(:params as jsonb))
                            """)
                    .param("package", packageId)
                    .param("ordinal", error.ordinal())
                    .param("sheet", error.sheet())
                    .param("rowNo", error.rowNo())
                    .param("column", error.columnName())
                    .param("value", error.cellValue())
                    .param("code", error.code())
                    .param("params", json.writeValueAsString(error.params() == null ? Map.of() : error.params()))
                    .update();
        }
    }

    public List<ErrorRow> findErrors(long packageId) {
        return jdbc.sql(ERROR_SELECT)
                .param("package", packageId)
                .query(this::mapError)
                .list();
    }

    private PackageRow mapPackage(ResultSet rs, int rowNum) throws SQLException {
        return new PackageRow(
                rs.getLong("id"),
                rs.getObject("public_id", UUID.class),
                rs.getLong("source_id"),
                rs.getString("source_code"),
                rs.getString("source_name"),
                rs.getInt("format_version"),
                rs.getObject("period_from", LocalDate.class),
                rs.getObject("period_to", LocalDate.class),
                rs.getObject("file_id", UUID.class),
                rs.getString("file_name"),
                rs.getString("file_sha256"),
                rs.getLong("file_size_bytes"),
                rs.getString("status"),
                rs.getObject("rows_total", Integer.class),
                rs.getObject("rows_accepted", Integer.class),
                rs.getObject("rows_rejected", Integer.class),
                rs.getObject("errors_total", Integer.class),
                rs.getString("reject_code"),
                readJson(rs.getString("reject_params")),
                rs.getObject("load_id", Long.class),
                rs.getObject("raw_rows", Integer.class),
                toInstant(rs.getTimestamp("uploaded_at")),
                rs.getString("uploaded_by"));
    }

    private ErrorRow mapError(ResultSet rs, int rowNum) throws SQLException {
        return new ErrorRow(
                rs.getInt("ordinal"),
                rs.getString("sheet"),
                rs.getObject("row_no", Integer.class),
                rs.getString("column_name"),
                rs.getString("cell_value"),
                rs.getString("code"),
                readJson(rs.getString("params")));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJson(String raw) {
        if (raw == null) {
            return null;
        }
        return json.readValue(raw, Map.class);
    }

    private static Instant toInstant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }
}
