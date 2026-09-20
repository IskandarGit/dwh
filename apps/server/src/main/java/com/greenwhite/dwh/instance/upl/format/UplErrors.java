package com.greenwhite.dwh.instance.upl.format;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.StaleVersionException;
import org.springframework.dao.DataAccessException;

/** Перевод ошибок основы и БД в ответ API по таблице «Ошибки» контракта анкеты файла. */
public final class UplErrors {

    private static final String NOT_DRAFT_DB_ERROR = "upl_format_not_draft";

    private UplErrors() {
    }

    /** Знакомую ошибку переводит в {@link ApiException}; незнакомую возвращает тем же объектом. */
    public static RuntimeException toApi(RuntimeException e) {
        if (e instanceof StaleVersionException) {
            return ApiException.conflict(ErrorCode.CONFLICT, UplSourceService.STALE_VERSION);
        }
        if (e instanceof ConstraintViolationException cve) {
            return fromConstraint(cve);
        }
        if (e instanceof DataAccessException && chainContains(e, NOT_DRAFT_DB_ERROR)) {
            return ApiException.conflict(ErrorCode.CONFLICT, UplSourceService.UPL_FORMAT_NOT_DRAFT);
        }
        return e;
    }

    static boolean chainContains(Throwable e, String text) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(text)) {
                return true;
            }
        }
        return false;
    }

    private static RuntimeException fromConstraint(ConstraintViolationException e) {
        ConstraintErrorCode code = e.code();
        if (code == ConstraintErrorCode.FND_VERSION_DRAFT_EXISTS
                || code == ConstraintErrorCode.FND_VERSION_CONFLICT) {
            return ApiException.conflict(ErrorCode.CONFLICT, UplSourceService.FND_VERSION_DRAFT_EXISTS);
        }
        if (code == ConstraintErrorCode.FND_VERSION_NOT_AFTER_PREVIOUS) {
            return ApiException.conflict(ErrorCode.CONFLICT, UplSourceService.FND_VERSION_NOT_AFTER_PREVIOUS);
        }
        if (code == ConstraintErrorCode.FND_VERSION_UNKNOWN) {
            return ApiException.notFound(ErrorCode.NOT_FOUND, UplSourceService.FND_VERSION_UNKNOWN);
        }
        return e;
    }
}
