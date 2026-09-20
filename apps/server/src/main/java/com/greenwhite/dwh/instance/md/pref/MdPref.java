package com.greenwhite.dwh.instance.md.pref;

/**
 * Biruni/Smartup Master Data Preferences and Constants (MdPref).
 */
public final class MdPref {
    private MdPref() {}

    public static final String MODULE_CODE = "md";

    // System Role Pcodes
    public static final String ROLE_ADMIN = "admin";
    public static final String ROLE_MANAGER = "manager";
    public static final String ROLE_AUDITOR = "auditor";
    public static final String ROLE_USER = "user";

    // System States
    public static final String STATE_ACTIVE = "A";
    public static final String STATE_PASSIVE = "P";

    // Forms
    public static final String FORM_USERS = "iam.users";
    public static final String FORM_PROFILE = "iam.profile";
    public static final String FORM_ROLES = "rbac.roles";
    public static final String FORM_ASSIGNMENTS = "rbac.assignments";
    public static final String FORM_CUSTOM_FIELDS = "md.custom_fields";
    public static final String FORM_SETTINGS = "platform.settings";
    public static final String FORM_ORG_UNITS = "iam.org_units";
    public static final String FORM_NAVIGATION = "platform.navigation";
}
