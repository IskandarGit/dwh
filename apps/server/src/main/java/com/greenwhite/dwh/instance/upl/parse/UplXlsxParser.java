package com.greenwhite.dwh.instance.upl.parse;

import com.greenwhite.dwh.instance.upl.UplLimits;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult.ErrorRecord;
import org.dhatim.fastexcel.reader.Cell;
import org.dhatim.fastexcel.reader.CellType;
import org.dhatim.fastexcel.reader.ExcelReaderException;
import org.dhatim.fastexcel.reader.ReadableWorkbook;
import org.dhatim.fastexcel.reader.Row;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.ToIntFunction;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Разбор xlsx-файла пакета по опубликованной анкете. Читает файл потоком за два прохода:
 * сначала структура (листы и колонки), потом значения. В базу и в журнал не пишет ничего —
 * итог возвращается в памяти.
 */
@Component
public class UplXlsxParser {

    /** Файл отклонён: расхождения с анкетой. */
    public static final String UPL_PKG_STRUCTURE = "UPL_PKG_STRUCTURE";
    /** Файл отклонён: не читается как xlsx. */
    public static final String UPL_PKG_UNREADABLE = "UPL_PKG_UNREADABLE";
    /** Файл отклонён: заполненных ячеек больше предела загрузки. */
    public static final String UPL_PKG_TOO_MANY_CELLS = "UPL_PKG_TOO_MANY_CELLS";
    /** Расхождение с анкетой: листа нет в файле. */
    public static final String UPL_STRUCT_SHEET_MISSING = "UPL_STRUCT_SHEET_MISSING";
    /** Расхождение с анкетой: колонки анкеты нет в шапке. */
    public static final String UPL_STRUCT_COLUMN_MISSING = "UPL_STRUCT_COLUMN_MISSING";
    /** Расхождение с анкетой: в шапке колонка, которой нет в анкете. */
    public static final String UPL_STRUCT_COLUMN_UNKNOWN = "UPL_STRUCT_COLUMN_UNKNOWN";
    /** Ошибка ячейки: обязательное значение пусто. */
    public static final String UPL_CELL_REQUIRED = "UPL_CELL_REQUIRED";
    /** Ошибка ячейки: не целое число. */
    public static final String UPL_CELL_NOT_INTEGER = "UPL_CELL_NOT_INTEGER";
    /** Ошибка ячейки: не число. */
    public static final String UPL_CELL_NOT_NUMBER = "UPL_CELL_NOT_NUMBER";
    /** Ошибка ячейки: не дата. */
    public static final String UPL_CELL_NOT_DATE = "UPL_CELL_NOT_DATE";
    /** Ошибка ячейки: ключ объекта учёта не подходит под маску анкеты. */
    public static final String UPL_CELL_KEY_MASK = "UPL_CELL_KEY_MASK";

    private static final Pattern INTEGER_TEXT = Pattern.compile("-?\\d+");
    private static final Pattern NUMBER_TEXT = Pattern.compile("-?\\d+([.,]\\d+)?");
    private static final DateTimeFormatter ISO_DATE =
            DateTimeFormatter.ofPattern("uuuu-MM-dd").withResolverStyle(ResolverStyle.STRICT);
    private static final DateTimeFormatter DOTTED_DATE =
            DateTimeFormatter.ofPattern("dd.MM.uuuu").withResolverStyle(ResolverStyle.STRICT);
    private static final CellValue EMPTY_CELL = new CellValue(null, false);

    private final long maxCells;

    @Autowired
    public UplXlsxParser() {
        this(UplLimits.MAX_CELLS);
    }

    public UplXlsxParser(long maxCells) {
        this.maxCells = maxCells;
    }

    /** Разбирает файл по анкете. Поток закрывает вызывающий. */
    public UplParseResult parse(InputStream content, FormatVersion format) {
        return parse(content, format, row -> { });
    }

    /**
     * Разбирает файл по анкете; строки данных (с ошибками тоже, без пустых и итоговых) отдаёт в {@code rows}
     * в порядке листов анкеты и строк. Поток закрывает вызывающий.
     */
    public UplParseResult parse(InputStream content, FormatVersion format, Consumer<DataRow> rows) {
        try (ReadableWorkbook book = new ReadableWorkbook(content)) {
            List<ErrorRecord> structure = new ArrayList<>();
            List<SheetMatch> sheets = matchStructure(book, format, structure);
            if (!structure.isEmpty()) {
                return UplParseResult.rejected(UPL_PKG_STRUCTURE, Map.of("count", structure.size()),
                        structure.size(), stored(structure));
            }
            return readValues(sheets, rows);
        } catch (IOException | ExcelReaderException unreadable) {
            return UplParseResult.rejected(UPL_PKG_UNREADABLE, Map.of(), 0, List.of());
        }
    }

    // --- проход 1: структура ---

    private List<SheetMatch> matchStructure(ReadableWorkbook book, FormatVersion format,
                                            List<ErrorRecord> errors) throws IOException {
        List<org.dhatim.fastexcel.reader.Sheet> inFile = book.getSheets().toList();
        List<SheetMatch> matched = new ArrayList<>();
        for (Sheet spec : ordered(format.sheets(), Sheet::ordinal)) {
            Optional<org.dhatim.fastexcel.reader.Sheet> found = findSheet(inFile, spec.sheetName());
            if (found.isEmpty()) {
                errors.add(new ErrorRecord(spec.sheetName(), null, null, null, UPL_STRUCT_SHEET_MISSING,
                        Map.of("sheet", spec.sheetName())));
                continue;
            }
            List<String> header = headerTexts(found.get(), spec.headerRow());
            matched.add(new SheetMatch(spec, found.get(), matchColumns(spec, header, matchBy(format), errors)));
        }
        return matched;
    }

    private Optional<org.dhatim.fastexcel.reader.Sheet> findSheet(List<org.dhatim.fastexcel.reader.Sheet> inFile,
                                                                  String name) {
        for (org.dhatim.fastexcel.reader.Sheet sheet : inFile) {
            if (sheet.getName().equals(name)) {
                return Optional.of(sheet);
            }
        }
        String wanted = normalized(name);
        for (org.dhatim.fastexcel.reader.Sheet sheet : inFile) {
            if (normalized(sheet.getName()).equals(wanted)) {
                return Optional.of(sheet);
            }
        }
        return Optional.empty();
    }

    /** Тексты ячеек шапки после {@code strip}; {@code null} — пустая ячейка. Строки нет — шапка пустая. */
    private List<String> headerTexts(org.dhatim.fastexcel.reader.Sheet file, int headerRow) throws IOException {
        try (Stream<Row> rows = file.openStream()) {
            Optional<Row> header = rows.filter(row -> row.getRowNum() == headerRow).findFirst();
            if (header.isEmpty()) {
                return List.of();
            }
            Row row = header.get();
            List<String> texts = new ArrayList<>();
            for (int index = 0; index < row.getCellCount(); index++) {
                String text = cellValue(row, index).text();
                texts.add(text == null ? null : text.strip());
            }
            return texts;
        }
    }

    private List<ColumnMatch> matchColumns(Sheet spec, List<String> header, MatchBy matchBy,
                                           List<ErrorRecord> errors) {
        return matchBy == MatchBy.POSITION
                ? matchByPosition(spec, header, errors)
                : matchByHeader(spec, header, errors);
    }

    private List<ColumnMatch> matchByHeader(Sheet spec, List<String> header, List<ErrorRecord> errors) {
        List<ColumnMatch> matched = new ArrayList<>();
        Set<String> known = new HashSet<>();
        for (Column column : ordered(spec.columns(), Column::ordinal)) {
            known.add(normalized(column.nameInFile()));
            int index = indexOfHeader(header, column.nameInFile());
            if (index < 0) {
                errors.add(structureError(spec, column.nameInFile(), UPL_STRUCT_COLUMN_MISSING));
                continue;
            }
            matched.add(new ColumnMatch(column, index));
        }
        for (String text : header) {
            if (text != null && !known.contains(normalized(text))) {
                errors.add(structureError(spec, text, UPL_STRUCT_COLUMN_UNKNOWN));
            }
        }
        return matched;
    }

    private List<ColumnMatch> matchByPosition(Sheet spec, List<String> header, List<ErrorRecord> errors) {
        List<ColumnMatch> matched = new ArrayList<>();
        Set<Integer> described = new HashSet<>();
        for (Column column : ordered(spec.columns(), Column::ordinal)) {
            int index = column.filePosition() == null ? -1 : column.filePosition() - 1;
            described.add(index);
            if (index < 0 || index >= header.size() || header.get(index) == null) {
                errors.add(structureError(spec, column.nameInFile(), UPL_STRUCT_COLUMN_MISSING));
                continue;
            }
            matched.add(new ColumnMatch(column, index));
        }
        for (int index = 0; index < header.size(); index++) {
            if (header.get(index) != null && !described.contains(index)) {
                errors.add(structureError(spec, header.get(index), UPL_STRUCT_COLUMN_UNKNOWN));
            }
        }
        return matched;
    }

    private int indexOfHeader(List<String> header, String nameInFile) {
        String wanted = normalized(nameInFile);
        for (int index = 0; index < header.size(); index++) {
            if (header.get(index) != null && normalized(header.get(index)).equals(wanted)) {
                return index;
            }
        }
        return -1;
    }

    private ErrorRecord structureError(Sheet spec, String column, String code) {
        return new ErrorRecord(spec.sheetName(), null, column, null, code,
                Map.of("sheet", spec.sheetName(), "column", column, "headerRow", spec.headerRow()));
    }

    // --- проход 2: значения ---

    private UplParseResult readValues(List<SheetMatch> sheets, Consumer<DataRow> rows) throws IOException {
        long cells = 0;
        int total = 0;
        int rejected = 0;
        int errorsTotal = 0;
        List<ErrorRecord> errors = new ArrayList<>();
        for (SheetMatch sheet : sheets) {
            try (Stream<Row> fileRows = sheet.file().openStream()) {
                Iterator<Row> reader = fileRows.iterator();
                while (reader.hasNext()) {
                    Row row = reader.next();
                    cells += filledCells(row);
                    if (cells > maxCells) {
                        return UplParseResult.rejected(UPL_PKG_TOO_MANY_CELLS, Map.of("limit", maxCells),
                                0, List.of());
                    }
                    if (row.getRowNum() <= sheet.spec().headerRow()) {
                        continue;
                    }
                    List<CellValue> values = rowValues(row, sheet.columns());
                    if (skipped(values, sheet.spec().totalRowMarker())) {
                        continue;
                    }
                    total++;
                    rows.accept(dataRow(sheet, row.getRowNum(), values));
                    List<ErrorRecord> rowErrors = checkRow(sheet, row.getRowNum(), values);
                    if (!rowErrors.isEmpty()) {
                        rejected++;
                        errorsTotal += rowErrors.size();
                        appendStored(errors, rowErrors);
                    }
                }
            }
        }
        return UplParseResult.verified(total, rejected, errorsTotal, errors);
    }

    /** Пустая строка и итоговая строка не считаются строками данных и ошибок не дают. */
    private boolean skipped(List<CellValue> values, String totalRowMarker) {
        boolean empty = true;
        boolean total = false;
        String marker = totalRowMarker == null ? null : normalized(totalRowMarker);
        for (CellValue value : values) {
            if (value.text() == null) {
                continue;
            }
            empty = false;
            if (marker != null && !marker.isEmpty() && normalized(value.text()).startsWith(marker)) {
                total = true;
            }
        }
        return empty || total;
    }

    private List<ErrorRecord> checkRow(SheetMatch sheet, int rowNo, List<CellValue> values) {
        List<ErrorRecord> errors = new ArrayList<>();
        List<ColumnMatch> columns = sheet.columns();
        for (int index = 0; index < columns.size(); index++) {
            Column column = columns.get(index).column();
            CellValue value = values.get(index);
            String code = check(column, value);
            if (code != null) {
                errors.add(new ErrorRecord(sheet.spec().sheetName(), rowNo, column.nameInFile(),
                        shortened(value.text()), code, Map.of()));
            }
        }
        return errors;
    }

    /** Одна ячейка даёт не больше одной записи об ошибке; {@code null} — ошибки нет. */
    private String check(Column column, CellValue value) {
        if (value.text() == null) {
            return column.required() ? UPL_CELL_REQUIRED : null;
        }
        return switch (column.dataType()) {
            case TEXT, REF_CODE -> null;
            case INTEGER -> checkInteger(value);
            case NUMBER -> checkNumber(value);
            case DATE -> checkDate(value);
            case OBJECT_KEY -> checkKey(column, value);
        };
    }

    private String checkInteger(CellValue value) {
        BigDecimal number = numberOf(value);
        if (number != null) {
            return number.stripTrailingZeros().scale() <= 0 ? null : UPL_CELL_NOT_INTEGER;
        }
        return INTEGER_TEXT.matcher(value.text().strip()).matches() ? null : UPL_CELL_NOT_INTEGER;
    }

    private String checkNumber(CellValue value) {
        if (numberOf(value) != null) {
            return null;
        }
        return NUMBER_TEXT.matcher(value.text().strip()).matches() ? null : UPL_CELL_NOT_NUMBER;
    }

    private String checkDate(CellValue value) {
        if (numberOf(value) != null) {
            return null;
        }
        String text = value.text().strip();
        return isDate(text, ISO_DATE) || isDate(text, DOTTED_DATE) ? null : UPL_CELL_NOT_DATE;
    }

    private boolean isDate(String text, DateTimeFormatter formatter) {
        try {
            LocalDate.parse(text, formatter);
            return true;
        } catch (DateTimeParseException wrongFormat) {
            return false;
        }
    }

    private String checkKey(Column column, CellValue value) {
        String key = value.text().strip();
        BigDecimal number = numberOf(value);
        if (number != null) {
            if (number.stripTrailingZeros().scale() > 0) {
                return UPL_CELL_KEY_MASK;
            }
            key = number.toBigInteger().toString();
        }
        if (column.keyMask() == null) {
            return null;
        }
        String candidate = padded(key, column.keyPadLength(), column.keyPadMax());
        return Pattern.matches(column.keyMask(), candidate) ? null : UPL_CELL_KEY_MASK;
    }

    /** Дополнение нулями слева — только для сравнения с маской; в файле ключ остаётся как есть. */
    private String padded(String key, Integer padLength, Integer padMax) {
        if (padLength == null || key.length() >= padLength) {
            return key;
        }
        int missing = padLength - key.length();
        if (padMax != null && missing > padMax) {
            return key;
        }
        return "0".repeat(missing) + key;
    }

    private BigDecimal numberOf(CellValue value) {
        if (!value.numeric()) {
            return null;
        }
        try {
            return new BigDecimal(value.text().strip());
        } catch (NumberFormatException notANumber) {
            return null;
        }
    }

    // --- чтение ячеек и мелкие помощники ---

    private List<CellValue> rowValues(Row row, List<ColumnMatch> columns) {
        List<CellValue> values = new ArrayList<>(columns.size());
        for (ColumnMatch column : columns) {
            values.add(cellValue(row, column.index()));
        }
        return values;
    }

    private static DataRow dataRow(SheetMatch sheet, int rowNo, List<CellValue> values) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (int index = 0; index < sheet.columns().size(); index++) {
            fields.put(sheet.columns().get(index).column().targetField(), values.get(index).text());
        }
        return new DataRow(sheet.spec().sheetName(), rowNo, fields);
    }

    private int filledCells(Row row) {
        int filled = 0;
        for (int index = 0; index < row.getCellCount(); index++) {
            if (cellValue(row, index).text() != null) {
                filled++;
            }
        }
        return filled;
    }

    private CellValue cellValue(Row row, int index) {
        if (index < 0 || index >= row.getCellCount()) {
            return EMPTY_CELL;
        }
        Cell cell = row.getCell(index);
        if (cell == null || cell.getType() == CellType.EMPTY) {
            return EMPTY_CELL;
        }
        String text = cell.getType() == CellType.STRING ? cell.getText() : cell.getRawValue();
        if (text == null || text.isBlank()) {
            return EMPTY_CELL;
        }
        return new CellValue(text, cell.getType() == CellType.NUMBER);
    }

    private void appendStored(List<ErrorRecord> stored, List<ErrorRecord> found) {
        for (ErrorRecord error : found) {
            if (stored.size() >= UplLimits.MAX_STORED_ERRORS) {
                return;
            }
            stored.add(error);
        }
    }

    private List<ErrorRecord> stored(List<ErrorRecord> found) {
        return found.size() <= UplLimits.MAX_STORED_ERRORS
                ? List.copyOf(found)
                : List.copyOf(found.subList(0, UplLimits.MAX_STORED_ERRORS));
    }

    private String shortened(String value) {
        if (value == null || value.length() <= UplLimits.MAX_VALUE_LENGTH) {
            return value;
        }
        return value.substring(0, UplLimits.MAX_VALUE_LENGTH);
    }

    private static String normalized(String text) {
        return text.strip().toLowerCase(Locale.ROOT);
    }

    private static MatchBy matchBy(FormatVersion format) {
        return format.matchColumnsBy() == null ? MatchBy.HEADER : format.matchColumnsBy();
    }

    private static <T> List<T> ordered(List<T> items, ToIntFunction<T> ordinal) {
        List<T> sorted = new ArrayList<>(items);
        sorted.sort(Comparator.comparingInt(ordinal));
        return sorted;
    }

    /** Строка данных как в файле: лист, № строки Excel и значения по полям анкеты ({@code null} — пустая ячейка). */
    public record DataRow(String sheet, int sourceRowNo, Map<String, Object> fields) {
    }

    /** Значение ячейки: текст как в файле ({@code null} — пусто) и признак числовой ячейки. */
    private record CellValue(String text, boolean numeric) {
    }

    /** Сопоставленный лист: описание из анкеты, лист файла и колонки с индексами в файле. */
    private record SheetMatch(Sheet spec, org.dhatim.fastexcel.reader.Sheet file, List<ColumnMatch> columns) {
    }

    /** Колонка анкеты и её индекс в файле (с 0). */
    private record ColumnMatch(Column column, int index) {
    }
}
