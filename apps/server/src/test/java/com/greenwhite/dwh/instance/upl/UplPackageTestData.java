package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Общие данные тестов пакета загрузки: источник с опубликованной анкетой и синтетические xlsx
 * под ту же анкету, что в {@link UplXlsxParserTest}. Значения — только слова {@code TEST} и числа.
 */
public final class UplPackageTestData {

    /** Имя листа анкеты и файла. */
    public static final String SHEET = "TEST лист";
    /** Тип содержимого xlsx, который принимает хранилище каркаса. */
    public static final String XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final String BAD_KEY = "TEST-BAD";
    private static final List<String> HEADER = List.of("№", "Ключ", "Название", "Сумма", "Дата");
    private static final List<String> HEADER_BROKEN = List.of("№", "Ключ", "Название", "Лишняя", "Дата");

    private UplPackageTestData() {
    }

    /** Черновик анкеты: один лист, шапка во второй строке, пять колонок. */
    public static DraftData draft() {
        List<Column> columns = List.of(
                column(1, "№", "row_no", DataType.INTEGER, true),
                keyColumn(2),
                column(3, "Название", "org_name", DataType.TEXT, false),
                column(4, "Сумма", "amount", DataType.NUMBER, false),
                column(5, "Дата", "doc_date", DataType.DATE, false));
        return new DraftData(null, null, null, null,
                List.of(new Sheet(null, 0, SHEET, 2, "Итого", columns)));
    }

    /** Заводит источник, наполняет черновик и публикует его с указанной даты; возвращает id источника. */
    public static long publishedSource(UplSourceService service, long userId, LocalDate validFrom) {
        SourceData data = new SourceData("test.pkg." + UUID.randomUUID().toString().substring(0, 8),
                "TEST source", "TEST org", null, Periodicity.MONTH, 5, null, null);
        long sourceId = service.createSource(data, userId).source().id();
        int version = service.createDraft(sourceId, null, userId).version();
        int lockVersion = service.getVersion(sourceId, version).lockVersion();
        service.replaceDraft(sourceId, version, lockVersion, draft(), userId);
        service.publish(sourceId, version, validFrom, userId);
        return sourceId;
    }

    /** Файл по анкете: сначала строки с верным ключом, затем строки с ключом не по маске. */
    public static byte[] workbook(int goodRows, int badKeyRows) {
        List<List<Object>> rows = new ArrayList<>();
        for (int number = 1; number <= goodRows; number++) {
            rows.add(row(number, "90000000" + (number % 10), number));
        }
        for (int number = 1; number <= badKeyRows; number++) {
            rows.add(row(goodRows + number, BAD_KEY, goodRows + number));
        }
        return UplXlsxFixtures.workbook(new SheetSpec(SHEET, 2, HEADER, rows));
    }

    /** Файл с расхождениями анкеты: нет колонки «Сумма», зато есть лишняя. */
    public static byte[] brokenStructure() {
        List<List<Object>> rows = List.of(
                row(1, "900000001", 1),
                row(2, "900000002", 2));
        return UplXlsxFixtures.workbook(new SheetSpec(SHEET, 2, HEADER_BROKEN, rows));
    }

    private static List<Object> row(int number, String key, int name) {
        return Arrays.asList(number, key, "TEST орг " + name, 10.5, "31.12.2026");
    }

    private static Column column(int position, String nameInFile, String targetField, DataType type,
                                 boolean required) {
        return new Column(null, 0, position, nameInFile, targetField, type, required,
                null, null, null, null, null, null);
    }

    private static Column keyColumn(int position) {
        return new Column(null, 0, position, "Ключ", "object_key", DataType.OBJECT_KEY, true,
                null, null, KEY_MASK, 9, 1, null);
    }
}
