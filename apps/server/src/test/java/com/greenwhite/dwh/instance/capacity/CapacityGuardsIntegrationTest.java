package com.greenwhite.dwh.instance.capacity;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.ScopeFilter;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import com.greenwhite.dwh.instance.mf.service.FileContentInspector;
import com.greenwhite.dwh.instance.mf.service.MfFileMetadataService;
import com.greenwhite.dwh.instance.mf.service.MfFileObjectLock;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.report.repository.ReportRepository;
import com.greenwhite.dwh.instance.report.service.ReportService;
import com.greenwhite.dwh.spi.storage.FileScanner;
import com.greenwhite.dwh.spi.storage.StorageProvider;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Testcontainers
class CapacityGuardsIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("capacity_guards_test")
            .withUsername("test_user")
            .withPassword("test_pass");

    static JdbcClient jdbc;

    @BeforeAll
    static void setup() {
        var ds = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure())
                .dataSource(ds)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        jdbc = JdbcClient.create(ds);
    }

    @Test
    @DisplayName("P-03: Потоковый экспорт ограничивает максимальное количество строк лимитом maxRows")
    void shouldEnforceMaxRowsLimitOnTaskExportStream() {
        var reportRepo = new ReportRepository(jdbc);

        long userId = jdbc.sql("""
                insert into md_users (name, login, email)
                values ('Cap User', 'cap_user', 'cap@local')
                returning id
                """).query(Long.class).single();

        // Seed 10 tasks with default status (status_id=1)
        for (int i = 1; i <= 10; i++) {
            jdbc.sql("""
                    insert into ms_tasks (title, priority, status_id, reporter_id)
                    values (:title, 'medium', 1, :reporterId)
                    """)
                    .param("title", "Capacity Task " + i)
                    .param("reporterId", userId)
                    .update();
        }

        // Stream with limit 4
        var rows = new ArrayList<ReportRepository.TaskExportRow>();
        reportRepo.streamScopedTasks(ScopeFilter.unrestricted(), 4, rows::add);

        assertThat(rows).hasSize(4);
    }

    @Test
    @DisplayName("P-03: Обрыв соединения клиентом прерывает экспорт и не выбрасывает неперехваченную ошибку")
    void shouldAbortStreamingGracefullyWhenClientDisconnects() throws Exception {
        var reportRepo = new ReportRepository(jdbc);
        var scopeService = mock(MdScopeService.class);
        when(scopeService.filterForTasks(9001L)).thenReturn(ScopeFilter.unrestricted());

        var reportService = new ReportService(reportRepo, scopeService, 100);

        var writtenCount = new AtomicInteger(0);
        OutputStream abortingStream = new OutputStream() {
            @Override
            public void write(int b) throws IOException {
                if (writtenCount.incrementAndGet() > 10) {
                    throw new IOException("Broken pipe / Connection reset by peer");
                }
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                if (writtenCount.addAndGet(len) > 10) {
                    throw new IOException("Broken pipe / Connection reset by peer");
                }
            }
        };

        // Must terminate cleanly without throwing ClientAbortException or unhandled exception
        reportService.exportTasksCsv(abortingStream, 9001L);
        assertThat(writtenCount.get()).isGreaterThanOrEqualTo(10);
    }

    @Test
    @DisplayName("P-04: Статистика аудита вычисляется объединенным запросом и кэшируется на 15 секунд с computedAt")
    void shouldCoalesceAndCacheAuditStats() {
        var auditRepo = new AuditLogRepository(jdbc, new ObjectMapper());
        var redactor = new AuditDataRedactor();
        var auditService = new AuditLogService(auditRepo, null, redactor);

        // Seed sample security events
        jdbc.sql("""
                insert into security_events (event_type, ip, user_agent, created_at)
                values ('LOGIN_FAILED', '127.0.0.1', 'test-agent', now()),
                       ('LOGIN_SUCCESS', '127.0.0.1', 'test-agent', now()),
                       ('IP_RATE_LIMITED', '10.0.0.1', 'test-agent', now() - interval '2 days')
                """).update();

        var stats1 = auditService.getAuditStats();
        assertThat(stats1).isNotNull();
        assertThat(stats1.computedAt()).isNotNull();
        assertThat(stats1.totalSecurityEvents()).isGreaterThanOrEqualTo(3);

        // Consecutive call returns cached instance within 15 seconds
        var stats2 = auditService.getAuditStats();
        assertThat(stats2).isSameAs(stats1);
        assertThat(stats2.computedAt()).isEqualTo(stats1.computedAt());
    }

    @Test
    @DisplayName("P-03: Семафор одновременных загрузок файлов отклоняет избыточные запросы с кодом RATE_LIMITED (429)")
    void shouldRejectConcurrentUploadsWhenLimitExceeded() throws Exception {
        var metadataService = mock(MfFileMetadataService.class);
        var storageProvider = mock(StorageProvider.class);
        var contentInspector = mock(FileContentInspector.class);
        var objectLock = mock(MfFileObjectLock.class);
        var scopeService = mock(MdScopeService.class);

        when(contentInspector.inspect(any(), any())).thenAnswer(inv -> {
            InputStream in = inv.getArgument(1);
            return new FileContentInspector.Inspection(in, "application/pdf");
        });

        // Limit concurrent uploads to 1 permit
        var fileService = new MfFileService(
                metadataService, storageProvider, contentInspector,
                List.of(), objectLock, scopeService, 1);

        CountDownLatch uploadStarted = new CountDownLatch(1);
        CountDownLatch uploadCanFinish = new CountDownLatch(1);
        AtomicReference<Exception> secondUploadError = new AtomicReference<>();

        when(storageProvider.upload(anyString(), anyString(), any(), anyLong(), anyString()))
                .thenAnswer(inv -> {
                    uploadStarted.countDown();
                    uploadCanFinish.await(5, TimeUnit.SECONDS);
                    return null;
                });

        // Thread 1 holds the upload permit
        Thread t1 = new Thread(() -> {
            try {
                fileService.uploadFile("doc1.pdf", "application/pdf",
                        new ByteArrayInputStream("data".getBytes(StandardCharsets.UTF_8)), 4, 9001L);
            } catch (Exception ignored) {}
        });
        t1.start();

        assertThat(uploadStarted.await(5, TimeUnit.SECONDS)).isTrue();

        // Thread 2 attempts upload while Thread 1 is holding the permit -> Must be rejected with RATE_LIMITED
        Thread t2 = new Thread(() -> {
            try {
                fileService.uploadFile("doc2.pdf", "application/pdf",
                        new ByteArrayInputStream("data".getBytes(StandardCharsets.UTF_8)), 4, 9001L);
            } catch (Exception e) {
                secondUploadError.set(e);
            }
        });
        t2.start();
        t2.join(2000);

        uploadCanFinish.countDown();
        t1.join(2000);

        assertThat(secondUploadError.get())
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Превышен лимит одновременных загрузок");
        var apiException = (ApiException) secondUploadError.get();
        assertThat(apiException.getErrorCode()).isEqualTo(ErrorCode.RATE_LIMITED);
        assertThat(apiException.getErrorCode().getDefaultStatus()).isEqualTo(429);
    }
}
