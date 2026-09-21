package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorsView;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;

/** Задание разбора: файл из хранилища превращается в счётчики и ошибки пакета (контракт И5). */
class UplParseJobTest extends EmbeddedPostgresTest {

    private static final LocalDate PERIOD_FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate PERIOD_TO = LocalDate.of(2026, 3, 31);

    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private MfFileService files;
    @Autowired
    private FndJobRunner jobs;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate tx;
    @Autowired
    private tools.jackson.databind.ObjectMapper json;
    @Autowired
    private PlatformTransactionManager transactions;

    private long userId;
    private long sourceId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
            jdbc.sql("delete from fnd_job_queue").update();
            jdbc.sql("delete from fnd_job_runs").update();
        });
        sourceId = UplPackageTestData.publishedSource(sources, userId, LocalDate.of(2026, 1, 1));
    }

    @Test
    @DisplayName("Файл разобран: пакет «проверен», счётчики строк и ошибки ключа сохранены")
    void jobVerifiesPackage() {
        PackageRow row = register(UplPackageTestData.workbook(7, 3));
        enqueue(row.publicId());

        assertThat(jobs.runQueued()).isEqualTo(1);

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.VERIFIED);
        assertThat(saved.rowsTotal()).isEqualTo(10);
        assertThat(saved.rowsAccepted()).isEqualTo(7);
        assertThat(saved.rowsRejected()).isEqualTo(3);
        assertThat(saved.errorsTotal()).isEqualTo(3);

        ErrorsView view = packages.errors(row.publicId().toString());
        assertThat(view.items()).hasSize(3).allSatisfy(error -> {
            assertThat(error.code()).isEqualTo(UplXlsxParser.UPL_CELL_KEY_MASK);
            assertThat(error.sheet()).isEqualTo(UplPackageTestData.SHEET);
            assertThat(error.columnName()).isEqualTo("Ключ");
            assertThat(error.rowNo()).isNotNull();
        });
    }

    @Test
    @DisplayName("Файл не по анкете: пакет «отклонён системой» с расхождениями, запуск задания успешен")
    void jobRejectsBrokenStructure() {
        PackageRow row = register(UplPackageTestData.brokenStructure());
        enqueue(row.publicId());

        assertThat(jobs.runQueued()).isEqualTo(1);

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(saved.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat(saved.rejectParams()).containsEntry("count", 2);

        ErrorsView view = packages.errors(row.publicId().toString());
        assertThat(view.items()).hasSize(2).extracting(ErrorRow::rowNo).containsOnlyNulls();
        assertThat(runStatuses()).containsExactly("done");
    }

    @Test
    @DisplayName("Разбор упал: пакет закрыт внутренней ошибкой, запуск задания помечен неудачным")
    void jobFailureRejectsPackage() {
        PackageRow row = register(UplPackageTestData.workbook(2, 0));
        enqueue(row.publicId());
        FndJobRunner runner = new FndJobRunner(jdbc, json, transactions,
                List.of(new UplParseJob(packages, sources, files, failingParser())));

        assertThat(runner.runQueued()).isZero();

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(saved.rejectCode()).isEqualTo(UplParseJob.UPL_PKG_INTERNAL);
        assertThat(runStatuses()).containsExactly("failed");
        assertThat(jdbc.sql("select error from fnd_job_runs").query(String.class).single())
                .contains("TEST сбой разбора");
    }

    @Test
    @DisplayName("Сбой чтения анкеты: пакет не остаётся «получен» — отклонён с внутренней ошибкой")
    void formatReadFailureRejectsPackage() {
        PackageRow row = register(UplPackageTestData.workbook(2, 0));
        enqueue(row.publicId());
        FndJobRunner runner = new FndJobRunner(jdbc, json, transactions,
                List.of(new UplParseJob(packages, failingSources(), files, new UplXlsxParser())));

        assertThat(runner.runQueued()).isZero();

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(saved.rejectCode()).isEqualTo(UplParseJob.UPL_PKG_INTERNAL);
        assertThat(saved.rowsTotal()).isNull();
        assertThat(saved.rowsAccepted()).isNull();
        assertThat(saved.rowsRejected()).isNull();
        assertThat(runStatuses()).containsExactly("failed");
        assertThat(jdbc.sql("select error from fnd_job_runs").query(String.class).single())
                .contains("TEST сбой чтения анкеты");
    }

    @Test
    @DisplayName("Повторное задание на уже проверенный пакет ничего не меняет")
    void secondJobLeavesVerifiedPackage() {
        PackageRow row = register(UplPackageTestData.workbook(7, 3));
        enqueue(row.publicId());
        assertThat(jobs.runQueued()).isEqualTo(1);
        PackageRow verified = packages.get(row.publicId().toString());

        enqueue(row.publicId());
        assertThat(jobs.runQueued()).isEqualTo(1);

        assertThat(packages.get(row.publicId().toString())).isEqualTo(verified);
        assertThat(packages.errors(row.publicId().toString()).items()).hasSize(3);
    }

    // ---------- помощники ----------

    private PackageRow register(byte[] content) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        return packages.register(new NewPackage(sourceId, 1, PERIOD_FROM, PERIOD_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
    }

    private void enqueue(UUID publicId) {
        jobs.enqueueOnce(UplPref.JOB_PARSE, Map.of("packageId", publicId.toString()));
    }

    private List<String> runStatuses() {
        return jdbc.sql("select status from fnd_job_runs order by id").query(String.class).list();
    }

    /** Анкеты, чтение которых падает: подменяют бин в раннере теста. */
    private static UplSourceService failingSources() {
        UplSourceService failing = Mockito.mock(UplSourceService.class);
        Mockito.when(failing.getVersion(anyLong(), anyInt()))
                .thenThrow(new IllegalStateException("TEST сбой чтения анкеты"));
        return failing;
    }

    /** Разборщик, падающий на любом файле: подменяет бин в раннере теста. */
    private static UplXlsxParser failingParser() {
        return new UplXlsxParser() {
            @Override
            public UplParseResult parse(InputStream content, FormatVersion format) {
                throw new IllegalStateException("TEST сбой разбора");
            }
        };
    }
}
