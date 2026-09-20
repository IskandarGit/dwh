package com.greenwhite.dwh.instance.support.fixtures;

import org.springframework.beans.factory.annotation.Qualifier;

import javax.sql.DataSource;

/** Фикстура-нарушитель AC-5: квалификатор {@code "dwh"} вне пакета fnd. Не бин (нет @Component). */
@SuppressWarnings("unused")
public class DwhQualifierViolator {

    @Qualifier("dwh")
    private DataSource leaked;

    public DwhQualifierViolator(@Qualifier("dwh") DataSource viaConstructor) {
        this.leaked = viaConstructor;
    }
}
