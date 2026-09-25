package com.greenwhite.dwh.instance.fnd.dwh;

import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.load.FndLoad;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Запись строк в {@code raw} второй базы (AC-33, AC-34, AC-36). Раскладка raw скрыта: модули
 * видят только этот фасад, поэтому переход с общей таблицы на таблицу-на-источник их не затронет.
 *
 * <p>Статус загрузки живёт в OLTP, строки — в pg-dwh; распределённой транзакции между ними нет
 * (02 п.18). Поэтому порядок такой: в транзакции OLTP строка загрузки берётся {@code for share}
 * и проверяется статус {@code pending}, затем строки пишутся одной транзакцией pg-dwh, и только
 * после её коммита отпускается OLTP-блокировка. Параллельный {@code apply}/{@code fail} (они берут
 * {@code for update}) ждёт конца записи — строки не попадут в уже применённую загрузку (13 инв.4).
 * Сбой на любой строке — откат всей записи.
 */
@Component
public class JdbcFndRawWriter implements FndRawWriter {

    private static final Logger log = LoggerFactory.getLogger(JdbcFndRawWriter.class);
    private static final int BATCH = 500;
    private static final String INSERT = """
            insert into raw.rows (load_id, source_file_id, row_no, sheet, source_row_no, fields, rejected)
            values (?, ?, ?, ?, ?, cast(? as jsonb), ?)
            """;

    private final DataSource dwh;
    private final JdbcClient oltp;
    private final TransactionTemplate oltpTx;
    private final ObjectMapper json;

    public JdbcFndRawWriter(@Qualifier(FndPref.DWH) DataSource dwh, JdbcClient oltp,
                            PlatformTransactionManager oltpTransactions, ObjectMapper json) {
        this.dwh = dwh;
        this.oltp = oltp;
        this.oltpTx = new TransactionTemplate(oltpTransactions);
        this.json = json;
    }

    @Override
    public void write(long loadId, UUID sourceFileId, Iterable<FndRawRow> rows) {
        oltpTx.executeWithoutResult(status -> {
            requirePending(loadId);
            writeRows(loadId, sourceFileId, rows);
        });
    }

    private void writeRows(long loadId, UUID sourceFileId, Iterable<FndRawRow> rows) {
        int written = 0;
        try (Connection connection = connect()) {
            boolean autoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try (PreparedStatement statement = connection.prepareStatement(INSERT)) {
                int inBatch = 0;
                for (FndRawRow row : rows) {
                    statement.setLong(1, loadId);
                    statement.setObject(2, sourceFileId, Types.OTHER);
                    statement.setLong(3, row.rowNo());
                    statement.setString(4, row.sheet());
                    if (row.sourceRowNo() == null) {
                        statement.setNull(5, Types.INTEGER);
                    } else {
                        statement.setInt(5, row.sourceRowNo());
                    }
                    statement.setString(6, json.writeValueAsString(row.fields() == null ? Map.of() : row.fields()));
                    statement.setBoolean(7, row.rejected());
                    statement.addBatch();
                    written++;
                    if (++inBatch == BATCH) {
                        statement.executeBatch();
                        inBatch = 0;
                    }
                }
                if (inBatch > 0) {
                    statement.executeBatch();
                }
                connection.commit();
            } catch (RuntimeException | SQLException failure) {
                // Источник строк тоже может бросить исключение (AC-34): в raw не должно остаться ничего
                rollback(connection);
                throw failure;
            } finally {
                connection.setAutoCommit(autoCommit);
            }
        } catch (SQLException failure) {
            throw new DwhUnavailableException(failure);
        }
        // В журнале только объём: содержимое строк raw в логи не попадает (AC-43)
        log.info("raw_write load_id={} rows={}", loadId, written);
    }

    @Override
    public List<FndRawRow> read(long loadId) {
        List<FndRawRow> rows = new ArrayList<>();
        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement(
                     "select row_no, sheet, source_row_no, fields::text as fields from raw.rows"
                             + " where load_id = ? order by row_no")) {
            statement.setLong(1, loadId);
            try (var rs = statement.executeQuery()) {
                while (rs.next()) {
                    Object sourceRowNo = rs.getObject("source_row_no");
                    rows.add(new FndRawRow(rs.getLong("row_no"), rs.getString("sheet"),
                            sourceRowNo == null ? null : ((Number) sourceRowNo).intValue(),
                            json.readValue(rs.getString("fields"), Map.class)));
                }
            }
        } catch (SQLException failure) {
            throw new DwhUnavailableException(failure);
        }
        return rows;
    }

    /** Проверка статуса под {@code for share}: блокировка держится до конца OLTP-транзакции {@link #write}. */
    private void requirePending(long loadId) {
        String status = oltp.sql("select status from fnd_loads where id = :id for share")
                .param("id", loadId).query(String.class).optional().orElse(null);
        if (!FndLoad.PENDING.equals(status)) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);
        }
    }

    private Connection connect() throws SQLException {
        return dwh.getConnection();
    }

    private static void rollback(Connection connection) {
        try {
            connection.rollback();
        } catch (SQLException rollbackFailure) {
            log.error("raw_write откат не выполнен", rollbackFailure);
        }
    }
}
