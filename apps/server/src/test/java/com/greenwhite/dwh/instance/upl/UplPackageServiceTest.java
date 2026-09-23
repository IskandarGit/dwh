package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult.ErrorRecord;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorsView;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;

/** Пакет загрузки в базе: запись принятого файла, итог разбора, ошибки и список (контракт И5). */
class UplPackageServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate PERIOD_FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate PERIOD_TO = LocalDate.of(2026, 3, 31);

    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplPackageRepository repo;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private MfFileService files;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
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
        sourceId = UplPackageTestData.publishedSource(sources, userId, LocalDate.of(2026, 1, 1));
    }

    @Test
    @DisplayName("Принятый файл записан пакетом «получен»: счётчики пусты, источник виден по коду и названию")
    void registerStoresReceivedPackage() {
        PackageRow row = register();

        assertThat(row.status()).isEqualTo(UplPackageModel.RECEIVED);
        assertThat(row.publicId()).isNotNull();
        assertThat(row.rowsTotal()).isNull();
        assertThat(row.rowsAccepted()).isNull();
        assertThat(row.rowsRejected()).isNull();
        assertThat(row.errorsTotal()).isNull();
        assertThat(row.rejectCode()).isNull();
        assertThat(row.rejectParams()).isNull();
        assertThat(row.sourceId()).isEqualTo(sourceId);
        assertThat(row.sourceCode()).startsWith("test.pkg.");
        assertThat(row.sourceName()).isEqualTo("TEST source");
        assertThat(row.periodFrom()).isEqualTo(PERIOD_FROM);
        assertThat(row.periodTo()).isEqualTo(PERIOD_TO);
        assertThat(row.uploadedBy()).isEqualTo(String.valueOf(userId));

        assertThat(packages.get(row.publicId().toString())).isEqualTo(row);
    }

    @Test
    @DisplayName("Неизвестный и неразбираемый идентификатор пакета — 404 UPL_PKG_NOT_FOUND")
    void unknownPackageIsNotFound() {
        assertNotFound(() -> packages.get(UUID.randomUUID().toString()));
        assertNotFound(() -> packages.get("not-a-uuid"));
    }

    @Test
    @DisplayName("Итог «проверен»: счётчики строк и записи об ошибках по порядку")
    void saveVerifiedResult() {
        PackageRow row = register();
        List<ErrorRecord> errors = List.of(
                cellError(3, "12345"),
                cellError(4, "1234567"),
                cellError(5, "12345678X"));

        packages.saveParseResult(row.id(), UplParseResult.verified(10, 3, 3, errors));

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.VERIFIED);
        assertThat(saved.rowsTotal()).isEqualTo(10);
        assertThat(saved.rowsAccepted()).isEqualTo(7);
        assertThat(saved.rowsRejected()).isEqualTo(3);
        assertThat(saved.errorsTotal()).isEqualTo(3);

        ErrorsView view = packages.errors(row.publicId().toString());
        assertThat(view.total()).isEqualTo(3);
        assertThat(view.items()).extracting(ErrorRow::ordinal).containsExactly(1, 2, 3);
        assertThat(view.items()).extracting(ErrorRow::rowNo).containsExactly(3, 4, 5);
        assertThat(view.items()).extracting(ErrorRow::cellValue)
                .containsExactly("12345", "1234567", "12345678X");
        assertThat(view.items()).allSatisfy(error -> {
            assertThat(error.sheet()).isEqualTo(UplPackageTestData.SHEET);
            assertThat(error.columnName()).isEqualTo("Ключ");
            assertThat(error.code()).isEqualTo(UplXlsxParser.UPL_CELL_KEY_MASK);
            assertThat(error.params()).containsEntry("column", "Ключ");
        });
    }

    @Test
    @DisplayName("Итог «отклонён системой»: причина с расхождениями, счётчики строк пусты")
    void saveRejectedResult() {
        PackageRow row = register();
        List<ErrorRecord> errors = List.of(
                structError("Сумма", UplXlsxParser.UPL_STRUCT_COLUMN_MISSING),
                structError("Лишняя", UplXlsxParser.UPL_STRUCT_COLUMN_UNKNOWN));

        packages.saveParseResult(row.id(), UplParseResult.rejected(UplXlsxParser.UPL_PKG_STRUCTURE,
                Map.of("count", 2), 2, errors));

        PackageRow saved = packages.get(row.publicId().toString());
        assertThat(saved.status()).isEqualTo(UplPackageModel.REJECTED);
        assertThat(saved.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat(saved.rejectParams()).containsEntry("count", 2);
        assertThat(saved.rowsTotal()).isNull();
        assertThat(saved.rowsAccepted()).isNull();
        assertThat(saved.rowsRejected()).isNull();
        assertThat(saved.errorsTotal()).isEqualTo(2);

        ErrorsView view = packages.errors(row.publicId().toString());
        assertThat(view.total()).isEqualTo(2);
        assertThat(view.items()).extracting(ErrorRow::rowNo).containsOnlyNulls();
        assertThat(view.items()).extracting(ErrorRow::columnName).containsExactly("Сумма", "Лишняя");
    }

    @Test
    @DisplayName("Повторный итог для проверенного пакета — ошибка, а отклонение в своей транзакции молча ничего не меняет")
    void secondResultIsRefused() {
        PackageRow row = register();
        packages.saveParseResult(row.id(), UplParseResult.verified(10, 3, 3, List.of(cellError(3, "12345"),
                cellError(4, "1234567"), cellError(5, "12345678X"))));
        PackageRow verified = packages.get(row.publicId().toString());

        assertThatThrownBy(() -> packages.saveParseResult(row.id(),
                UplParseResult.verified(1, 0, 0, List.of())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(String.valueOf(row.id()));
        assertThat(packages.get(row.publicId().toString())).isEqualTo(verified);

        assertThatCode(() -> packages.rejectInNewTransaction(row.id(), "UPL_PKG_INTERNAL"))
                .doesNotThrowAnyException();
        assertThat(packages.get(row.publicId().toString()).status()).isEqualTo(UplPackageModel.VERIFIED);
    }

    @Test
    @DisplayName("Список идёт от новых к старым и листается курсором; неверные limit и cursor — 422")
    void listIsPagedByCursor() {
        PackageRow first = register();
        PackageRow second = register();
        PackageRow third = register();

        KeysetPage<PackageRow> page = packages.list(2, null);
        assertThat(page.items()).extracting(PackageRow::id).containsExactly(third.id(), second.id());
        assertThat(page.hasMore()).isTrue();
        assertThat(page.totalEstimated()).isEqualTo(3);
        assertThat(page.nextCursor()).isNotNull();

        KeysetPage<PackageRow> tail = packages.list(2, page.nextCursor());
        assertThat(tail.items()).extracting(PackageRow::id).containsExactly(first.id());
        assertThat(tail.hasMore()).isFalse();
        assertThat(tail.nextCursor()).isNull();

        assertValidation(() -> packages.list(0, null), "INVALID_LIMIT");
        assertValidation(() -> packages.list(50, "мусор"), "INVALID_CURSOR");
    }

    @Test
    @DisplayName("И6: переходы применения — номер загрузки один раз, «применён» и «отклонён» только из «проверен»")
    void applyTransitions() {
        PackageRow first = register();
        packages.saveParseResult(first.id(), UplParseResult.verified(5, 0, 0, List.of()));
        PackageRow second = register();
        packages.saveParseResult(second.id(), UplParseResult.verified(3, 0, 0, List.of()));

        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());

            assertThat(repo.setLoadId(first.id(), 42)).isEqualTo(1);
            assertThat(repo.setLoadId(first.id(), 42)).isZero();
            assertThat(repo.lockByPublicId(first.publicId()))
                    .hasValueSatisfying(locked -> assertThat(locked.loadId()).isEqualTo(42L));

            assertThat(repo.markApplied(first.id(), 5)).isEqualTo(1);
            PackageRow applied = repo.findById(first.id()).orElseThrow();
            assertThat(applied.status()).isEqualTo("applied");
            assertThat(applied.rawRows()).isEqualTo(5);
            assertThat(repo.markApplyRejected(first.id(), "X", Map.of(), 5)).isZero();

            assertThat(repo.markApplyRejected(second.id(), "UPL_PKG_RECONCILIATION",
                    Map.of("fileRows", 3, "rawRows", 2), 2)).isEqualTo(1);
            PackageRow rejected = repo.findById(second.id()).orElseThrow();
            assertThat(rejected.status()).isEqualTo(UplPackageModel.REJECTED);
            assertThat(rejected.rejectCode()).isEqualTo("UPL_PKG_RECONCILIATION");
            assertThat(rejected.rejectParams()).containsEntry("fileRows", 3).containsEntry("rawRows", 2);
            assertThat(rejected.rawRows()).isEqualTo(2);
        });
    }

    // ---------- помощники ----------

    private PackageRow register() {
        byte[] content = UplPackageTestData.workbook(2, 0);
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        return packages.register(new NewPackage(sourceId, 1, PERIOD_FROM, PERIOD_TO, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
    }

    private static ErrorRecord cellError(int rowNo, String value) {
        return new ErrorRecord(UplPackageTestData.SHEET, rowNo, "Ключ", value,
                UplXlsxParser.UPL_CELL_KEY_MASK, Map.of("column", "Ключ"));
    }

    private static ErrorRecord structError(String column, String code) {
        return new ErrorRecord(UplPackageTestData.SHEET, null, column, null, code,
                Map.of("column", column));
    }

    private static void assertNotFound(ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND);
            assertThat(e.getMessage()).isEqualTo(UplPackageService.UPL_PKG_NOT_FOUND);
        });
    }

    private static void assertValidation(ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED);
            assertThat(e.getMessage()).isEqualTo(code);
        });
    }
}
