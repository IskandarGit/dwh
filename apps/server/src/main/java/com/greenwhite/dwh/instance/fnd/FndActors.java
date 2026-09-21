package com.greenwhite.dwh.instance.fnd;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Акторы основы и их установка в сессию БД. Аудит каркаса ({@code fnd_audit_trigger}) требует числовой
 * {@code app.user_id} при любом изменении fnd-таблиц, поэтому каждый сервис основы первым делом
 * вызывает {@link #apply(FndActor)} внутри своей транзакции (AC-6, AC-32).
 */
@Component
public class FndActors {

    private static final String SYSTEM_NAME = "System (DW jobs)";
    private static final String SYSTEM_EMAIL = "system@localhost";

    private final JdbcClient jdbc;
    private volatile Long systemUserId;

    public FndActors(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Техническая учётка заданий и сидов: в журналах основы — {@code system}. Создаётся кодом
     * при запуске ({@link FndSystemUserBootstrap}) или при первом обращении — миграции
     * пользователей не создают.
     */
    public FndActor system() {
        Long id = systemUserId;
        if (id == null) {
            id = findUserId(jdbc, FndPref.SYSTEM_ACTOR).orElseGet(this::createAfterInstanceBootstrap);
            systemUserId = id;
        }
        return new FndActor(id, FndPref.SYSTEM_ACTOR);
    }

    /**
     * Каркас создаёт первого администратора только при пустой {@code md_users}, поэтому до первичной
     * настройки экземпляра учётку основы создавать нельзя — иначе администратор не появится никогда.
     */
    private long createAfterInstanceBootstrap() {
        Long users = jdbc.sql("select count(*) from md_users").query(Long.class).single();
        if (users == 0) {
            throw new IllegalStateException("Учётка " + FndPref.SYSTEM_ACTOR
                    + " запрошена до первичной настройки экземпляра: в md_users нет ни одного пользователя");
        }
        return ensureSystemUser(jdbc);
    }

    /** Создаёт учётку при отсутствии; вызывать только после первичной настройки экземпляра (шаг запуска основы). */
    public FndActor ensureSystem() {
        systemUserId = ensureSystemUser(jdbc);
        return new FndActor(systemUserId, FndPref.SYSTEM_ACTOR);
    }

    /** Возвращает id технической учётки, создавая её при отсутствии (идемпотентно). */
    public static long ensureSystemUser(JdbcClient jdbc) {
        return ensureUser(jdbc, FndPref.SYSTEM_ACTOR, SYSTEM_NAME, SYSTEM_EMAIL);
    }

    /** Учётка без пароля в состоянии {@code P}: войти под ней нельзя. */
    static long ensureUser(JdbcClient jdbc, String login, String name, String email) {
        return findUserId(jdbc, login).orElseGet(() -> {
            jdbc.sql("""
                            insert into md_users (name, login, email, state, language, timezone)
                            values (:name, :login, :email, 'P', 'uz', 'UTC')
                            on conflict (login) do nothing
                            """)
                    .param("name", name).param("login", login).param("email", email)
                    .update();
            return findUserId(jdbc, login).orElseThrow(() -> new IllegalStateException(
                    "Учётка " + login + " не создана в md_users"));
        });
    }

    private static Optional<Long> findUserId(JdbcClient jdbc, String login) {
        return jdbc.sql("select id from md_users where login = :login")
                .param("login", login).query(Long.class).optional();
    }

    public FndActor user(long userId) {
        return FndActor.user(userId);
    }

    /**
     * Ставит {@code app.user_id} на текущую транзакцию (третий аргумент {@code true} — is_local),
     * поэтому вызывать только внутри {@code @Transactional}: иначе настройка потеряется вместе
     * с соединением и триггер аудита откажет кодом {@code audit_actor_missing}.
     */
    public void apply(FndActor actor) {
        jdbc.sql("select set_config('app.user_id', :id, true)")
                .param("id", String.valueOf(actor.userId()))
                .query(String.class).single();
    }
}
