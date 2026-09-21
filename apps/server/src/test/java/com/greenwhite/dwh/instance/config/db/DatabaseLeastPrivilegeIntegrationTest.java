package com.greenwhite.dwh.instance.config.db;

import com.greenwhite.dwh.instance.audit.repository.AuditPartitionRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.time.YearMonth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * I-02 / Finding S-02 / CWE-250 / ADR-0008:
 * РџСЂРѕРІРµСЂРєР° РЅР°РёРјРµРЅСЊС€РёС… РїСЂРёРІРёР»РµРіРёР№ Р±Р°Р·С‹ РґР°РЅРЅС‹С… (Database Least Privilege).
 */
@Testcontainers
class DatabaseLeastPrivilegeIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("smartupcms")
            .withUsername("postgres_admin")
            .withPassword("admin_secret");

    static DataSource adminDataSource;
    static DataSource migratorDataSource;
    static DataSource appDataSource;
    static DataSource backupDataSource;

    static JdbcClient adminJdbc;
    static JdbcClient migratorJdbc;
    static JdbcClient appJdbc;
    static JdbcClient backupJdbc;

    static final String MIGRATOR_USER = "smartupcms_migrator";
    static final String MIGRATOR_PASS = "migrator_secret";
    static final String APP_USER = "smartupcms";
    static final String APP_PASS = "app_secret";
    static final String BACKUP_USER = "smartupcms_backup";
    static final String BACKUP_PASS = "backup_secret";

    @BeforeAll
    static void setupRolesAndMigrations() {
        adminDataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        adminJdbc = JdbcClient.create(adminDataSource);

        // 1. РЎРѕР·РґР°РЅРёРµ СЂРѕР»РµР№ Рё СЂР°СЃС€РёСЂРµРЅРёР№ РѕС‚ РёРјРµРЅРё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР° (postgres_admin)
        bootstrapRoles(adminJdbc);

        migratorDataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), MIGRATOR_USER, MIGRATOR_PASS);
        migratorJdbc = JdbcClient.create(migratorDataSource);

        // 2. РџСЂРёРјРµРЅРµРЅРёРµ РјРёРіСЂР°С†РёР№ РѕС‚ РёРјРµРЅРё smartupcms_migrator (schema owner)
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(migratorDataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        // 3. РќР°СЃС‚СЂРѕР№РєР° РіСЂР°РЅСѓР»СЏСЂРЅС‹С… РїСЂР°РІ РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ С‚Р°Р±Р»РёС†
        grantPrivileges(adminJdbc);

        appDataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), APP_USER, APP_PASS);
        appJdbc = JdbcClient.create(appDataSource);

        backupDataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), BACKUP_USER, BACKUP_PASS);
        backupJdbc = JdbcClient.create(backupDataSource);
    }

    private static void bootstrapRoles(JdbcClient admin) {
        // Р Р°СЃС€РёСЂРµРЅРёСЏ СЃРѕР·РґР°СЋС‚СЃСЏ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј
        admin.sql("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\"").update();
        admin.sql("CREATE EXTENSION IF NOT EXISTS \"pg_trgm\"").update();
        admin.sql("CREATE EXTENSION IF NOT EXISTS \"fuzzystrmatch\"").update();

        // Р РѕР»СЊ РјРёРіСЂР°С‚РѕСЂР°
        admin.sql("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartupcms_migrator') THEN
                    CREATE ROLE smartupcms_migrator LOGIN PASSWORD 'migrator_secret'
                        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
                END IF;
            END $$;
            """).update();

        // Р РѕР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ
        admin.sql("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartupcms') THEN
                    CREATE ROLE smartupcms LOGIN PASSWORD 'app_secret'
                        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
                END IF;
            END $$;
            """).update();

        // Р РѕР»СЊ СЂРµР·РµСЂРІРЅРѕРіРѕ РєРѕРїРёСЂРѕРІР°РЅРёСЏ
        admin.sql("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartupcms_backup') THEN
                    CREATE ROLE smartupcms_backup LOGIN PASSWORD 'backup_secret'
                        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
                END IF;
            END $$;
            """).update();

        // РџСЂР°РІР° РЅР° Р‘Р” Рё РІР»Р°РґРµРЅРёРµ СЃС…РµРјРѕР№ public РїРµСЂРµРґР°С‘С‚СЃСЏ РјРёРіСЂР°С‚РѕСЂСѓ
        admin.sql("GRANT CONNECT, CREATE ON DATABASE smartupcms TO smartupcms_migrator").update();
        admin.sql("ALTER SCHEMA public OWNER TO smartupcms_migrator").update();
        admin.sql("GRANT ALL ON SCHEMA public TO smartupcms_migrator").update();

        // Р”РµС„РѕР»С‚РЅС‹Рµ РїСЂР°РІР° РґР»СЏ РѕР±СЉРµРєС‚РѕРІ, РєРѕС‚РѕСЂС‹Рµ Р±СѓРґРµС‚ СЃРѕР·РґР°РІР°С‚СЊ РјРёРіСЂР°С‚РѕСЂ
        admin.sql("""
            ALTER DEFAULT PRIVILEGES FOR ROLE smartupcms_migrator IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smartupcms;
            ALTER DEFAULT PRIVILEGES FOR ROLE smartupcms_migrator IN SCHEMA public
                GRANT USAGE, SELECT ON SEQUENCES TO smartupcms;
            ALTER DEFAULT PRIVILEGES FOR ROLE smartupcms_migrator IN SCHEMA public
                REVOKE TRUNCATE ON TABLES FROM smartupcms;

            ALTER DEFAULT PRIVILEGES FOR ROLE smartupcms_migrator IN SCHEMA public
                GRANT SELECT ON TABLES TO smartupcms_backup;
            ALTER DEFAULT PRIVILEGES FOR ROLE smartupcms_migrator IN SCHEMA public
                GRANT SELECT ON SEQUENCES TO smartupcms_backup;
            """).update();
    }

    private static void grantPrivileges(JdbcClient admin) {
        admin.sql("""
            GRANT CONNECT ON DATABASE smartupcms TO smartupcms;
            GRANT USAGE ON SCHEMA public TO smartupcms;
            REVOKE CREATE ON SCHEMA public FROM smartupcms;

            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smartupcms;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO smartupcms;

            -- РЇРІРЅС‹Р№ РѕС‚Р·С‹РІ РѕРїР°СЃРЅС‹С… РїСЂРёРІРёР»РµРіРёР№
            REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM smartupcms;
            REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, audit_log_default FROM smartupcms;

            -- Р РµР·РµСЂРІРЅРѕРµ РєРѕРїРёСЂРѕРІР°РЅРёРµ
            GRANT CONNECT ON DATABASE smartupcms TO smartupcms_backup;
            GRANT USAGE ON SCHEMA public TO smartupcms_backup;
            REVOKE CREATE ON SCHEMA public FROM smartupcms_backup;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO smartupcms_backup;
            GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO smartupcms_backup;
            ALTER ROLE smartupcms_backup SET default_transaction_read_only = on;
            """).update();
    }

    @Nested
    @DisplayName("Runtime Application User (smartupcms) Least Privilege")
    class AppUserPrivileges {

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ СЃСѓРїРµСЂРїРѕР»СЊР·РѕРІР°С‚РµР»СЊ Рё РЅРµ РјРѕР¶РµС‚ СЃРѕР·РґР°РІР°С‚СЊ СЂРѕР»Рё РёР»Рё Р±Р°Р·С‹")
        void appUserIsNotSuperuser() {
            var roleInfo = appJdbc.sql("""
                    select rolsuper, rolcreatedb, rolcreaterole
                    from pg_roles where rolname = 'smartupcms'
                    """)
                    .query((rs, rowNum) -> new boolean[]{
                            rs.getBoolean("rolsuper"),
                            rs.getBoolean("rolcreatedb"),
                            rs.getBoolean("rolcreaterole")
                    })
                    .single();

            assertThat(roleInfo[0]).as("rolsuper must be false").isFalse();
            assertThat(roleInfo[1]).as("rolcreatedb must be false").isFalse();
            assertThat(roleInfo[2]).as("rolcreaterole must be false").isFalse();
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ РјРѕР¶РµС‚ СЃРѕР·РґР°РІР°С‚СЊ С‚Р°Р±Р»РёС†С‹ (DDL CREATE TABLE Р·Р°РїСЂРµС‰РµРЅ)")
        void appUserCannotCreateTable() {
            assertThatThrownBy(() -> appJdbc.sql("create table probe_least_privilege(id int)").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("permission denied for schema public");
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ РјРѕР¶РµС‚ СѓРґР°Р»СЏС‚СЊ С‚Р°Р±Р»РёС†С‹ (DDL DROP TABLE Р·Р°РїСЂРµС‰РµРЅ)")
        void appUserCannotDropTable() {
            assertThatThrownBy(() -> appJdbc.sql("drop table md_users").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("must be owner of table md_users");
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ РјРѕР¶РµС‚ РјРµРЅСЏС‚СЊ СЃС‚СЂСѓРєС‚СѓСЂСѓ С‚Р°Р±Р»РёС† (DDL ALTER TABLE Р·Р°РїСЂРµС‰РµРЅ)")
        void appUserCannotAlterTable() {
            assertThatThrownBy(() -> appJdbc.sql("alter table md_users add column attacker_probe text").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("must be owner of table md_users");
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ РјРѕР¶РµС‚ РѕС‡РёС‰Р°С‚СЊ С‚Р°Р±Р»РёС†С‹ С‡РµСЂРµР· TRUNCATE")
        void appUserCannotTruncateTables() {
            assertThatThrownBy(() -> appJdbc.sql("truncate table md_users").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("permission denied for table md_users");

            assertThatThrownBy(() -> appJdbc.sql("truncate table audit_log").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("permission denied for table audit_log");
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РЅРµ РјРѕР¶РµС‚ РѕС‚РєР»СЋС‡РёС‚СЊ С‚СЂРёРіРіРµСЂС‹ РЅРµРёР·РјРµРЅСЏРµРјРѕСЃС‚Рё audit_log")
        void appUserCannotDisableTriggers() {
            assertThatThrownBy(() -> appJdbc.sql("alter table audit_log disable trigger all").update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("must be owner of table audit_log");
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїСЂРёР»РѕР¶РµРЅРёСЏ РјРѕР¶РµС‚ РІС‹РїРѕР»РЅСЏС‚СЊ РѕР±С‹С‡РЅС‹Р№ DML (SELECT, INSERT, UPDATE, DELETE)")
        void appUserCanPerformStandardDml() {
            long userCount = appJdbc.sql("select count(*) from md_users").query(Long.class).single();
            assertThat(userCount).isGreaterThanOrEqualTo(0);

            // INSERT РІ audit_log СЂР°Р·СЂРµС€РµРЅ
            appJdbc.sql("""
                    insert into audit_log (table_name, row_pk, event, changed_at)
                    values ('least_privilege_test', '1', 'I', now())
                    """).update();

            long auditCount = appJdbc.sql("select count(*) from audit_log where table_name = 'least_privilege_test'")
                    .query(Long.class).single();
            assertThat(auditCount).isEqualTo(1);
        }

        @Test
        @DisplayName("AuditPartitionRepository СЃРѕР·РґР°РµС‚ Рё РѕС‚С†РµРїР»СЏРµС‚ РїР°СЂС‚РёС†РёРё Р±РµР· DDL-РїСЂР°РІ РїСЂРёР»РѕР¶РµРЅРёСЏ")
        void auditPartitionWorkerCanManagePartitionsViaSecurityDefiner() {
            var repo = new AuditPartitionRepository(appJdbc);

            // РЎРѕР·РґР°РЅРёРµ РїР°СЂС‚РёС†РёРё Р·Р° Р±СѓРґСѓС‰РёР№ РјРµСЃСЏС†
            YearMonth targetMonth = YearMonth.of(2028, 8);
            assertThat(repo.exists(targetMonth)).isFalse();
            repo.create(targetMonth);
            assertThat(repo.exists(targetMonth)).isTrue();

            // Р—Р°РїРёСЃСЊ РІ СЃРѕР·РґР°РЅРЅСѓСЋ РїР°СЂС‚РёС†РёСЋ
            appJdbc.sql("""
                    insert into audit_log (table_name, row_pk, event, changed_at)
                    values ('future_partition_test', '100', 'I', timestamptz '2028-08-10 10:00:00+00')
                    """).update();

            // РћС‚С†РµРїР»РµРЅРёРµ РїР°СЂС‚РёС†РёРё
            String archived = repo.detachAndArchive(targetMonth);
            assertThat(archived).isEqualTo("audit_log_archived_2028_08");

            // Р—Р°РїРёСЃСЊ СЃРѕС…СЂР°РЅРµРЅР° РІ Р°СЂС…РёРІРЅРѕР№ С‚Р°Р±Р»РёС†Рµ
            long archivedCount = appJdbc.sql("select count(*) from audit_log_archived_2028_08 where table_name = 'future_partition_test'")
                    .query(Long.class).single();
            assertThat(archivedCount).isEqualTo(1);
        }

        @Test
        @DisplayName("SchemaVersionGate СѓСЃРїРµС€РЅРѕ РїСЂРѕС…РѕРґРёС‚ РїСЂРѕРІРµСЂРєСѓ СЃС…РµРјС‹ РїРѕРґ РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј РїСЂРёР»РѕР¶РµРЅРёСЏ")
        void schemaVersionGatePassesForAppUser() {
            var gate = new SchemaVersionGate(appDataSource, true);
            gate.verifySchemaMatchesApplication();
        }
    }

    @Nested
    @DisplayName("Backup User (smartupcms_backup) Read-Only Privilege")
    class BackupUserPrivileges {

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р±СЌРєР°РїР° РјРѕР¶РµС‚ С‡РёС‚Р°С‚СЊ РІСЃРµ С‚Р°Р±Р»РёС†С‹")
        void backupUserCanReadTables() {
            long count = backupJdbc.sql("select count(*) from md_users").query(Long.class).single();
            assertThat(count).isGreaterThanOrEqualTo(0);
        }

        @Test
        @DisplayName("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ Р±СЌРєР°РїР° РЅРµ РјРѕР¶РµС‚ РІС‹РїРѕР»РЅСЏС‚СЊ РѕРїРµСЂР°С†РёРё Р·Р°РїРёСЃРё")
        void backupUserCannotWrite() {
            assertThatThrownBy(() -> backupJdbc.sql("""
                    insert into audit_log (table_name, row_pk, event, changed_at)
                    values ('backup_write_probe', '1', 'I', now())
                    """).update())
                    .isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("read-only transaction");
        }
    }
}
