package com.greenwhite.dwh.instance.fnd.error;

/**
 * Нарушение ограничения БД или правила основы, переведённое в код (02 п.16; AC-9б).
 * Код — единственный контракт для вызывающего; SQL-текст доступен только как причина.
 */
public class ConstraintViolationException extends RuntimeException {

    private final ConstraintErrorCode code;

    public ConstraintViolationException(ConstraintErrorCode code, Throwable cause) {
        super(code.code(), cause);
        this.code = code;
    }

    public ConstraintViolationException(ConstraintErrorCode code) {
        super(code.code());
        this.code = code;
    }

    public ConstraintErrorCode code() {
        return code;
    }
}
