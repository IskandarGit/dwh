package com.greenwhite.dwh.instance.fnd;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Акторы основы и их установка в сессию БД. Аудит каркаса ({@code fnd_audit_trigger}) требует числовой
 * {@code app.user_id} при любом изменении fnd-таблиц, поэтому каждый сервис основы первым делом
 * вызывает {@link #apply(FndActor)} внутри своей транзакции (AC-6, AC-32).
 */
@Component
public class FndActors {

    private final JdbcClient jdbc;
    private volatile Long systemUserId;

    public FndActors(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Техническая учётка заданий и сидов (V101): в журналах основы — {@code system}. */
    public FndActor system() {
        Long id = systemUserId;
        if (id == null) {
            id = jdbc.sql("select id from md_users where login = :login")
                    .param("login", FndPref.SYSTEM_ACTOR)
                    .query(Long.class).optional()
                    .orElseThrow(() -> new IllegalStateException(
                            "Учётка " + FndPref.SYSTEM_ACTOR + " отсутствует — не применена миграция V101"));
            systemUserId = id;
        }
        return new FndActor(id, FndPref.SYSTEM_ACTOR);
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
