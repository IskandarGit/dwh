package com.greenwhite.dwh.instance.fnd;

/**
 * Кто выполняет операцию основы (02 п.13; AC-32, доп.12): {@code userId} — запись {@code md_users},
 * которую видит аудит каркаса в {@code app.user_id}; {@code name} — то, что попадает в наши журналы
 * ({@code fnd_loads.applied_by}, {@code fnd_load_log.actor}): id как текст либо {@code system} для заданий.
 */
public record FndActor(long userId, String name) {

    public FndActor {
        if (userId <= 0) {
            throw new IllegalArgumentException("userId должен быть положительным id из md_users");
        }
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("name актора не задан");
        }
    }

    /** Пользователь: в журналах — его id как текст. */
    public static FndActor user(long userId) {
        return new FndActor(userId, String.valueOf(userId));
    }
}
