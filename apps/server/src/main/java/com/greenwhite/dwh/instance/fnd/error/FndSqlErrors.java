package com.greenwhite.dwh.instance.fnd.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;

import java.sql.SQLException;
import java.util.Optional;

/**
 * Перевод ошибок PostgreSQL в {@link ConstraintViolationException} (AC-9б): по имени ограничения
 * ({@code SQLException.getMessage()} содержит его; у драйвера PostgreSQL — {@code ServerErrorMessage.getConstraint()})
 * или по тексту {@code raise exception '<код>'} триггеров основы. Неопознанная ошибка возвращается как есть.
 */
public final class FndSqlErrors {

    private static final Logger log = LoggerFactory.getLogger(FndSqlErrors.class);

    private FndSqlErrors() {
    }

    /** Выполняет действие; ошибку БД с известным кодом переводит в исключение с кодом. */
    public static <T> T translating(SqlAction<T> action) {
        try {
            return action.run();
        } catch (DataAccessException e) {
            throw translate(e);
        }
    }

    public static RuntimeException translate(DataAccessException e) {
        SQLException sql = sqlCause(e);
        if (sql == null) {
            return e;
        }
        Optional<ConstraintErrorCode> code = constraintName(sql).flatMap(ConstraintErrorCode::byConstraintName)
                .or(() -> ConstraintErrorCode.byMessage(sql.getMessage()));
        if (code.isEmpty()) {
            return e;
        }
        log.warn("constraint_violation code={} sqlState={}", code.get().code(), sql.getSQLState());
        if (code.get() == ConstraintErrorCode.STALE_VERSION) {
            return new StaleVersionException();
        }
        return new ConstraintViolationException(code.get(), e);
    }

    private static Optional<String> constraintName(SQLException sql) {
        if (sql instanceof org.postgresql.util.PSQLException pg && pg.getServerErrorMessage() != null) {
            return Optional.ofNullable(pg.getServerErrorMessage().getConstraint());
        }
        return Optional.empty();
    }

    private static SQLException sqlCause(Throwable t) {
        while (t != null) {
            if (t instanceof SQLException s) {
                return s;
            }
            t = t.getCause();
        }
        return null;
    }

    @FunctionalInterface
    public interface SqlAction<T> {
        T run();
    }
}
