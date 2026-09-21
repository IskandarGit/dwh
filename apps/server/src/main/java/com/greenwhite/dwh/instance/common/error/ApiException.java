package com.greenwhite.dwh.instance.common.error;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;

import java.util.List;

/**
 * Base domain exception holding a typed ErrorCode.
 */
public class ApiException extends RuntimeException {

    private final ErrorCode errorCode;
    private final List<FieldErrorItem> fieldErrors;

    public ApiException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.fieldErrors = null;
    }

    public ApiException(ErrorCode errorCode, String message, List<FieldErrorItem> fieldErrors) {
        super(message);
        this.errorCode = errorCode;
        this.fieldErrors = fieldErrors;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }

    public List<FieldErrorItem> getFieldErrors() {
        return fieldErrors;
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(ErrorCode.UNAUTHORIZED, message);
    }

    public static ApiException invalidCredentials() {
        return new ApiException(ErrorCode.INVALID_CREDENTIALS, "Неверный логин или пароль");
    }

    public static ApiException permissionDenied(String form, String action) {
        return new ApiException(ErrorCode.PERMISSION_DENIED, "Недостаточно прав для выполнения действия " + form + "." + action);
    }

    public static ApiException notFound(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException conflict(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException badRequest(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException forbidden(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    public static ApiException locked(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException rateLimited(String message) {
        return new ApiException(ErrorCode.RATE_LIMITED, message);
    }

    public static ApiException validation(String message, List<FieldErrorItem> errors) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, message, errors);
    }
}
