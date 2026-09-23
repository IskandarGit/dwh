package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawRow;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawWriter;
import com.greenwhite.dwh.instance.fnd.load.FndLoad;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Применение пакета «проверен»: строки файла в raw, сверка и закрытие пакета (контракт И6). */
class UplApplyServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate PERIOD_FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate PERIOD_TO = LocalDate.of(2026, 3, 31);

    @Autowired
    private UplApplyService applies;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplPackageRepository repo;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private MfFileService files;
    @Autowired
    private UplXlsxParser parser;
    @Autowired
    private FndLoadService loads;
    @Autowired
    private FndRawWriter raw;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private TransactionTemplate tx;

    private long userId;
    private long sourceId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        sourceId = UplPackageTestData.publishedSource(sources, userId, LocalDate.of(2026, 1, 1));
    }

    @Test
    @DisplayName("AC-10: все строки данных файла легли в raw с листом и номером строки, пакет «применён»")
    void applyWritesAllDataRowsWithSourceAddress() {
        PackageRow row = verifiedPackage(UplPackageTestData.workbook(7, 3));

        PackageRow applied = applies.apply(row.publicId().toString(), userId);

        assertThat(applied.status()).isEqualTo(UplPackageModel.APPLIED);
        assertThat(applied.loadId()).isNotNull();
        assertThat(applied.rawRows()).isEqualTo(10);
        assertThat(applied.rowsTotal()).isEqualTo(10);
        long loadId = applied.loadId();
        assertThat(rawCount(loadId)).isEqualTo(10);
        assertThat(dwhJdbc.sql("select count(*) from raw.rows where load_id = :id and sheet = :sheet"
                        + " and source_row_no is not null")
                .param("id", loadId).param("sheet", UplPackageTestData.SHEET)
                .query(Long.class).single()).isEqualTo(10);
        assertThat(loads.find(loadId)).hasValueSatisfying(
                load -> assertThat(load.status()).isEqualTo(FndLoad.APPLIED));
        assertThat(jdbc.sql("select count(*) from fnd_load_log where load_id = :id and event = 'applied'")
                .param("id", loadId).query(Long.class).single()).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-10: второй пакет того же файла и периода получает свою загрузку, первый остаётся «применён»")
    void secondPackageSamePeriodGetsOwnLoad() {
        byte[] content = UplPackageTestData.workbook(7, 3);
        PackageRow first = verifiedPackage(content);
        PackageRow second = verifiedPackage(content);

        PackageRow firstApplied = applies.apply(first.publicId().toString(), userId);
        PackageRow secondApplied = applies.apply(second.publicId().toString(), userId);

        assertThat(secondApplied.status()).isEqualTo(UplPackageModel.APPLIED);
        assertThat(secondApplied.loadId()).isNotNull().isNotEqualTo(firstApplied.loadId());
        assertThat(packages.get(first.publicId().toString()).status()).isEqualTo(UplPackageModel.APPLIED);
        assertThat(rawCount(firstApplied.loadId())).isEqualTo(10);
    }

    @Test
    @DisplayName("AC-12: применить можно только «проверен»; нет пакета — 404")
    void onlyVerifiedPackageCanBeApplied() {
        PackageRow row = verifiedPackage(UplPackageTestData.workbook(7, 3));
        PackageRow applied = applies.apply(row.publicId().toString(), userId);

        assertConflict(() -> applies.apply(row.publicId().toString(), userId), UplApplyService.UPL_PKG_NOT_VERIFIED);
        assertThat(rawCount(applied.loadId())).isEqualTo(10);
        assertThat(dwhJdbc.sql("select count(*) from raw.rows").query(Long.class).single()).isEqualTo(10);

        PackageRow broken = parsedPackage(UplPackageTestData.brokenStructure());
        assertThat(broken.status()).isEqualTo(UplPackageModel.REJECTED);
        assertConflict(() -> applies.apply(broken.publicId().toString(), userId), UplApplyService.UPL_PKG_NOT_VERIFIED);

        assertNotFound(() -> applies.apply(UUID.randomUUID().toString(), userId));
        assertNotFound(() -> applies.apply("abc", userId));
    }

    @Test
    @DisplayName("AC-12: в загрузке нет принятых строк — применить нельзя, прежняя загрузка периода не заменяется")
    void packageWithoutAcceptedRowsCannotBeApplied() {
        PackageRow good = verifiedPackage(UplPackageTestData.workbook(7, 3));
        PackageRow applied = applies.apply(good.publicId().toString(), userId);

        for (byte[] content : List.of(UplPackageTestData.workbook(0, 3), UplPackageTestData.workbook(0, 0))) {
            String id = verifiedPackage(content).publicId().toString();

            assertConflict(() -> applies.apply(id, userId), UplApplyService.UPL_PKG_NOTHING_TO_APPLY);
            assertThat(packages.get(id).status()).isEqualTo(UplPackageModel.VERIFIED);
            assertThat(packages.get(id).loadId()).isNull();
        }

        assertThat(dwhJdbc.sql("select count(*) from raw.rows").query(Long.class).single()).isEqualTo(10);
        assertThat(loads.find(applied.loadId())).hasValueSatisfying(
                load -> assertThat(load.status()).isEqualTo(FndLoad.APPLIED));
        assertThat(loads.appliedLoadIds(good.sourceCode())).containsExactly(applied.loadId());
    }

    @Test
    @DisplayName("AC-11: в raw легло меньше строк, чем в пакете — пакет «отклонён системой», загрузка неудачна")
    void reconciliationMismatchRejectsPackage() {
        PackageRow row = verifiedPackage(UplPackageTestData.workbook(7, 3));
        FndRawWriter losingLastRow = new FndRawWriter() {
            @Override
            public void write(long loadId, UUID sourceFileId, Iterable<FndRawRow> rows) {
                List<FndRawRow> all = new ArrayList<>();
                rows.forEach(all::add);
                raw.write(loadId, sourceFileId, all.subList(0, all.size() - 1));
            }

            @Override
            public List<FndRawRow> read(long loadId) {
                return raw.read(loadId);
            }
        };

        PackageRow result = service(losingLastRow).apply(row.publicId().toString(), userId);

        assertThat(result.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(result.rejectCode()).isEqualTo(UplApplyService.UPL_PKG_RECONCILIATION);
        assertThat(result.rejectParams()).containsEntry("fileRows", 10).containsEntry("rawRows", 9);
        assertThat(loads.find(result.loadId())).hasValueSatisfying(
                load -> assertThat(load.status()).isEqualTo(FndLoad.FAILED));
    }

    @Test
    @DisplayName("AC-11: запись в raw упала — пакет «отклонён системой», загрузка неудачна, ответа 500 нет")
    void rawWriteFailureRejectsPackage() {
        PackageRow row = verifiedPackage(UplPackageTestData.workbook(7, 3));
        FndRawWriter failing = new FndRawWriter() {
            @Override
            public void write(long loadId, UUID sourceFileId, Iterable<FndRawRow> rows) {
                throw new IllegalStateException("TEST");
            }

            @Override
            public List<FndRawRow> read(long loadId) {
                return raw.read(loadId);
            }
        };

        PackageRow result = service(failing).apply(row.publicId().toString(), userId);

        assertThat(result.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(result.rejectCode()).isEqualTo(UplApplyService.UPL_PKG_RAW_WRITE_FAILED);
        assertThat(loads.find(result.loadId())).hasValueSatisfying(
                load -> assertThat(load.status()).isEqualTo(FndLoad.FAILED));
    }

    // ---------- помощники ----------

    private PackageRow verifiedPackage(byte[] content) {
        PackageRow row = parsedPackage(content);
        assertThat(row.status()).isEqualTo(UplPackageModel.VERIFIED);
        return row;
    }

    private PackageRow parsedPackage(byte[] content) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, PERIOD_FROM, PERIOD_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        return packages.get(row.publicId().toString());
    }

    private UplApplyService service(FndRawWriter writer) {
        return new UplApplyService(packages, repo, sources, files, parser, loads, writer, actors, tx);
    }

    private long rawCount(long loadId) {
        return dwhJdbc.sql("select count(*) from raw.rows where load_id = :id")
                .param("id", loadId).query(Long.class).single();
    }

    private static void assertConflict(ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(409);
            assertThat(e.getMessage()).isEqualTo(code);
        });
    }

    private static void assertNotFound(ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND);
            assertThat(e.getMessage()).isEqualTo(UplPackageService.UPL_PKG_NOT_FOUND);
        });
    }
}
