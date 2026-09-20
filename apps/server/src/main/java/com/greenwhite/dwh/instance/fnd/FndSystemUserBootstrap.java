package com.greenwhite.dwh.instance.fnd;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Создаёт техническую учётку {@code system} при запуске приложения. Порядок 20 — строго после
 * {@code InstanceBootstrap} каркаса (порядок 10): тот создаёт первого администратора только при
 * пустой {@code md_users}, поэтому учётка основы не должна появиться раньше него.
 */
@Component
@Profile("!migrate")
@Order(20)
public class FndSystemUserBootstrap implements ApplicationRunner {

    private final FndActors actors;

    public FndSystemUserBootstrap(FndActors actors) {
        this.actors = actors;
    }

    @Override
    public void run(ApplicationArguments args) {
        actors.ensureSystem();
    }
}
