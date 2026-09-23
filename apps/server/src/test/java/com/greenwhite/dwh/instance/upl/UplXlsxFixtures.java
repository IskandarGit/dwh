package com.greenwhite.dwh.instance.upl;

import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Сборка синтетических xlsx прямо в памяти: двоичных файлов в репозитории нет.
 * Значения ячеек — только слова {@code TEST} и числа.
 */
public final class UplXlsxFixtures {

    private UplXlsxFixtures() {
    }

    /**
     * Лист файла: имя, номер строки шапки (как в Excel, с 1), тексты шапки и строки данных
     * сразу под шапкой. В строке данных {@code String} — текст, {@code Number} — число,
     * {@code null} — ячейки нет.
     */
    public record SheetSpec(String name, int headerRow, List<String> header, List<List<Object>> rows) {
    }

    /** Собирает книгу из листов и отдаёт её байтами. */
    public static byte[] workbook(SheetSpec... sheets) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (Workbook book = new Workbook(bytes, "TEST", "1.0")) {
            for (SheetSpec spec : sheets) {
                Worksheet sheet = book.newWorksheet(spec.name());
                writeRow(sheet, spec.headerRow() - 1, spec.header());
                int rowIndex = spec.headerRow();
                for (List<Object> row : spec.rows()) {
                    writeRow(sheet, rowIndex, row);
                    rowIndex++;
                }
            }
        } catch (IOException failure) {
            throw new UncheckedIOException("Не удалось собрать тестовый xlsx", failure);
        }
        return bytes.toByteArray();
    }

    /** Файл, который не является книгой Excel. */
    public static byte[] notExcel() {
        return "TEST not excel".getBytes(StandardCharsets.UTF_8);
    }

    private static void writeRow(Worksheet sheet, int rowIndex, List<?> values) {
        for (int column = 0; column < values.size(); column++) {
            Object value = values.get(column);
            if (value == null) {
                continue;
            }
            if (value instanceof String text) {
                sheet.value(rowIndex, column, text);
            } else if (value instanceof Number number) {
                sheet.value(rowIndex, column, number);
            } else {
                throw new IllegalArgumentException("Тестовая ячейка неподдерживаемого типа: "
                        + value.getClass().getName());
            }
        }
    }
}
