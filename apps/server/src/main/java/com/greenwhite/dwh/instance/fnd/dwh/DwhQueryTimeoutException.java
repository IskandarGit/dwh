package com.greenwhite.dwh.instance.fnd.dwh;

/** Запрос ко второй базе прерван по лимиту времени (statement_timeout). */
public class DwhQueryTimeoutException extends RuntimeException {

    public DwhQueryTimeoutException(Throwable cause) {
        super("Запрос ко второй базе прерван по времени", cause);
    }
}
