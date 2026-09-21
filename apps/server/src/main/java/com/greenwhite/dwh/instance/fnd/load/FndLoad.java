package com.greenwhite.dwh.instance.fnd.load;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Версия загрузки (18 п.14): {@code id} и есть единый {@code load_id}, которым помечены строки
 * {@code raw} в pg-dwh и поколения кеша (11 п.6, п.10).
 */
public record FndLoad(long id,
                      String sourceCode,
                      UUID packageRef,
                      LocalDate periodFrom,
                      LocalDate periodTo,
                      String formatVersion,
                      Instant appliedAt,
                      String appliedBy,
                      Integer rowsTotal,
                      Integer rowsAccepted,
                      Integer rowsRejected,
                      String status,
                      Long supersededBy) {

    public static final String PENDING = "pending";
    public static final String APPLIED = "applied";
    public static final String FAILED = "failed";
    public static final String SUPERSEDED = "superseded";
}
