package com.greenwhite.dwh.instance.fnd.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

/**
 * Подключение к {@code pg-dwh} (промпт 02 п.18). Таймаут соединения обязателен: дефолта «без таймаута»
 * нет (AC-36), отсутствие свойства {@code app.dwh.connect-timeout} — красный старт.
 */
@Validated
@ConfigurationProperties(prefix = "app.dwh")
public record DwhDataSourceProperties(
        @NotBlank String url,
        @NotBlank String username,
        String password,
        @NotNull Duration connectTimeout) {

    public DwhDataSourceProperties {
        if (connectTimeout != null && (connectTimeout.isNegative() || connectTimeout.isZero())) {
            throw new IllegalArgumentException("app.dwh.connect-timeout должен быть положительным");
        }
    }
}
