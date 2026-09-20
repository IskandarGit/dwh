package com.greenwhite.dwh.instance.fnd.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import javax.sql.DataSource;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-36 / M-11: таймаут соединения с pg-dwh обязателен — без {@code app.dwh.connect-timeout} старт красный.
 * Контекст поднимается только с {@link FndDwhConfig}; пул Hikari соединение при старте не открывает
 * ({@code initializationFailTimeout = -1}), поэтому база не нужна.
 */
class DwhDataSourcePropertiesTest {

    private static final String URL = "jdbc:postgresql://127.0.0.1:1/dwh_test_never_connected";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(FndDwhConfig.class)
            .withPropertyValues("app.dwh.url=" + URL, "app.dwh.username=TEST", "app.dwh.password=TEST");

    @Test
    @DisplayName("AC-36: без app.dwh.connect-timeout контекст не стартует, причина называет таймаут")
    void missingTimeoutFailsStartup() {
        runner.run(context -> {
            assertThat(context.getStartupFailure()).as("старт должен быть красным").isNotNull();
            assertThat(causeChain(context.getStartupFailure())).containsAnyOf("connect-timeout", "connectTimeout");
        });
    }

    @Test
    @DisplayName("AC-36: с таймаутом свойства связаны, пул pg-dwh создан")
    void timeoutBindsAndPoolIsCreated() {
        runner.withPropertyValues("app.dwh.connect-timeout=2s").run(context -> {
            assertThat(context.getStartupFailure()).isNull();
            assertThat(context.getBean(DwhDataSourceProperties.class).connectTimeout()).isEqualTo(Duration.ofSeconds(2));
            assertThat(context.getBean("dwhDataSource", DataSource.class)).isNotNull();
        });
    }

    @Test
    @DisplayName("AC-36: нулевой таймаут — старт красный")
    void zeroTimeoutFailsStartup() {
        runner.withPropertyValues("app.dwh.connect-timeout=0s").run(context -> {
            assertThat(context.getStartupFailure()).isNotNull();
            assertThat(causeChain(context.getStartupFailure())).contains("должен быть положительным");
        });
    }

    private static String causeChain(Throwable failure) {
        StringBuilder text = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) {
            text.append(t.getMessage()).append('\n');
        }
        return text.toString();
    }
}
