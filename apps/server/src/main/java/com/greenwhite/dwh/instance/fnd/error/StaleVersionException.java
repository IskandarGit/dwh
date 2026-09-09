package com.greenwhite.dwh.instance.fnd.error;

/** Оптимистическая блокировка: строка изменена другим клиентом (02 п.12; AC-16). Код — {@code stale_version}. */
public class StaleVersionException extends ConstraintViolationException {

    public StaleVersionException() {
        super(ConstraintErrorCode.STALE_VERSION);
    }
}
