package com.greenwhite.dwh.core.error;

/**
 * Standard machine-readable error codes across DWH Platform according to TRD-04 Section 8.
 */
public enum ErrorCode {
    // 400 Bad Request
    BAD_REQUEST("bad_request", 400),
    RESET_CODE_INVALID("reset_code_invalid", 400),
    RESET_CODE_EXPIRED("reset_code_expired", 400),
    INVITE_INVALID("invite_invalid", 400),
    INVITE_EXPIRED("invite_expired", 400),
    FILE_CORRUPTED("file_corrupted", 400),
    CODE_ALREADY_EXISTS("code_already_exists", 400),
    INVALID_URL("invalid_url", 400),
    WEBHOOK_TARGET_UNREACHABLE("webhook_target_unreachable", 400),
    IDEMPOTENCY_KEY_INVALID("idempotency_key_invalid", 400),
    IDEMPOTENCY_NOT_SUPPORTED("idempotency_not_supported", 400),
    I18N_LANGUAGE_INVALID("i18n_language_invalid", 400),
    I18N_TRANSLATION_INVALID("i18n_translation_invalid", 400),

    // 401 Unauthorized
    UNAUTHORIZED("unauthorized", 401),
    INVALID_CREDENTIALS("invalid_credentials", 401),
    OTP_INVALID("otp_invalid", 401),
    OTP_EXPIRED("otp_expired", 401),
    SESSION_EXPIRED("session_expired", 401),
    SESSION_REVOKED("session_revoked", 401),
    TOKEN_REVOKED("token_revoked", 401),

    // 403 Forbidden
    FORBIDDEN("forbidden", 403),
    CSRF_TOKEN_INVALID("csrf_token_invalid", 403),
    PERMISSION_DENIED("permission_denied", 403),
    MUST_CHANGE_PASSWORD("must_change_password", 403),
    USER_BLOCKED("user_blocked", 403),
    SUPERADMIN_IMMUTABLE("superadmin_immutable", 403),
    LAST_ADMIN("last_admin", 409),
    LICENSE_READ_ONLY("license_read_only", 403),

    // 404 Not Found
    NOT_FOUND("not_found", 404),
    USER_NOT_FOUND("user_not_found", 404),
    ROLE_NOT_FOUND("role_not_found", 404),
    PROJECT_NOT_FOUND("project_not_found", 404),
    TASK_NOT_FOUND("task_not_found", 404),
    FILE_NOT_FOUND("file_not_found", 404),
    I18N_LANGUAGE_NOT_FOUND("i18n_language_not_found", 404),

    // 405 Method Not Allowed
    METHOD_NOT_ALLOWED("method_not_allowed", 405),

    // 409 Conflict
    CONFLICT("conflict", 409),
    OTP_CHANNEL_MISSING("otp_channel_missing", 409),
    STATUS_TRANSITION_FORBIDDEN("status_transition_forbidden", 409),
    TASK_PARENT_CYCLE("task_parent_cycle", 409),
    SINGLE_RESPONSIBLE_VIOLATION("single_responsible_violation", 409),
    FIELD_IN_USE("field_in_use", 409),
    IDEMPOTENCY_KEY_PAYLOAD_MISMATCH("idempotency_key_payload_mismatch", 409),
    IDEMPOTENCY_REQUEST_IN_PROGRESS("idempotency_request_in_progress", 409),
    I18N_LANGUAGE_EXISTS("i18n_language_exists", 409),
    I18N_REVISION_CONFLICT("i18n_revision_conflict", 409),
    TASK_REVISION_CONFLICT("task_revision_conflict", 409),


    // 413 Payload Too Large & 415 Unsupported Media Type
    PAYLOAD_TOO_LARGE("payload_too_large", 413),
    FILE_SIZE_EXCEEDED("file_size_exceeded", 413),
    FILE_TYPE_FORBIDDEN("file_type_forbidden", 415),
    STORAGE_QUOTA_EXCEEDED("storage_quota_exceeded", 413),
    USER_STORAGE_QUOTA_EXCEEDED("user_storage_quota_exceeded", 413),


    // 422 Unprocessable Entity
    VALIDATION_FAILED("validation_failed", 422),
    PASSWORD_POLICY("password_policy", 422),
    EMPTY_QUERY("empty_query", 422),
    FILE_MALWARE_DETECTED("file_malware_detected", 422),

    // 423 Locked
    LOGIN_LOCKED("login_locked", 423),
    OTP_ATTEMPTS_EXCEEDED("otp_attempts_exceeded", 423),

    // 429 Too Many Requests
    RATE_LIMITED("rate_limited", 429),
    OTP_RATE_LIMITED("otp_rate_limited", 429),

    // 500 Internal Error
    INTERNAL_ERROR("internal_error", 500),
    SERVICE_UNAVAILABLE("service_unavailable", 503),
    FILE_SCAN_FAILED("file_scan_failed", 503),
    OTP_SEND_FAILED("otp_send_failed", 503);

    private final String code;
    private final int defaultStatus;

    ErrorCode(String code, int defaultStatus) {
        this.code = code;
        this.defaultStatus = defaultStatus;
    }

    public String getCode() {
        return code;
    }

    public int getDefaultStatus() {
        return defaultStatus;
    }
}
