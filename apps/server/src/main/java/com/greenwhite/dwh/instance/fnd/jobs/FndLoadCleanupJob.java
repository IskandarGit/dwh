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
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;

/**
 * Единственное место, где строки удаляются из {@code raw} (AC-31): убирает данные загрузок,
 * оставшихся в статусе {@code failed}. Применённые загрузки не трогаются никогда — raw неизменяем
 * (13 инв.4), а неудачная загрузка данных не образует.
 */
@Component
public class FndLoadCleanupJob implements FndJobHandler {

    public static final String CODE = "fnd.load_cleanup";
    private static final Logger log = LoggerFactory.getLogger(FndLoadCleanupJob.class);

    private final JdbcClient oltp;
    private final DataSource dwh;

    public FndLoadCleanupJob(JdbcClient oltp, @Qualifier(FndPref.DWH) DataSource dwh) {
        this.oltp = oltp;
        this.dwh = dwh;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public void run(java.util.Map<String, Object> args) {
        List<Long> failed = oltp.sql("select id from fnd_loads where status = 'failed'")
                .query(Long.class).list();
        if (failed.isEmpty()) {
            return;
        }
        try (Connection connection = dwh.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "delete from raw.rows where load_id = any (?)")) {
            statement.setArray(1, connection.createArrayOf("bigint", failed.toArray(new Long[0])));
            int removed = statement.executeUpdate();
            log.info("load_cleanup loads={} rows_removed={}", failed.size(), removed);
        } catch (SQLException failure) {
            throw new DwhUnavailableException(failure);
        }
    }
}
