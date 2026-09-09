package com.greenwhite.dwh.instance.upl.fixtures;

/** Фикстура AC-37: класс «прикладного модуля» upl, от которого основе зависеть нельзя. В контекст не сканируется. */
public final class UplModuleFixture {

    private UplModuleFixture() {
    }

    public static String name() {
        return "upl";
    }
}
