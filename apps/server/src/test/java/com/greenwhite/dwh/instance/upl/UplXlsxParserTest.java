package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.upl.UplXlsxFixtures.SheetSpec;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult.ErrorRecord;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/** Разбор xlsx по анкете: структура, значения, счётчики и пределы. */
class UplXlsxParserTest {

    private static final String SHEET = "TEST лист";
    private static final String KEY_MASK = "^[0-9]{9}$";
    private static final List<String> HEADER = List.of("№", "Ключ", "Название", "Сумма", "Дата");

    private final UplXlsxParser parser = new UplXlsxParser();

    @Test
    @DisplayName("Чистый файл: все строки приняты, ошибок нет")
    void cleanFileIsVerified() {
        UplParseResult result = parse(file(HEADER, cleanRows(5)), format());

        assertThat(result.outcome()).isEqualTo(UplParseResult.Outcome.VERIFIED);
        assertThat(result.rowsTotal()).isEqualTo(5);
        assertThat(result.rowsAccepted()).isEqualTo(5);
        assertThat(result.rowsRejected()).isZero();
        assertThat(result.errorsTotal()).isZero();
        assertThat(result.errors()).isEmpty();
        assertThat(result.rejectCode()).isNull();
    }

    @Test
    @DisplayName("Ключ объекта учёта: не подходит под маску — ошибка, нехватка одного знака — нет")
    void keyMaskIsChecked() {
        List<List<Object>> rows = List.of(
                row(1, "12345", "TEST орг", 10.5, "31.12.2026"),
                row(2, 1234567, "TEST орг", 10.5, "31.12.2026"),
                row(3, "12345678X", "TEST орг", 10.5, "31.12.2026"),
                row(4, 12345678, "TEST орг", 10.5, "31.12.2026"),
                row(5, "900000005", "TEST орг", 10.5, "31.12.2026"));

        UplParseResult result = parse(file(HEADER, rows), format());

        assertThat(result.rowsTotal()).isEqualTo(5);
        assertThat(result.rowsAccepted()).isEqualTo(2);
        assertThat(result.rowsRejected()).isEqualTo(3);
        assertThat(result.errors()).hasSize(3)
                .allSatisfy(error -> {
                    assertThat(error.code()).isEqualTo(UplXlsxParser.UPL_CELL_KEY_MASK);
                    assertThat(error.sheet()).isEqualTo(SHEET);
                    assertThat(error.columnName()).isEqualTo("Ключ");
                });
        assertThat(result.errors()).extracting(ErrorRecord::rowNo).containsExactly(3, 4, 5);
        assertThat(result.errors()).extracting(ErrorRecord::cellValue)
                .containsExactly("12345", "1234567", "12345678X");
    }

    @Test
    @DisplayName("Проверки по типу колонки: обязательное, целое, число, дата")
    void cellTypesAreChecked() {
        List<List<Object>> rows = List.of(
                row(null, "900000001", "TEST орг", 10, 46000),
                row(1.5, "900000002", "TEST орг", "1,5", 46000),
                row("1,5", "900000003", "TEST орг", "-2.25", "31.12.2026"),
                row(4, "900000004", "TEST орг", "abc", "2026-12-31"),
                row(5, "900000005", "TEST орг", 10, "31/12/2026"),
                row(6, "900000006", "TEST орг", 10, "31.02.2026"),
                row(null, "900000007", "TEST орг", "abc", 46000));

        UplParseResult result = parse(file(HEADER, rows), format());

        assertThat(result.rowsTotal()).isEqualTo(7);
        assertThat(result.rowsRejected()).isEqualTo(7);
        assertThat(result.rowsAccepted()).isZero();
        assertThat(result.errorsTotal()).isEqualTo(8);
        assertThat(result.errors()).extracting(ErrorRecord::rowNo, ErrorRecord::columnName, ErrorRecord::code)
                .containsExactly(
                        tuple(3, "№", UplXlsxParser.UPL_CELL_REQUIRED),
                        tuple(4, "№", UplXlsxParser.UPL_CELL_NOT_INTEGER),
                        tuple(5, "№", UplXlsxParser.UPL_CELL_NOT_INTEGER),
                        tuple(6, "Сумма", UplXlsxParser.UPL_CELL_NOT_NUMBER),
                        tuple(7, "Дата", UplXlsxParser.UPL_CELL_NOT_DATE),
                        tuple(8, "Дата", UplXlsxParser.UPL_CELL_NOT_DATE),
                        tuple(9, "№", UplXlsxParser.UPL_CELL_REQUIRED),
                        tuple(9, "Сумма", UplXlsxParser.UPL_CELL_NOT_NUMBER));
        assertThat(result.errors().getFirst().cellValue()).isNull();
    }

    @Test
    @DisplayName("Пустая строка и итоговая строка не считаются и ошибок не дают")
    void emptyAndTotalRowsAreSkipped() {
        List<List<Object>> rows = List.of(
                row(1, "900000001", "TEST орг", 10.5, "31.12.2026"),
                row(2, "900000002", "TEST орг", 10.5, "31.12.2026"),
                row(null, null, null, null, null, "TEST вне анкеты"),
                row(null, null, "  итого по листу", 100, null),
                row(3, "900000003", "TEST орг", 10.5, "31.12.2026"));

        UplParseResult result = parse(file(HEADER, rows), format());

        assertThat(result.rowsTotal()).isEqualTo(3);
        assertThat(result.rowsAccepted()).isEqualTo(3);
        assertThat(result.errorsTotal()).isZero();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    @DisplayName("И6: строки данных отдаются с листом, № строки Excel и значениями как в файле")
    void dataRowsAreStreamedAsInFile() {
        List<List<Object>> rows = List.of(
                row(1, "012345678", "TEST орг", "TEST abc", "31.12.2026"),
                row(2, "900000002", "TEST орг 2", 10.5, "31.12.2026"),
                row(null, null, null, null, null, "TEST вне анкеты"),
                row(null, null, "  итого по листу", 100, null),
                row(3, "900000003", null, 10.5, "31.12.2026"));
        List<UplXlsxParser.DataRow> collected = new ArrayList<>();

        UplParseResult result = parser.parse(new ByteArrayInputStream(file(HEADER, rows)), format(), collected::add);

        assertThat(result.outcome()).isEqualTo(UplParseResult.Outcome.VERIFIED);
        assertThat(result.rowsTotal()).isEqualTo(3);
        assertThat(result.rowsRejected()).isEqualTo(1);
        assertThat(collected).hasSize(result.rowsTotal());
        assertThat(collected).extracting(UplXlsxParser.DataRow::sheet).containsOnly(SHEET);
        assertThat(collected).extracting(UplXlsxParser.DataRow::sourceRowNo).containsExactly(3, 4, 7);
        UplXlsxParser.DataRow first = collected.getFirst();
        assertThat(first.fields().keySet()).containsExactly("row_no", "object_key", "org_name", "amount", "doc_date");
        assertThat(first.fields())
                .containsEntry("object_key", "012345678")
                .containsEntry("org_name", "TEST орг")
                .containsEntry("amount", "TEST abc")
                .containsEntry("doc_date", "31.12.2026");
        assertThat(collected.getLast().fields()).containsEntry("org_name", null);
    }

    @Test
    @DisplayName("Расхождения с анкетой: нет колонки и есть лишняя — файл отклонён, значения не проверяются")
    void structureMismatchRejectsFile() {
        List<String> header = List.of("№", "Ключ", "Название", "Лишняя", "Дата");

        UplParseResult result = parse(file(header, cleanRows(2)), format());

        assertThat(result.outcome()).isEqualTo(UplParseResult.Outcome.REJECTED);
        assertThat(result.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat(result.rejectParams()).isEqualTo(Map.of("count", 2));
        assertThat(result.errorsTotal()).isEqualTo(2);
        assertThat(result.rowsTotal()).isNull();
        assertThat(result.rowsAccepted()).isNull();
        assertThat(result.rowsRejected()).isNull();
        assertThat(result.errors()).hasSize(2).allSatisfy(error -> assertThat(error.rowNo()).isNull());
        assertThat(result.errors()).extracting(ErrorRecord::code, ErrorRecord::columnName)
                .containsExactlyInAnyOrder(
                        tuple(UplXlsxParser.UPL_STRUCT_COLUMN_MISSING, "Сумма"),
                        tuple(UplXlsxParser.UPL_STRUCT_COLUMN_UNKNOWN, "Лишняя"));
    }

    @Test
    @DisplayName("Лист ищется без учёта регистра и пробелов; листа нет — расхождение с анкетой")
    void sheetIsFoundIgnoringCaseAndSpaces() {
        byte[] renamed = UplXlsxFixtures.workbook(new SheetSpec(" test ЛИСТ ", 2, HEADER, cleanRows(5)));

        UplParseResult found = parse(renamed, format());

        assertThat(found.outcome()).isEqualTo(UplParseResult.Outcome.VERIFIED);
        assertThat(found.rowsTotal()).isEqualTo(5);

        byte[] other = UplXlsxFixtures.workbook(new SheetSpec("TEST другой лист", 2, HEADER, cleanRows(1)));

        UplParseResult missing = parse(other, format());

        assertThat(missing.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat(missing.errors()).hasSize(1);
        ErrorRecord error = missing.errors().getFirst();
        assertThat(error.code()).isEqualTo(UplXlsxParser.UPL_STRUCT_SHEET_MISSING);
        assertThat(error.params()).isEqualTo(Map.of("sheet", SHEET));
        assertThat(error.columnName()).isNull();
    }

    @Test
    @DisplayName("Сопоставление по позиции: имена в шапке не сравниваются, пустая и лишняя позиции — расхождения")
    void columnsAreMatchedByPosition() {
        List<Column> columns = List.of(
                column(1, 1, "№", "row_no", DataType.INTEGER, true),
                keyColumn(2, 2),
                column(3, 4, "Сумма", "amount", DataType.NUMBER, false));
        FormatVersion format = format(MatchBy.POSITION, columns);
        List<List<Object>> rows = List.of(row(1, "900000001", null, 10.5));

        UplParseResult byPosition = parse(
                file(Arrays.asList("TEST a", "TEST b", null, "TEST d"), rows), format);

        assertThat(byPosition.outcome()).isEqualTo(UplParseResult.Outcome.VERIFIED);
        assertThat(byPosition.rowsTotal()).isEqualTo(1);
        assertThat(byPosition.rowsAccepted()).isEqualTo(1);

        UplParseResult broken = parse(file(Arrays.asList("TEST a", "TEST b", "TEST c"), rows), format);

        assertThat(broken.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_STRUCTURE);
        assertThat(broken.errors()).extracting(ErrorRecord::code, ErrorRecord::columnName)
                .containsExactlyInAnyOrder(
                        tuple(UplXlsxParser.UPL_STRUCT_COLUMN_MISSING, "Сумма"),
                        tuple(UplXlsxParser.UPL_STRUCT_COLUMN_UNKNOWN, "TEST c"));
    }

    @Test
    @DisplayName("Сохраняются первые 500 записей об ошибках, считаются все")
    void storedErrorsAreLimited() {
        List<List<Object>> rows = new ArrayList<>();
        for (int number = 1; number <= 600; number++) {
            rows.add(row(number, "TEST-BAD", "TEST орг", 10.5, "31.12.2026"));
        }

        UplParseResult result = parse(file(HEADER, rows), format());

        assertThat(result.rowsTotal()).isEqualTo(600);
        assertThat(result.rowsAccepted()).isZero();
        assertThat(result.rowsRejected()).isEqualTo(600);
        assertThat(result.errorsTotal()).isEqualTo(600);
        assertThat(result.errors()).hasSize(500);
    }

    @Test
    @DisplayName("Файл не читается как xlsx — отклонён системой")
    void notExcelFileIsRejected() {
        UplParseResult result = parse(UplXlsxFixtures.notExcel(), format());

        assertThat(result.outcome()).isEqualTo(UplParseResult.Outcome.REJECTED);
        assertThat(result.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_UNREADABLE);
        assertThat(result.errorsTotal()).isZero();
        assertThat(result.errors()).isEmpty();
    }

    @Test
    @DisplayName("Предел ячеек превышен — отклонён; длинное значение в записи обрезано")
    void cellLimitAndValueLength() {
        byte[] content = file(HEADER, cleanRows(5));

        UplParseResult limited = new UplXlsxParser(10).parse(new ByteArrayInputStream(content), format());

        assertThat(limited.outcome()).isEqualTo(UplParseResult.Outcome.REJECTED);
        assertThat(limited.rejectCode()).isEqualTo(UplXlsxParser.UPL_PKG_TOO_MANY_CELLS);
        assertThat(limited.rejectParams()).isEqualTo(Map.of("limit", 10L));

        String longValue = "T".repeat(300);
        UplParseResult result = parse(
                file(HEADER, List.of(row(longValue, "900000001", "TEST орг", 10.5, "31.12.2026"))), format());

        assertThat(result.errors()).hasSize(1);
        assertThat(result.errors().getFirst().code()).isEqualTo(UplXlsxParser.UPL_CELL_NOT_INTEGER);
        assertThat(result.errors().getFirst().cellValue()).hasSize(UplLimits.MAX_VALUE_LENGTH);
    }

    private UplParseResult parse(byte[] content, FormatVersion format) {
        return parser.parse(new ByteArrayInputStream(content), format);
    }

    private static byte[] file(List<String> header, List<List<Object>> rows) {
        return UplXlsxFixtures.workbook(new SheetSpec(SHEET, 2, header, rows));
    }

    private static List<List<Object>> cleanRows(int count) {
        List<List<Object>> rows = new ArrayList<>();
        for (int number = 1; number <= count; number++) {
            rows.add(row(number, "90000000" + number, "TEST орг " + number, 10.5, "31.12.2026"));
        }
        return rows;
    }

    private static List<Object> row(Object... cells) {
        return Arrays.asList(cells);
    }

    private static FormatVersion format() {
        return format(MatchBy.HEADER, List.of(
                column(1, 1, "№", "row_no", DataType.INTEGER, true),
                keyColumn(2, 2),
                column(3, 3, "Название", "org_name", DataType.TEXT, false),
                column(4, 4, "Сумма", "amount", DataType.NUMBER, false),
                column(5, 5, "Дата", "doc_date", DataType.DATE, false)));
    }

    private static FormatVersion format(MatchBy matchBy, List<Column> columns) {
        Sheet sheet = new Sheet(null, 1, SHEET, 2, "Итого", columns);
        return new FormatVersion(1L, 1, LocalDate.of(2026, 1, 1), null, "published", null, null, 1,
                FileKind.XLSX, null, null, matchBy, List.of(sheet));
    }

    private static Column column(int ordinal, int filePosition, String nameInFile, String targetField,
                                 DataType dataType, boolean required) {
        return new Column(null, ordinal, filePosition, nameInFile, targetField, dataType, required,
                null, null, null, null, null, null);
    }

    private static Column keyColumn(int ordinal, int filePosition) {
        return new Column(null, ordinal, filePosition, "Ключ", "object_key", DataType.OBJECT_KEY, true,
                null, null, KEY_MASK, 9, 1, null);
    }
}
