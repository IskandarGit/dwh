package com.greenwhite.dwh.instance.fnd.fixtures;

import org.springframework.scheduling.annotation.Scheduled;

/** Фикстура-нарушитель AC-7: планировщик Spring в пакете fnd. Правило обязано его отвергнуть. */
public final class FndScheduledViolator {

    private FndScheduledViolator() {
    }

    @Scheduled(fixedDelay = 60_000)
    public static void tick() {
    }
}
