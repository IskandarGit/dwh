package com.greenwhite.dwh.instance.fnd.fixtures;

import com.greenwhite.dwh.instance.upl.fixtures.UplModuleFixture;

/** Фикстура-нарушитель AC-37: класс в пакете fnd, зависящий от прикладного модуля. Правило обязано его отвергнуть. */
public final class FndDependsOnUplViolator {

    private FndDependsOnUplViolator() {
    }

    public static String module() {
        return UplModuleFixture.name();
    }
}
