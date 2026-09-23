package com.greenwhite.dwh.instance.upl;

/** Константы модуля upl (анкеты файлов). */
public final class UplPref {

    public static final String FORM_SOURCES = "upl.sources";
    public static final String FORM_PACKAGES = "upl.packages";
    public static final String ACTION_VIEW = "view";
    public static final String ACTION_CREATE = "create";
    public static final String ACTION_EDIT = "edit";
    public static final String ACTION_PUBLISH = "publish";
    public static final String ACTION_UPLOAD = "upload";
    public static final String ACTION_APPLY = "apply";
    public static final String TABLE_FORMAT_VERSIONS = "upl_format_versions";

    /** Код обработчика задания «разобрать файл пакета» в очереди основы. */
    public static final String JOB_PARSE = "upl.parse";

    private UplPref() {
    }
}
