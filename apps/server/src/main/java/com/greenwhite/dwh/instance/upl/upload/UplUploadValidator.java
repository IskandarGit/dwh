package com.greenwhite.dwh.instance.upl.upload;

import com.greenwhite.dwh.core.error.FieldErrorItem;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Проверка полей запроса приёма файла до создания пакета (контракт И5, раздел 8.1).
 * Собирает все ошибки сразу: пользователь исправляет форму за один заход, а не по одной ошибке.
 */
public final class UplUploadValidator {

    /** Источник не выбран или его идентификатор не положительное целое. */
    public static final String UPL_PKG_SOURCE_REQUIRED = "UPL_PKG_SOURCE_REQUIRED";
    /** Нет начала или конца периода либо дата не читается как {@code yyyy-MM-dd}. */
    public static final String UPL_PKG_PERIOD_REQUIRED = "UPL_PKG_PERIOD_REQUIRED";
    /** Начало периода позже конца. */
    public static final String UPL_PKG_PERIOD_ORDER = "UPL_PKG_PERIOD_ORDER";
    /** Файл к запросу не приложен. */
    public static final String UPL_PKG_FILE_REQUIRED = "UPL_PKG_FILE_REQUIRED";
    /** Приложенный файл пустой. */
    public static final String UPL_PKG_FILE_EMPTY = "UPL_PKG_FILE_EMPTY";
    /** Расширение приложенного файла не {@code .xlsx}. */
    public static final String UPL_PKG_FILE_NOT_XLSX = "UPL_PKG_FILE_NOT_XLSX";

    private static final String FIELD_SOURCE = "sourceId";
    private static final String FIELD_PERIOD_FROM = "periodFrom";
    private static final String FIELD_PERIOD_TO = "periodTo";
    private static final String FIELD_FILE = "file";

    private static final String XLSX_SUFFIX = ".xlsx";

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("uuuu-MM-dd")
            .withResolverStyle(ResolverStyle.STRICT);

    private UplUploadValidator() {
    }

    /** Все ошибки полей запроса приёма; пустой список — запрос можно принимать. */
    public static List<FieldErrorItem> validate(String sourceId, String periodFrom, String periodTo,
                                                boolean filePresent, String fileName, long fileSize) {
        List<FieldErrorItem> errors = new ArrayList<>();
        if (!isPositiveNumber(sourceId)) {
            errors.add(new FieldErrorItem(FIELD_SOURCE, UPL_PKG_SOURCE_REQUIRED, "Выберите источник"));
        }
        LocalDate from = parseDate(periodFrom);
        LocalDate to = parseDate(periodTo);
        if (from == null) {
            errors.add(periodRequired(FIELD_PERIOD_FROM));
        }
        if (to == null) {
            errors.add(periodRequired(FIELD_PERIOD_TO));
        }
        if (from != null && to != null && from.isAfter(to)) {
            errors.add(new FieldErrorItem(FIELD_PERIOD_FROM, UPL_PKG_PERIOD_ORDER, "Начало периода позже конца"));
        }
        addFileError(errors, filePresent, fileName, fileSize);
        return List.copyOf(errors);
    }

    private static void addFileError(List<FieldErrorItem> errors, boolean filePresent, String fileName,
                                     long fileSize) {
        if (!filePresent) {
            errors.add(new FieldErrorItem(FIELD_FILE, UPL_PKG_FILE_REQUIRED, "Выберите файл"));
            return;
        }
        if (fileSize == 0) {
            errors.add(new FieldErrorItem(FIELD_FILE, UPL_PKG_FILE_EMPTY, "Файл пустой"));
            return;
        }
        if (!isXlsxName(fileName)) {
            errors.add(new FieldErrorItem(FIELD_FILE, UPL_PKG_FILE_NOT_XLSX,
                    "Нужен файл Excel с расширением .xlsx"));
        }
    }

    private static FieldErrorItem periodRequired(String field) {
        return new FieldErrorItem(field, UPL_PKG_PERIOD_REQUIRED, "Укажите начало и конец периода");
    }

    private static boolean isPositiveNumber(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        try {
            return Long.parseLong(value.strip()) > 0;
        } catch (NumberFormatException notNumber) {
            return false;
        }
    }

    private static boolean isXlsxName(String fileName) {
        return fileName != null && fileName.toLowerCase(Locale.ROOT).endsWith(XLSX_SUFFIX);
    }

    /** Дата строго вида {@code yyyy-MM-dd}; иначе {@code null} — вызывающий превращает это в ошибку поля. */
    private static LocalDate parseDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value.strip(), DATE);
        } catch (DateTimeParseException notDate) {
            return null;
        }
    }
}
