package com.greenwhite.dwh.instance.fnd.dwh;

import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** И15б: вторая база, миграция V004 — признак отклонённой строки raw.rows.rejected. */
class RawRowsRejectedColumnTest extends EmbeddedPostgresTest {

    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;

    @Test
    @DisplayName("И15б: у raw.rows есть признак rejected — boolean, обязательный, по умолчанию false")
    void rejectedColumnIsBooleanNotNullDefaultFalse() {
        List<Map<String, Object>> columns = dwhJdbc.sql("""
                        select data_type, is_nullable, column_default
                          from information_schema.columns
                         where table_schema = 'raw' and table_name = 'rows' and column_name = 'rejected'
                        """)
                .query().listOfRows();

        assertThat(columns).hasSize(1);
        Map<String, Object> column = columns.get(0);
        assertThat(column.get("data_type")).isEqualTo("boolean");
        assertThat(column.get("is_nullable")).isEqualTo("NO");
        assertThat(column.get("column_default")).isEqualTo("false");
    }
}
