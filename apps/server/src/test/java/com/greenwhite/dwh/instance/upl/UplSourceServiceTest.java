package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceSummary;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceType;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.SourceView;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Сервис анкеты файла (И3 шаг 3.5): AC-1…AC-12 контракта source-formats. */
class UplSourceServiceTest extends EmbeddedPostgresTest {

    private static final String UNIT_BASE = "test.u.base";
    private static final String UNIT_PART = "test.u.part";
    private static final String UNIT_OTHER = "test.u.other";

    @Autowired
    private UplSourceService service;
    @Autowired
    private FndUnitService units;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;

    private long userId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        ensureUnit(UNIT_BASE, UNIT_BASE);
        ensureUnit(UNIT_OTHER, UNIT_OTHER);
        ensureUnit(UNIT_PART, UNIT_BASE);
    }

    @Test
    @DisplayName("AC-1, AC-4: источник создаётся с умолчаниями и правится с lockVersion; код неизменен")
    void createAndUpdateSource() {
        String code = newCode();
        SourceView created = service.createSource(data(code), userId);
        long id = created.source().id();
        assertThat(created.source().lockVersion()).isZero();
        assertThat(created.source().sourceType()).isEqualTo(SourceType.FILE);
        assertThat(created.hasDraft()).isFalse();
        assertThat(created.lastPublishedVersion()).isNull();

        SourceView updated = service.updateSource(id, 0, data(code), userId);
        assertThat(updated.source().lockVersion()).isEqualTo(1);

        assertApi(() -> service.updateSource(id, 0, data(code), userId), ErrorCode.CONFLICT, "STALE_VERSION");
        assertApi(() -> service.updateSource(id, 1, data(code + "x"), userId),
                ErrorCode.VALIDATION_FAILED, "UPL_SOURCE_CODE_IMMUTABLE");
        assertApi(() -> service.updateSource(-1, 0, data(code), userId), ErrorCode.NOT_FOUND, "UPL_SOURCE_NOT_FOUND");
    }

    @Test
    @DisplayName("AC-2: занятый код источника — CODE_ALREADY_EXISTS")
    void duplicateCodeIgnoringCase() {
        String code = newCode();
        service.createSource(data(code), userId);
        assertApi(() -> service.createSource(data(code), userId),
                ErrorCode.CODE_ALREADY_EXISTS, "UPL_SOURCE_CODE_TAKEN");
    }

    @Test
    @DisplayName("AC-5: список листается курсором без повторов; неверные limit/cursor и чужой id")
    void listWithCursorAndNotFound() {
        String prefix = newCode() + ".";
        for (String suffix : List.of("a", "b", "c")) {
            service.createSource(data(prefix + suffix), userId);
        }
        List<String> ours = new ArrayList<>();
        String cursor = null;
        for (int guard = 0; guard < 100_000; guard++) {
            KeysetPage<SourceSummary> page = service.listSources(1, cursor);
            page.items().stream().map(SourceSummary::code).filter(c -> c.startsWith(prefix)).forEach(ours::add);
            if (!page.hasMore()) {
                break;
            }
            cursor = page.nextCursor();
        }
        assertThat(ours).containsExactly(prefix + "a", prefix + "b", prefix + "c");

        assertApi(() -> service.getSource(-1), ErrorCode.NOT_FOUND, "UPL_SOURCE_NOT_FOUND");
        assertApi(() -> service.listSources(0, null), ErrorCode.VALIDATION_FAILED, null);
        assertApi(() -> service.listSources(1, "%%%"), ErrorCode.VALIDATION_FAILED, null);
    }

    @Test
    @DisplayName("AC-6: второй черновик — FND_VERSION_DRAFT_EXISTS")
    void draftTwiceConflicts() {
        long id = newSource();
        FormatVersion draft = service.createDraft(id, null, userId);
        assertThat(draft.status()).isEqualTo("draft");
        assertThat(service.getSource(id).hasDraft()).isTrue();
        assertApi(() -> service.createDraft(id, null, userId), ErrorCode.CONFLICT, "FND_VERSION_DRAFT_EXISTS");
    }

    @Test
    @DisplayName("AC-8: замена черновика с lockVersion; устаревший lock — STALE_VERSION")
    void replaceDraftWithLock() {
        long id = newSource();
        int version = service.createDraft(id, null, userId).version();
        int lock = service.getVersion(id, version).lockVersion();
        FormatVersion replaced = service.replaceDraft(id, version, lock, validDraft(), userId);
        assertThat(replaced.sheets()).hasSize(2);
        assertThat(replaced.fileKind()).isEqualTo(FileKind.XLSX);
        assertThat(replaced.matchColumnsBy()).isEqualTo(MatchBy.HEADER);
        assertApi(() -> service.replaceDraft(id, version, lock, validDraft(), userId),
                ErrorCode.CONFLICT, "STALE_VERSION");
    }

    @Test
    @DisplayName("AC-9: публикация собирает все нарушения анкеты, черновик остаётся черновиком")
    void publishCollectsAllViolations() {
        long xlsxId = newSource();
        int xlsx = service.createDraft(xlsxId, null, userId).version();
        Sheet noName = new Sheet(null, 0, null, 1, null, List.of(
                col("A", "a", DataType.TEXT, null, null, "x", null, null, null),
                col(" a ", "b", DataType.TEXT, null, null, null, null, null, null),
                col("C", "a", DataType.TEXT, null, null, null, null, null, null),
                col("D", "d", DataType.INTEGER, null, null, null, null, 3, null),
                col("E", "e", DataType.TEXT, null, UNIT_BASE, null, null, null, null),
                withUnits(col("F", "f", DataType.NUMBER, null, null, null, null, null, null), UNIT_PART, null),
                withUnits(col("G", "g", DataType.NUMBER, null, null, null, null, null, null), "test.u.nope", UNIT_BASE),
                withUnits(col("H", "h", DataType.NUMBER, null, null, null, null, null, null), UNIT_PART, UNIT_OTHER),
                col("I", "i", DataType.REF_CODE, null, null, null, null, null, null),
                col("J", "j", DataType.TEXT, null, null, null, null, null, "test.book")));
        Sheet badKeys = new Sheet(null, 0, "TEST keys", 1, null, List.of(
                col("K1", "k1", DataType.OBJECT_KEY, null, null, null, null, null, null),
                col("K2", "k2", DataType.OBJECT_KEY, null, null, "[", null, null, null)));
        Sheet empty = new Sheet(null, 0, "TEST empty", 1, null, List.of());
        replace(xlsxId, xlsx, new DraftData(FileKind.XLSX, "utf-8", null, MatchBy.HEADER,
                List.of(noName, badKeys, empty)));
        List<FieldErrorItem> xlsxErrors = publishErrors(xlsxId, xlsx);
        assertThat(codes(xlsxErrors)).contains("UPL_SHEET_NAME_REQUIRED", "UPL_OBJECT_KEY_COUNT",
                "UPL_COLUMN_NAME_DUPLICATE", "UPL_TARGET_FIELD_DUPLICATE", "UPL_KEY_RULE_NOT_KEY",
                "UPL_KEY_PAD_MAX_WITHOUT_LENGTH", "UPL_UNIT_NOT_NUMERIC", "UPL_BASE_UNIT_REQUIRED",
                "UPL_UNIT_UNKNOWN", "UPL_BASE_UNIT_MISMATCH", "UPL_REF_BOOK_REQUIRED", "UPL_REF_BOOK_NOT_REF",
                "UPL_XLSX_NO_CSV_PARAMS", "UPL_KEY_MASK_REQUIRED", "UPL_KEY_MASK_INVALID", "UPL_SHEET_NO_COLUMNS");
        assertThat(xlsxErrors).contains(
                new FieldErrorItem("sheets[0].columns[1].nameInFile", "UPL_COLUMN_NAME_DUPLICATE",
                        "UPL_COLUMN_NAME_DUPLICATE"),
                new FieldErrorItem("sheets[1].columns[1].keyMask", "UPL_KEY_MASK_INVALID", "UPL_KEY_MASK_INVALID"),
                new FieldErrorItem("sheets[2].columns", "UPL_SHEET_NO_COLUMNS", "UPL_SHEET_NO_COLUMNS"));
        assertThat(service.getVersion(xlsxId, xlsx).status()).isEqualTo("draft");

        long csvId = newSource();
        int csv = service.createDraft(csvId, null, userId).version();
        Sheet positions = new Sheet(null, 0, null, 1, null, List.of(
                col("K", "k", DataType.OBJECT_KEY, null, null, "^[0-9]+$", null, null, null),
                col("B", "b", DataType.TEXT, 2, null, null, null, null, null),
                col("C", "c", DataType.TEXT, 2, null, null, null, null, null)));
        Sheet second = new Sheet(null, 0, null, 1, null, List.of(
                col("K", "k", DataType.OBJECT_KEY, 1, null, "^[0-9]+$", null, null, null)));
        replace(csvId, csv, new DraftData(FileKind.CSV, null, null, MatchBy.POSITION, List.of(positions, second)));
        assertThat(codes(publishErrors(csvId, csv))).contains("UPL_CSV_ONE_SHEET", "UPL_CSV_ENCODING_REQUIRED",
                "UPL_CSV_DELIMITER_REQUIRED", "UPL_POSITION_REQUIRED", "UPL_POSITION_DUPLICATE");
        assertThat(service.getVersion(csvId, csv).status()).isEqualTo("draft");

        long emptyId = newSource();
        int emptyVersion = service.createDraft(emptyId, null, userId).version();
        assertThat(codes(publishErrors(emptyId, emptyVersion))).containsExactly("UPL_NO_SHEETS");
        assertThat(service.getVersion(emptyId, emptyVersion).status()).isEqualTo("draft");
    }

    @Test
    @DisplayName("AC-7, AC-10, AC-11: копия черновика, публикация закрывает прежнюю версию, дата не позже — отказ")
    void publishSupersedeByDate() {
        long id = newSource();
        int v1 = service.createDraft(id, null, userId).version();
        replace(id, v1, validDraft());
        service.publish(id, v1, LocalDate.of(2026, 1, 1), userId);
        assertThat(service.versionAt(id, LocalDate.of(2026, 3, 1)).version()).isEqualTo(v1);
        assertApi(() -> service.versionAt(id, LocalDate.of(2025, 12, 31)), ErrorCode.NOT_FOUND, "FND_VERSION_UNKNOWN");

        FormatVersion first = service.getVersion(id, v1);
        FormatVersion copy = service.createDraft(id, v1, userId);
        int v2 = copy.version();
        assertThat(v2).isNotEqualTo(v1);
        assertThat(copy.status()).isEqualTo("draft");
        assertThat(copy.fileKind()).isEqualTo(first.fileKind());
        assertThat(copy.encoding()).isEqualTo(first.encoding());
        assertThat(copy.delimiter()).isEqualTo(first.delimiter());
        assertThat(copy.matchColumnsBy()).isEqualTo(first.matchColumnsBy());
        assertThat(copy.sheets()).usingRecursiveComparison()
                .ignoringFieldsMatchingRegexes("(.*\\.)?id")
                .isEqualTo(first.sheets());
        assertThat(ids(copy)).doesNotContainAnyElementsOf(ids(first));
        assertThat(service.getVersion(id, v1).sheets()).usingRecursiveComparison().isEqualTo(first.sheets());

        service.publish(id, v2, LocalDate.of(2026, 4, 1), userId);
        assertThat(service.versionAt(id, LocalDate.of(2026, 3, 31)).version()).isEqualTo(v1);
        assertThat(service.versionAt(id, LocalDate.of(2026, 4, 1)).version()).isEqualTo(v2);
        FormatVersion closed = service.getVersion(id, v1);
        assertThat(closed.validTo()).isEqualTo(LocalDate.of(2026, 3, 31));
        assertThat(closed.publishedBy()).isEqualTo(String.valueOf(userId));
        assertThat(service.getSource(id).lastPublishedVersion()).isEqualTo(v2);

        int v3 = service.createDraft(id, v2, userId).version();
        assertApi(() -> service.publish(id, v3, LocalDate.of(2026, 4, 1), userId),
                ErrorCode.CONFLICT, "FND_VERSION_NOT_AFTER_PREVIOUS");
        assertThat(service.getVersion(id, v3).status()).isEqualTo("draft");
    }

    @Test
    @DisplayName("AC-12: опубликованную версию нельзя заменить и опубликовать повторно")
    void publishedIsImmutable() {
        long id = newSource();
        int version = service.createDraft(id, null, userId).version();
        replace(id, version, validDraft());
        service.publish(id, version, LocalDate.of(2026, 1, 1), userId);
        int lock = service.getVersion(id, version).lockVersion();

        assertApi(() -> service.replaceDraft(id, version, lock, validDraft(), userId),
                ErrorCode.CONFLICT, "UPL_FORMAT_NOT_DRAFT");
        assertApi(() -> service.publish(id, version, LocalDate.of(2026, 2, 1), userId),
                ErrorCode.CONFLICT, "UPL_FORMAT_NOT_DRAFT");
        assertThat(service.getVersion(id, version).status()).isEqualTo("published");
    }

    @Test
    @DisplayName("С-3, AC-9: единица источника = базовой, но производная — UPL_BASE_UNIT_MISMATCH; базовая = базовой — публикуется")
    void sourceEqualsBaseUnitMustBeBase() {
        long derivedId = newSource();
        int derived = service.createDraft(derivedId, null, userId).version();
        replace(derivedId, derived, draftWithUnits(UNIT_PART, UNIT_PART));
        assertThat(publishErrors(derivedId, derived)).contains(new FieldErrorItem(
                "sheets[0].columns[1].baseUnit", "UPL_BASE_UNIT_MISMATCH", "UPL_BASE_UNIT_MISMATCH"));

        long baseId = newSource();
        int base = service.createDraft(baseId, null, userId).version();
        replace(baseId, base, draftWithUnits(UNIT_BASE, UNIT_BASE));
        service.publish(baseId, base, LocalDate.of(2026, 1, 1), userId);
        assertThat(service.getVersion(baseId, base).status()).isEqualTo("published");
    }

    @Test
    @DisplayName("М-6: повтор имени листа xlsx без учёта регистра и пробелов — UPL_SHEET_NAME_DUPLICATE")
    void duplicateSheetNameRejected() {
        long id = newSource();
        int version = service.createDraft(id, null, userId).version();
        List<Sheet> valid = validDraft().sheets();
        replace(id, version, new DraftData(FileKind.XLSX, null, null, MatchBy.HEADER, List.of(
                renamed(valid.get(0), "Лист"), renamed(valid.get(1), " лист "))));
        assertThat(publishErrors(id, version)).contains(new FieldErrorItem(
                "sheets[1].sheetName", "UPL_SHEET_NAME_DUPLICATE", "UPL_SHEET_NAME_DUPLICATE"));
    }

    @Test
    @DisplayName("С-4, AC-6: два одновременных черновика — один успех и один FND_VERSION_DRAFT_EXISTS")
    void concurrentDraftsYieldOneConflict() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            long id = newSource();
            assertOneWinner(() -> service.createDraft(id, null, userId), "FND_VERSION_DRAFT_EXISTS");
        }
    }

    @Test
    @DisplayName("М-5, С-5: две одновременные публикации — одна успешна, вторая UPL_FORMAT_NOT_DRAFT")
    void concurrentPublishYieldsNotDraft() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            long id = newSource();
            int version = service.createDraft(id, null, userId).version();
            replace(id, version, validDraft());
            assertOneWinner(() -> {
                service.publish(id, version, LocalDate.of(2026, 1, 1), userId);
                return null;
            }, "UPL_FORMAT_NOT_DRAFT");
            assertThat(service.getVersion(id, version).status()).isEqualTo("published");
        }
    }

    @Test
    @DisplayName("М-4: версии несуществующего источника — UPL_SOURCE_NOT_FOUND")
    void versionsOfMissingSource() {
        assertApi(() -> service.getVersion(-1, 1), ErrorCode.NOT_FOUND, "UPL_SOURCE_NOT_FOUND");
        assertApi(() -> service.createDraft(-1, null, userId), ErrorCode.NOT_FOUND, "UPL_SOURCE_NOT_FOUND");
        assertApi(() -> service.publish(-1, 1, LocalDate.of(2026, 1, 1), userId),
                ErrorCode.NOT_FOUND, "UPL_SOURCE_NOT_FOUND");
    }

    @Test
    @DisplayName("М-3: пустой курсор — первая страница")
    void blankCursorIsFirstPage() {
        newSource();
        for (String cursor : List.of("", " ")) {
            KeysetPage<SourceSummary> page = service.listSources(50, cursor);
            assertThat(page.items()).as("cursor '%s'", cursor).isNotEmpty();
        }
    }

    /** Запускает вызов из двух потоков одновременно: ровно один успех, второй — CONFLICT с {@code loserDetail}. */
    private static void assertOneWinner(Callable<?> call, String loserDetail) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Callable<Object> task = () -> {
                start.await();
                return call.call();
            };
            List<Future<Object>> futures = List.of(pool.submit(task), pool.submit(task));
            start.countDown();
            int succeeded = 0;
            List<Throwable> failures = new ArrayList<>();
            for (Future<Object> future : futures) {
                try {
                    future.get(60, TimeUnit.SECONDS);
                    succeeded++;
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
            assertThat(succeeded).as("успешных вызовов, ошибки: %s", failures).isEqualTo(1);
            assertThat(failures).singleElement().isInstanceOfSatisfying(ApiException.class, e -> {
                assertThat(e.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
                assertThat(e.getMessage()).isEqualTo(loserDetail);
            });
        } finally {
            pool.shutdownNow();
        }
    }

    private static DraftData draftWithUnits(String sourceUnit, String baseUnit) {
        List<Sheet> valid = validDraft().sheets();
        Sheet first = valid.get(0);
        Column amount = withUnits(first.columns().get(1), sourceUnit, baseUnit);
        Sheet changed = new Sheet(null, 0, first.sheetName(), first.headerRow(), first.totalRowMarker(),
                List.of(first.columns().get(0), amount));
        return new DraftData(null, null, null, null, List.of(changed, valid.get(1)));
    }

    private static Sheet renamed(Sheet s, String name) {
        return new Sheet(null, 0, name, s.headerRow(), s.totalRowMarker(), s.columns());
    }

    private void ensureUnit(String code, String base) {
        if (units.findUnit(code).isEmpty()) {
            units.registerUnit(code, Map.of("uz", "TEST"), base, actors.system());
        }
    }

    private long newSource() {
        return service.createSource(data(newCode()), userId).source().id();
    }

    private void replace(long id, int version, DraftData d) {
        service.replaceDraft(id, version, service.getVersion(id, version).lockVersion(), d, userId);
    }

    private List<FieldErrorItem> publishErrors(long id, int version) {
        List<FieldErrorItem> errors = new ArrayList<>();
        assertThatThrownBy(() -> service.publish(id, version, LocalDate.of(2026, 1, 1), userId))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED);
                    assertThat(e.getMessage()).isEqualTo("UPL_FORMAT_INVALID");
                    errors.addAll(e.getFieldErrors());
                });
        return errors;
    }

    private static DraftData validDraft() {
        return new DraftData(null, null, null, null, List.of(
                new Sheet(null, 0, "TEST sheet 1", 2, "TEST total", List.of(
                        col("TEST key", "object_key", DataType.OBJECT_KEY, null, null, "^[0-9]{9}$", 9, 1, null),
                        withUnits(col("TEST amount", "amount", DataType.NUMBER, null, null, null, null, null, null),
                                UNIT_PART, UNIT_BASE))),
                new Sheet(null, 0, "TEST sheet 2", 1, null, List.of(
                        col("TEST key", "object_key", DataType.OBJECT_KEY, null, null, "^[0-9]{9}$", null, null, null),
                        col("TEST code", "ref_value", DataType.REF_CODE, null, null, null, null, null, "test.book")))));
    }

    /** Колонка без единиц измерения; {@code sourceUnit} — только для случая «единица у не-числа». */
    private static Column col(String name, String target, DataType type, Integer position, String sourceUnit,
                              String mask, Integer padLength, Integer padMax, String refBook) {
        return new Column(null, 0, position, name, target, type, false, sourceUnit, null,
                mask, padLength, padMax, refBook);
    }

    private static Column withUnits(Column c, String sourceUnit, String baseUnit) {
        return new Column(c.id(), c.ordinal(), c.filePosition(), c.nameInFile(), c.targetField(), c.dataType(),
                c.required(), sourceUnit, baseUnit, c.keyMask(), c.keyPadLength(), c.keyPadMax(), c.refBookCode());
    }

    /** Листы без идентификаторов строк — для сравнения копии с оригиналом. */
    private static List<Sheet> withoutIds(List<Sheet> sheets) {
        return sheets.stream().map(s -> new Sheet(null, s.ordinal(), s.sheetName(), s.headerRow(),
                s.totalRowMarker(), s.columns().stream().map(c -> new Column(null, c.ordinal(), c.filePosition(),
                        c.nameInFile(), c.targetField(), c.dataType(), c.required(), c.sourceUnit(), c.baseUnit(),
                        c.keyMask(), c.keyPadLength(), c.keyPadMax(), c.refBookCode())).toList())).toList();
    }

    private static List<String> codes(List<FieldErrorItem> errors) {
        return errors.stream().map(FieldErrorItem::code).toList();
    }

    private static Set<Long> ids(FormatVersion v) {
        Set<Long> ids = new HashSet<>();
        for (Sheet s : v.sheets()) {
            ids.add(s.id());
            s.columns().forEach(c -> ids.add(c.id()));
        }
        return ids;
    }

    private static void assertApi(ThrowingCallable call, ErrorCode code, String message) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(code);
            if (message != null) {
                assertThat(e.getMessage()).isEqualTo(message);
            }
        });
    }

    private static SourceData data(String code) {
        return new SourceData(code, "TEST source", "TEST org", null, Periodicity.MONTH, 5, null, null);
    }

    private static String newCode() {
        return "test.svc." + UUID.randomUUID().toString().substring(0, 8);
    }
}
