package com.greenwhite.dwh.instance.ovw;

/** Коды ошибок обзора данных; текст даёт экран по ключу {@code ovw.err.<код>}. */
public final class OvwErrors {

    public static final String OVW_QUERY_INVALID = "OVW_QUERY_INVALID";
    public static final String OVW_SOURCE_NOT_FOUND = "OVW_SOURCE_NOT_FOUND";
    public static final String OVW_SHEET_UNKNOWN = "OVW_SHEET_UNKNOWN";
    public static final String OVW_COLUMN_UNKNOWN = "OVW_COLUMN_UNKNOWN";
    public static final String OVW_FILTER_OP = "OVW_FILTER_OP";
    public static final String OVW_FILTER_VALUE = "OVW_FILTER_VALUE";
    public static final String OVW_FILTER_TOO_MANY = "OVW_FILTER_TOO_MANY";
    public static final String OVW_PAGE_INVALID = "OVW_PAGE_INVALID";
    public static final String OVW_MODULE_DISABLED = "OVW_MODULE_DISABLED";
    public static final String OVW_QUERY_TIMEOUT = "OVW_QUERY_TIMEOUT";

    private OvwErrors() {
    }
}
