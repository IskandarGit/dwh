package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.upl.UplPackageTestData;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures;
import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Данные тестов сводного отчёта: источник и справочник с опубликованными анкетами (один лист) и применённые пакеты
 * с выдуманными строками. Не бин Spring: тест создаёт его из своих сервисов. Значения — только TEST и числа.
 */
public final class RptTestData {

    /** Лист анкеты источника и его файла. */
    public static final String SOURCE_SHEET = "TEST данные";
    /** Лист анкеты справочника и его файла. */
    public static final String REF_SHEET = "TEST справочник";
    /** Дата начала действия анкет. */
    public static final LocalDate VALID_FROM = LocalDate.of(2026, 1, 1);

    public static final String DATE = "dt";
    public static final String AMOUNT = "amount";
    public static final String QTY = "qty";
    public static final String CODE = "code";
    public static final String GROUP = "grp";
    public static final String OBJECT = "okey";
    public static final String REF_CODE = "rcode";
    public static final String REF_NAME = "rname";

    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final List<String> SOURCE_HEADER =
            List.of("Ключ TEST", "Дата TEST", "Сумма TEST", "Количество TEST", "Код TEST", "Группа TEST");
    private static final List<String> REF_HEADER = List.of("Ключ TEST", "Код справочника TEST", "Название TEST");

    private final UplSourceService sources;
    private final UplPackageService packages;
    private final UplParseJob parseJob;
    private final UplApplyService applies;
    private final MfFileService files;
    private final long userId;

    public RptTestData(UplSourceService sources, UplPackageService packages, UplParseJob parseJob,
                       UplApplyService applies, MfFileService files, long userId) {
        this.sources = sources;
        this.packages = packages;
        this.parseJob = parseJob;
        this.applies = applies;
        this.files = files;
        this.userId = userId;
    }

    /** Строка файла источника: дата текстом «дд.мм.гггг» или null, сумма, количество, код связи, группа. */
    public record SourceRow(String date, Number amount, Integer qty, String code, String group) { }

    /** Строка файла справочника: код связи и название. */
    public record RefRow(String code, String name) { }

    /** Источник с опубликованной анкетой: ключ объекта, дата, сумма, количество, код, группа. */
    public long publishedSource() {
        return published("test.rpt.src.", "TEST источник", new Sheet(null, 0, SOURCE_SHEET, 1, null, List.of(
                keyColumn(1),
                column(2, "Дата TEST", DATE, DataType.DATE),
                column(3, "Сумма TEST", AMOUNT, DataType.NUMBER),
                column(4, "Количество TEST", QTY, DataType.INTEGER),
                column(5, "Код TEST", CODE, DataType.TEXT),
                column(6, "Группа TEST", GROUP, DataType.TEXT))));
    }

    /** Справочник с опубликованной анкетой: ключ объекта, код, название. */
    public long publishedRef() {
        return published("test.rpt.ref.", "TEST справочник", new Sheet(null, 0, REF_SHEET, 1, null, List.of(
                keyColumn(1),
                column(2, "Код справочника TEST", REF_CODE, DataType.TEXT),
                column(3, "Название TEST", REF_NAME, DataType.TEXT))));
    }

    /** Применённый пакет источника за период. */
    public PackageRow applySource(long sourceId, List<SourceRow> rows, LocalDate from, LocalDate to) {
        List<List<Object>> cells = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            SourceRow row = rows.get(i);
            cells.add(Arrays.asList(objectKey(i), row.date(), row.amount(), row.qty(), row.code(), row.group()));
        }
        return apply(sourceId, UplXlsxFixtures.workbook(new SheetSpec(SOURCE_SHEET, 1, SOURCE_HEADER, cells)),
                from, to);
    }

    /** Применённый пакет справочника за период. */
    public PackageRow applyRef(long refId, List<RefRow> rows, LocalDate from, LocalDate to) {
        List<List<Object>> cells = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            RefRow row = rows.get(i);
            cells.add(Arrays.asList(objectKey(i), row.code(), row.name()));
        }
        return apply(refId, UplXlsxFixtures.workbook(new SheetSpec(REF_SHEET, 1, REF_HEADER, cells)), from, to);
    }

    private PackageRow apply(long sourceId, byte[] content, LocalDate from, LocalDate to) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, from, to, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        PackageRow parsed = packages.get(row.publicId().toString());
        if (!UplPackageModel.VERIFIED.equals(parsed.status())) {
            throw new IllegalStateException("Тестовый пакет не прошёл проверку: " + parsed.status());
        }
        PackageRow applied = applies.apply(parsed.publicId().toString(), userId);
        if (!UplPackageModel.APPLIED.equals(applied.status())) {
            throw new IllegalStateException("Тестовый пакет не применён: " + applied.status());
        }
        return applied;
    }

    private long published(String codePrefix, String name, Sheet sheet) {
        SourceData data = new SourceData(codePrefix + UUID.randomUUID().toString().substring(0, 8), name,
                "TEST org", null, Periodicity.MONTH, 5, null, null);
        long sourceId = sources.createSource(data, userId).source().id();
        int version = sources.createDraft(sourceId, null, userId).version();
        int lockVersion = sources.getVersion(sourceId, version).lockVersion();
        sources.replaceDraft(sourceId, version, lockVersion,
                new DraftData(null, null, null, null, List.of(sheet)), userId);
        sources.publish(sourceId, version, VALID_FROM, userId);
        return sourceId;
    }

    private static String objectKey(int index) {
        return String.format("9%08d", index + 1);
    }

    private static Column column(int position, String nameInFile, String targetField, DataType type) {
        return new Column(null, 0, position, nameInFile, targetField, type, false,
                null, null, null, null, null, null);
    }

    private static Column keyColumn(int position) {
        return new Column(null, 0, position, "Ключ TEST", OBJECT, DataType.OBJECT_KEY, true,
                null, null, KEY_MASK, 9, 1, null);
    }
}
