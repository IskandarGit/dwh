package com.greenwhite.dwh.instance.fnd;

import com.greenwhite.dwh.instance.fnd.migration.FndMigrator;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.support.TestDatabases;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Техническая учётка {@code system} создаётся кодом основы, а не миграцией: после миграций
 * на свежей базе {@code md_users} пуста (пользователей заводит только первичная настройка).
 */
class FndSystemUserTest extends EmbeddedPostgresTest {

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private FndActors actors;

    @Test
    void migrationsCreateNoUsers() {
        TestDatabases.createDatabase("fnd_no_user_seed");
        FndMigrator.migrateOltp(TestDatabases.database("fnd_no_user_seed"));

        JdbcClient fresh = JdbcClient.create(TestDatabases.database("fnd_no_user_seed"));
        Long users = fresh.sql("select count(*) from md_users").query(Long.class).single();

        assertThat(users).isZero();
    }

    @Test
    void lazyPathRefusesOnEmptyUsers() {
        TestDatabases.createDatabase("fnd_no_user_seed");
        FndMigrator.migrateOltp(TestDatabases.database("fnd_no_user_seed"));

        JdbcClient fresh = JdbcClient.create(TestDatabases.database("fnd_no_user_seed"));
        FndActors freshActors = new FndActors(fresh);

        assertThatThrownBy(freshActors::system)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("первичной настройки");
        assertThat(fresh.sql("select count(*) from md_users").query(Long.class).single()).isZero();
    }

    @Test
    void ensureUserCreatesOnceAndIsIdempotent() {
        String login = "system-test-" + UUID.randomUUID().toString().substring(0, 8);
        try {
            long first = FndActors.ensureUser(jdbc, login, "TEST system", login + "@localhost");
            long second = FndActors.ensureUser(jdbc, login, "TEST system", login + "@localhost");

            assertThat(second).isEqualTo(first);
            assertThat(jdbc.sql("select count(*) from md_users where login = :login")
                    .param("login", login).query(Long.class).single()).isEqualTo(1L);
            assertThat(jdbc.sql("select state from md_users where login = :login")
                    .param("login", login).query(String.class).single()).isEqualTo("P");
            assertThat(jdbc.sql("select password_hash is null from md_users where login = :login")
                    .param("login", login).query(Boolean.class).single()).isTrue();
        } finally {
            jdbc.sql("delete from md_users where login = :login").param("login", login).update();
        }
    }

    @Test
    void systemActorResolvesToSystemLogin() {
        long expected = jdbc.sql("select id from md_users where login = :login")
                .param("login", FndPref.SYSTEM_ACTOR).query(Long.class).single();

        assertThat(actors.system().userId()).isEqualTo(expected);
        assertThat(actors.system().userId()).isEqualTo(expected);
    }
}
