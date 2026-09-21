package com.greenwhite.dwh.instance.fnd.jobs;

import java.util.Map;

/**
 * Обработчик задания основы (02 п.15; 18 п.4). Расписание и очередь — таблицы {@code fnd_job_*};
 * планировщика Spring в основе нет: задания снимает {@link FndJobRunner}, которого вызывает
 * шаг поставки или воркер экземпляра.
 */
public interface FndJobHandler {

    /** Код обработчика, как он записан в {@code fnd_job_schedule.handler}. */
    String code();

    /** Выполняет задание; исключение помечает запуск неудачным и остаётся в {@code fnd_job_runs.error}. */
    void run(Map<String, Object> args);
}
