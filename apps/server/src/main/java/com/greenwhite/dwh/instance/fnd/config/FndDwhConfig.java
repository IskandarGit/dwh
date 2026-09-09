package com.greenwhite.dwh.instance.fnd.config;

import com.greenwhite.dwh.instance.fnd.FndPref;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;

import javax.sql.DataSource;

/**
 * Второй {@link DataSource} — {@code pg-dwh}. Единственное место, где он создаётся; за пределы пакета
 * {@code fnd} квалификатор {@code "dwh"} не выходит (AC-5, 18 п.14). Пул не проверяет соединение при
 * старте: доступность pg-dwh — забота {@code DwhSchemaVersionGate} и фасадов (AC-36).
 *
 * <p>{@code defaultCandidate = false}: бины второй БД видны только по квалификатору {@code "dwh"}.
 * Иначе каркас, который инжектит {@code DataSource}/{@code JdbcClient} по типу, получал бы двух
 * кандидатов и контекст не поднимался бы — ни в тестах, ни в бою.
 */
@Configuration
@EnableConfigurationProperties(DwhDataSourceProperties.class)
public class FndDwhConfig {

    @Bean(name = "dwhDataSource", destroyMethod = "close", defaultCandidate = false)
    @Qualifier(FndPref.DWH)
    public DataSource dwhDataSource(DwhDataSourceProperties props) {
        HikariDataSource ds = new HikariDataSource();
        ds.setPoolName("dwh");
        ds.setJdbcUrl(props.url());
        ds.setUsername(props.username());
        ds.setPassword(props.password());
        long timeoutMs = props.connectTimeout().toMillis();
        ds.setConnectionTimeout(Math.max(timeoutMs, 250));
        ds.setInitializationFailTimeout(-1);
        ds.setMaximumPoolSize(4);
        // Драйвер PostgreSQL: connectTimeout/loginTimeout — в секундах, не меньше 1
        long seconds = Math.max(1, (timeoutMs + 999) / 1000);
        ds.addDataSourceProperty("connectTimeout", String.valueOf(seconds));
        ds.addDataSourceProperty("loginTimeout", String.valueOf(seconds));
        return ds;
    }

    @Bean(name = "dwhJdbcClient", defaultCandidate = false)
    @Qualifier(FndPref.DWH)
    public JdbcClient dwhJdbcClient(@Qualifier(FndPref.DWH) DataSource dwhDataSource) {
        return JdbcClient.create(dwhDataSource);
    }
}
