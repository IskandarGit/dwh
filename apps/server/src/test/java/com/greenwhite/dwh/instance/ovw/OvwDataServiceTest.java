package com.greenwhite.dwh.instance.ovw;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.ovw.OvwModel.ColumnItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.FilterItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsResult;
import com.greenwhite.dwh.instance.ovw.OvwModel.Layout;
import com.greenwhite.dwh.instance.ovw.OvwModel.PackageItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsPage;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.SourceItem;
import com.greenwhite.dwh.instance.ovw.service.OvwDataService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

/** Сервис обзора данных: применённые пакеты, раскладка по анкете, строки, группы и ошибки запроса (контракт И14). */
class OvwDataServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate JAN_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);
    private static final LocalDate FEB_FROM = LocalDate.of(2026, 2, 1);
    private static final LocalDate FEB_TO = LocalDate.of(2026, 2, 28);
    private static final Path OVW_MAIN = Path.of("src/main/java/com/greenwhite/dwh/instance/ovw");
    private static final Pattern WRITE_SQL =
            Pattern.compile("insert\\s+into|update\\s+\\w+\\s+set|delete\\s+from", Pattern.CASE_INSENSITIVE);

    @Autowired
    private OvwDataService service;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private MfFileService files;
    @Autowired
    private ModuleRegistryService modules;
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

    @AfterEach
    void enableModule() {
        setModule(true);
    }

    @Test
    @DisplayName("AC-2: видны только применённые пакеты, из двух пакетов одного периода — последний")
    void layoutShowsLatestAppliedPackagePerPeriod() {
        PackageRow january = applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);
        verifiedPackage(UplPackageTestData.workbook(2, 0), JAN_FROM, JAN_TO);
        PackageRow broken = parsedPackage(UplPackageTestData.brokenStructure(), JAN_FROM, JAN_TO);
        assertThat(broken.status()).isEqualTo(UplPackageModel.REJECTED);
        applied(UplPackageTestData.workbook(5, 0), FEB_FROM, FEB_TO);
        PackageRow february = applied(UplPackageTestData.workbook(4, 0), FEB_FROM, FEB_TO);

        Layout layout = service.layout(sourceId, null);

        assertThat(layout.packages()).extracting(PackageItem::periodFrom).containsExactly(JAN_FROM, FEB_FROM);
        assertThat(layout.rowsTotal()).isEqualTo((long) january.rawRows() + february.rawRows()).isEqualTo(14);
        assertThat(layout.formatVersion()).isEqualTo(1);
        assertThat(service.sources()).extracting(SourceItem::id).contains(sourceId);

        long emptySource = UplPackageTestData.publishedSource(sources, userId, LocalDate.of(2026, 1, 1));
        assertThat(service.sources()).extracting(SourceItem::id).doesNotContain(emptySource);
        Layout empty = service.layout(emptySource, null);
        assertThat(empty.packages()).isEmpty();
        assertThat(empty.rowsTotal()).isZero();
        assertThat(empty.columns()).hasSize(5);
    }

    @Test
    @DisplayName("AC-3: колонки листа — по анкете: порядок, подписи, типы и признак суммирования")
    void layoutColumnsFollowFormat() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);

        List<ColumnItem> columns = service.layout(sourceId, null).columns();

        assertThat(columns).extracting(ColumnItem::field)
                .containsExactly("row_no", "object_key", "org_name", "amount", "doc_date");
        assertThat(columns).extracting(ColumnItem::label).containsExactly("№", "Ключ", "Название", "Сумма", "Дата");
        assertThat(columns).extracting(ColumnItem::type)
                .containsExactly("integer", "object_key", "text", "number", "date");
        assertThat(columns).extracting(ColumnItem::summable).containsExactly(true, false, false, true, false);
    }

    @Test
    @DisplayName("AC-4/AC-5: строки страницей с адресом в файле, фильтр «между» сужает выборку")
    void rowsPageWithAddressAndBetweenFilter() {
        PackageRow january = applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);
        long rowsTotal = service.layout(sourceId, null).rowsTotal();

        RowsPage page = service.rows(sourceId, new RowsQuery(null, List.of(), null, null));

        assertThat(page.total()).isEqualTo(rowsTotal).isEqualTo(10);
        assertThat(page.offset()).isZero();
        assertThat(page.limit()).isEqualTo(OvwLimits.PAGE_SIZE);
        assertThat(page.items()).hasSize(10).allSatisfy(item -> {
            assertThat(item.excelRow()).isNotNull();
            assertThat(item.file()).isEqualTo(january.fileName());
            assertThat(item.sheet()).isEqualTo(UplPackageTestData.SHEET);
        });

        assertThat(total(new FilterItem("amount", "between", null, "10", "11"))).isEqualTo(10);
        assertThat(total(new FilterItem("amount", "between", null, "11", null))).isZero();
        assertThat(total(new FilterItem("row_no", "between", null, "1", "3"))).isEqualTo(3);
    }

    @Test
    @DisplayName("AC-4/AC-5: неверный запрос — 422 с кодом у поля")
    void invalidQueryIsRejectedWithFieldCode() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);

        assertInvalid(() -> rows(List.of(new FilterItem("amount", "contains", "1", null, null)), null),
                "filters[0]", OvwErrors.OVW_FILTER_OP);
        assertInvalid(() -> rows(List.of(new FilterItem("TEST_unknown", "eq", "1", null, null)), null),
                "filters[0]", OvwErrors.OVW_COLUMN_UNKNOWN);
        List<FilterItem> tooMany = Collections.nCopies(OvwLimits.MAX_FILTERS + 1,
                new FilterItem("org_name", "contains", "TEST", null, null));
        assertInvalid(() -> rows(tooMany, null), "filters", OvwErrors.OVW_FILTER_TOO_MANY);
        assertInvalid(() -> rows(List.of(), 7), "offset", OvwErrors.OVW_PAGE_INVALID);
        assertInvalid(() -> rows(List.of(), OvwLimits.PAGE_SIZE), "offset", OvwErrors.OVW_PAGE_INVALID);
        assertInvalid(() -> service.layout(sourceId, 99), "sheet", OvwErrors.OVW_SHEET_UNKNOWN);
    }

    @Test
    @DisplayName("AC-5: неверное значение фильтра — 422 OVW_FILTER_VALUE у поля")
    void invalidFilterValueIsRejected() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);
        String tooLong = "TEST".repeat(51).substring(0, OvwLimits.MAX_FILTER_VALUE_LENGTH + 1);

        assertFilterValueRejected(new FilterItem("amount", "between", null, "abc", null));
        assertFilterValueRejected(new FilterItem("amount", "between", null, "11", "10"));
        assertFilterValueRejected(new FilterItem("doc_date", "between", null, "2026-01-31", "2026-01-01"));
        assertFilterValueRejected(new FilterItem("doc_date", "between", null, "2024-02-30", null));
        assertFilterValueRejected(new FilterItem("org_name", "contains", "", null, null));
        assertFilterValueRejected(new FilterItem("org_name", "contains", tooLong, null, null));
        assertFilterValueRejected(new FilterItem("amount", "between", null, "1e-20000", null));
        assertFilterValueRejected(new FilterItem("amount", "between", null, null, "1E+200000"));
        assertFilterValueRejected(new FilterItem("amount", "eq", "1e5", null, null));
    }

    @Test
    @DisplayName("группа по числу длиннее границы «от–до» открывается, а не 422")
    void longNumberGroupIsAccepted() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);
        String longNumber = "0." + "0".repeat(39) + "1";

        String veryLongNumber = "1".repeat(1500);

        RowsPage page = rows(List.of(new FilterItem("amount", "eq", longNumber, null, null)), null);
        RowsPage veryLongPage = rows(List.of(new FilterItem("amount", "eq", veryLongNumber, null, null)), null);

        assertThat(page.total()).isZero();
        assertThat(veryLongPage.total()).isZero();
    }

    @Test
    @DisplayName("С-3: группа с текстом длиннее предела фильтра открывает свои строки")
    void longTextGroupOpensItsRows() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);
        String longText = "TEST".repeat(63).substring(0, 250);
        long loadId = dwhJdbc.sql("select distinct load_id from raw.rows").query(Long.class).single();
        dwhJdbc.sql("update raw.rows set fields = jsonb_set(fields, '{org_name}', to_jsonb(:v::text))"
                        + " where load_id = :id and row_no = (select min(row_no) from raw.rows where load_id = :id)")
                .param("v", longText)
                .param("id", loadId)
                .update();

        GroupsResult groups = service.groups(sourceId, new GroupsQuery(null, List.of(), "org_name"));
        String groupValue = groups.groups().stream()
                .map(GroupItem::value)
                .filter(longText::equals)
                .findFirst()
                .orElseThrow();

        RowsPage page = rows(List.of(new FilterItem("org_name", "eq", groupValue, null, null)), null);

        assertThat(page.total()).isEqualTo(1);
    }

    @Test
    @DisplayName("AC-6: сумма групп сходится с итогом по числу строк и по сумме")
    void groupsAddUpToTotal() {
        applied(UplPackageTestData.workbook(7, 3), JAN_FROM, JAN_TO);

        GroupsResult result = service.groups(sourceId, new GroupsQuery(null, List.of(), "org_name"));

        assertThat(result.groups()).isNotEmpty();
        assertThat(result.groupsShown()).isEqualTo(result.groups().size()).isEqualTo(result.groupsTotal());
        long count = result.groups().stream().mapToLong(GroupItem::count).sum();
        BigDecimal amount = result.groups().stream()
                .map(group -> new BigDecimal(group.sums().get("amount")))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(count).isEqualTo(result.total().count()).isEqualTo(10);
        assertThat(amount).isEqualByComparingTo(new BigDecimal(result.total().sums().get("amount")));
    }

    @Test
    @DisplayName("Ошибки: нет источника — 404, модуль выключен — 400")
    void missingSourceAndDisabledModule() {
        assertThatThrownBy(() -> service.layout(-1, null)).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(404);
            assertThat(e.getMessage()).isEqualTo(OvwErrors.OVW_SOURCE_NOT_FOUND);
        });

        setModule(false);

        assertThatThrownBy(() -> service.sources()).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.BAD_REQUEST);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(400);
            assertThat(e.getMessage()).isEqualTo(OvwErrors.OVW_MODULE_DISABLED);
        });
    }

    @Test
    @DisplayName("Модуль только читает: в коде ovw нет SQL записи")
    void moduleHasNoWriteSql() throws IOException {
        List<Path> sourcesOfModule;
        try (Stream<Path> tree = Files.walk(OVW_MAIN)) {
            sourcesOfModule = tree.filter(path -> path.toString().endsWith(".java")).toList();
        }
        assertThat(sourcesOfModule).isNotEmpty();
        for (Path file : sourcesOfModule) {
            assertThat(WRITE_SQL.matcher(Files.readString(file, StandardCharsets.UTF_8)).find())
                    .as(file.toString()).isFalse();
        }
    }

    // ---------- помощники ----------

    private long total(FilterItem filter) {
        return rows(List.of(filter), null).total();
    }

    private RowsPage rows(List<FilterItem> filters, Integer offset) {
        return service.rows(sourceId, new RowsQuery(null, filters, null, offset));
    }

    private PackageRow applied(byte[] content, LocalDate from, LocalDate to) {
        PackageRow row = verifiedPackage(content, from, to);
        PackageRow applied = applies.apply(row.publicId().toString(), userId);
        assertThat(applied.status()).isEqualTo(UplPackageModel.APPLIED);
        return applied;
    }

    private PackageRow verifiedPackage(byte[] content, LocalDate from, LocalDate to) {
        PackageRow row = parsedPackage(content, from, to);
        assertThat(row.status()).isEqualTo(UplPackageModel.VERIFIED);
        return row;
    }

    private PackageRow parsedPackage(byte[] content, LocalDate from, LocalDate to) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, from, to, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        return packages.get(row.publicId().toString());
    }

    private void setModule(boolean enable) {
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            modules.toggleModuleStatus("ovw", enable);
        });
    }

    private void assertFilterValueRejected(FilterItem filter) {
        assertInvalid(() -> rows(List.of(filter), null), "filters[0]", OvwErrors.OVW_FILTER_VALUE);
    }

    private static void assertInvalid(ThrowingCallable call, String field, String code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(422);
            assertThat(e.getMessage()).isEqualTo(OvwErrors.OVW_QUERY_INVALID);
            assertThat(e.getFieldErrors()).extracting(FieldErrorItem::field, FieldErrorItem::code)
                    .containsExactly(tuple(field, code));
        });
    }
}
