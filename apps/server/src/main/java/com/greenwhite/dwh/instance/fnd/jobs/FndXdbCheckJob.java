package com.greenwhite.dwh.instance.fnd.jobs;

import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.dwh.DwhUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Сверка двух баз (AC-31): FK между OLTP и pg-dwh нет (02 п.18), поэтому «сироты» ищутся заданием.
 * Строка {@code raw} со ссылкой на несуществующую загрузку или на несуществующий файл каркаса —
 * событие {@code xdb_mismatch} в {@code security_events}; данные при этом не трогаются.
 */
@Component
public class FndXdbCheckJob implements FndJobHandler {

    public static final String CODE = "fnd.xdb_check";
    public static final String EVENT = "xdb_mismatch";
    private static final Logger log = LoggerFactory.getLogger(FndXdbCheckJob.class);
    /** Сверка идёт на самом сервере: адреса клиента у неё нет, а колонка ip обязательна. */
    private static final String LOCAL_IP = "127.0.0.1";

    private final JdbcClient oltp;
    private final DataSource dwh;

    public FndXdbCheckJob(JdbcClient oltp, @Qualifier(FndPref.DWH) DataSource dwh) {
        this.oltp = oltp;
        this.dwh = dwh;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public void run(Map<String, Object> args) {
        List<Long> loadIds = new ArrayList<>();
        List<UUID> fileIds = new ArrayList<>();
        try (Connection connection = dwh.getConnection(); Statement statement = connection.createStatement()) {
            try (ResultSet rs = statement.executeQuery("select distinct load_id from raw.rows")) {
                while (rs.next()) {
                    loadIds.add(rs.getLong(1));
                }
            }
            try (ResultSet rs = statement.executeQuery(
                    "select distinct source_file_id from raw.rows where source_file_id is not null")) {
                while (rs.next()) {
                    fileIds.add(rs.getObject(1, UUID.class));
                }
            }
        } catch (SQLException failure) {
            throw new DwhUnavailableException(failure);
        }

        int mismatches = 0;
        for (Long loadId : loadIds) {
            boolean known = oltp.sql("select count(*) from fnd_loads where id = :id")
                    .param("id", loadId).query(Long.class).single() > 0;
            if (!known) {
                report("{\"load_id\": " + loadId + "}");
                mismatches++;
            }
        }
        for (UUID fileId : fileIds) {
            boolean known = oltp.sql("select count(*) from mf_files where id = :id")
                    .param("id", fileId).query(Long.class).single() > 0;
            if (!known) {
                report("{\"source_file_id\": \"" + fileId + "\"}");
                mismatches++;
            }
        }
        log.info("xdb_check loads={} files={} mismatches={}", loadIds.size(), fileIds.size(), mismatches);
    }

    private void report(String details) {
        Long systemUserId = oltp.sql("select id from md_users where login = :login")
                .param("login", FndPref.SYSTEM_ACTOR).query(Long.class).optional().orElse(null);
        oltp.sql("insert into security_events (event_type, user_id, ip, user_agent, details)"
                        + " values (:event, :user, cast(:ip as inet), :agent, cast(:details as jsonb))")
                .param("event", EVENT).param("user", systemUserId).param("ip", LOCAL_IP)
                .param("agent", CODE).param("details", details).update();
    }
}
