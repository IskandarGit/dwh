package com.greenwhite.dwh.instance.config.idempotency;

import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class IdempotencyFilterIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("dwh_idempotency_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;
    static IdempotencyFilter filter;

    @BeforeAll
    static void setup() {
        var dataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbc = JdbcClient.create(dataSource);
        var repository = new IdempotencyRepository(jdbc);
        filter = new IdempotencyFilter(new IdempotencyService(repository), new ObjectMapper());
    }

    @BeforeEach
    void clearKeys() {
        jdbc.sql("delete from idempotency_keys").update();
    }

    @Test
    @DisplayName("Параллельный запрос с тем же ключом не должен повторно выполнять бизнес-операцию")
    void concurrentDuplicateDoesNotExecuteBusinessOperationTwice() throws Exception {
        UUID key = UUID.randomUUID();
        AtomicInteger businessExecutions = new AtomicInteger();
        CountDownLatch firstExecutionStarted = new CountDownLatch(1);
        CountDownLatch releaseFirstExecution = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        FilterChain businessOperation = (request, response) -> {
            int execution = businessExecutions.incrementAndGet();
            if (execution == 1) {
                firstExecutionStarted.countDown();
                try {
                    if (!releaseFirstExecution.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Timed out waiting to finish the first request");
                    }
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while waiting to finish the first request", ex);
                }
            }
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(HttpServletResponse.SC_CREATED);
            httpResponse.setContentType("application/json");
            httpResponse.getOutputStream().write("{\"id\":42}".getBytes(StandardCharsets.UTF_8));
        };

        try {
            Future<MockHttpServletResponse> first = executor.submit(() -> invoke(key, businessOperation));
            assertThat(firstExecutionStarted.await(5, TimeUnit.SECONDS))
                    .as("первый запрос вошёл в бизнес-операцию")
                    .isTrue();

            Future<MockHttpServletResponse> duplicate = executor.submit(() -> invoke(key, businessOperation));
            MockHttpServletResponse duplicateResponse = duplicate.get(5, TimeUnit.SECONDS);

            assertThat(businessExecutions.get())
                    .as("конкурентный дубликат не достигает бизнес-операции")
                    .isEqualTo(1);
            assertThat(duplicateResponse.getStatus()).isEqualTo(HttpServletResponse.SC_CONFLICT);
            assertThat(duplicateResponse.getContentAsString())
                    .contains("idempotency_request_in_progress");

            releaseFirstExecution.countDown();
            MockHttpServletResponse firstResponse = first.get(5, TimeUnit.SECONDS);
            assertThat(firstResponse.getStatus()).isEqualTo(HttpServletResponse.SC_CREATED);
        } finally {
            releaseFirstExecution.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("expired pending reservation is reclaimed and business operation executes")
    void reclaimsExpiredPendingReservation() throws Exception {
        UUID key = UUID.randomUUID();
        // Insert an expired PENDING reservation (e.g. from crashed server 5 minutes ago)
        jdbc.sql("""
                insert into idempotency_keys
                    (key, user_id, request_hash, state, reservation_token, created_at)
                values
                    (:key, null, 'oldhash', 'PENDING', :token, now() - interval '5 minutes')
                """)
                .param("key", key)
                .param("token", UUID.randomUUID())
                .update();

        AtomicInteger executions = new AtomicInteger();
        FilterChain businessOperation = (request, response) -> {
            executions.incrementAndGet();
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(HttpServletResponse.SC_CREATED);
            httpResponse.setContentType("application/json");
            httpResponse.getOutputStream().write("{\"reclaimed\":true}".getBytes(StandardCharsets.UTF_8));
        };

        MockHttpServletResponse response = invoke(key, businessOperation);

        assertThat(executions.get()).isEqualTo(1);
        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_CREATED);
        assertThat(response.getContentAsString()).contains("\"reclaimed\":true");

        // Verify key is now COMPLETED
        var record = jdbc.sql("select state from idempotency_keys where key = :key")
                .param("key", key)
                .query((rs, rowNum) -> rs.getString("state"))
                .single();
        assertThat(record).isEqualTo("COMPLETED");
    }

    private static MockHttpServletResponse invoke(UUID key, FilterChain chain) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, key.toString());
        request.setContentType("application/json");
        request.setContent("{\"title\":\"Release\"}".getBytes(StandardCharsets.UTF_8));
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, chain);
        return response;
    }
}
