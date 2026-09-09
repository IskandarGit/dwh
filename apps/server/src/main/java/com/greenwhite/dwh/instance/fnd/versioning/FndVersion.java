package com.greenwhite.dwh.instance.fnd.versioning;

import java.time.Instant;
import java.time.LocalDate;

/** Строка таблицы версий в стандарте основы (02 п.17; AC-10). */
public record FndVersion(long headerId,
                         int version,
                         LocalDate validFrom,
                         LocalDate validTo,
                         String status,
                         Instant publishedAt,
                         String publishedBy,
                         int lockVersion) {

    public static final String DRAFT = "draft";
    public static final String PUBLISHED = "published";
    public static final String SUPERSEDED = "superseded";
}
