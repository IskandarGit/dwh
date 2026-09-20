package com.greenwhite.dwh.instance.db;

import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.config.db.SchemaVersionGate;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.*;

@Testcontainers
class AuthenticationGenerationMigrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine");

    @Test
    void upgradePreservesHistoryAndValidityAndRepeatIsSafe() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(ds)
                .locations("classpath:db/migration").target("024").load().migrate();
        var jdbc = JdbcClient.create(ds);
        long user = jdbc.sql("insert into md_users(name,login,email) values ('Preserved','migration','migration@example.test') returning id")
                .query(Long.class).single();
        jdbc.sql("insert into md_settings(user_id,key,value) values (:id,'migration_probe','preserved')").param("id", user).update();
        jdbc.sql("insert into ms_task_projects(name,description,created_by) values ('Preserved project','Business description',:id)").param("id",user).update();
        jdbc.sql("insert into ms_tasks(title,reporter_id,status_id) select 'Preserved task',:id,id from ms_task_statuses where pcode='new'").param("id",user).update();
        jdbc.sql("insert into audit_log(table_name,row_pk,event,changed_by,new_row) values ('md_users',:pk,'I',:id,'{\"name\":\"Preserved\"}'::jsonb)")
                .param("pk",Long.toString(user)).param("id",user).update();
        jdbc.sql("insert into security_events(user_id,event_type,ip,details) values (:id,'PASSWORD_CHANGED','127.0.0.1','{}'::jsonb)").param("id", user).update();
        jdbc.sql("""
                insert into kauth_sessions(user_id,token_hash,ip,user_agent,closed_at)
                select :id, 'migration-session-' || n, '127.0.0.1', 'test', case when n=1 then now() end
                from generate_series(0,1) n
                """).param("id", user).update();
        jdbc.sql("""
                insert into kauth_api_tokens(user_id,name,token_prefix,token_hash,expires_at,revoked_at)
                select :id,'test','test','migration-api-' || n,
                       now() + case when n=2 then interval '-1 day' else interval '1 day' end,
                       case when n=1 then now() end from generate_series(0,2) n
                """).param("id", user).update();
        jdbc.sql("""
                insert into kauth_otp_codes(user_id,channel,code_hash,otp_token_hash,purpose,expires_at,is_used)
                select :id,'telegram','synthetic', 'migration-otp-' || p || n,p,
                       now() + case when n=2 then interval '-1 day' else interval '1 day' end,n=1
                from unnest(array['login','channel_verify']) p cross join generate_series(0,2) n
                """).param("id", user).update();
        var tables = List.of("md_users", "md_settings", "ms_task_projects", "ms_tasks", "audit_log", "security_events", "kauth_sessions", "kauth_api_tokens", "kauth_otp_codes");
        var before = tables.stream().map(t -> snapshot(jdbc,t)).toList();
        assertThatThrownBy(() -> new SchemaVersionGate(ds,true).verifySchemaMatchesApplication()).isInstanceOf(IllegalStateException.class);
        var flyway = FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(ds).locations("classpath:db/migration").load();
        flyway.migrate();
        for (String table : List.of("md_users", "kauth_sessions", "kauth_api_tokens", "kauth_otp_codes")) {
            assertThat(jdbc.sql("select count(*) from " + table + " where auth_version <> 0").query(Long.class).single()).isZero();
            assertThatThrownBy(() -> jdbc.sql("update " + table + " set auth_version=-1").update())
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        }
        assertThat(tables.stream().map(t -> snapshot(jdbc,t)).toList()).isEqualTo(before);
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        new SchemaVersionGate(ds,true).verifySchemaMatchesApplication();
    }

    @Test
    void emptyDatabaseMigratesLatestAndBecomesReady() {
        try (var empty = new PostgreSQLContainer<>("postgres:18-alpine")) {
            empty.start();
            var ds = new DriverManagerDataSource(empty.getJdbcUrl(),empty.getUsername(),empty.getPassword());
            assertThat(FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(ds).locations("classpath:db/migration").load().migrate().success).isTrue();
            new SchemaVersionGate(ds,true).verifySchemaMatchesApplication();
        }
    }

    private static List<String> snapshot(JdbcClient jdbc, String table) {
        return jdbc.sql("select (to_jsonb(t) - 'auth_version' - 'revision')::text from " + table + " t order by id").query(String.class).list();
    }
}
