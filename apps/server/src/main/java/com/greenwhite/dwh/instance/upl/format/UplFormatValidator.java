package com.greenwhite.dwh.instance.upl.format;

import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService.FndUnit;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/** Проверки анкеты перед публикацией (контракт И3, «Ошибки»): собирает все нарушения сразу. */
@Component
public class UplFormatValidator {

    public static final String UPL_NO_SHEETS = "UPL_NO_SHEETS";
    public static final String UPL_CSV_ONE_SHEET = "UPL_CSV_ONE_SHEET";
    public static final String UPL_CSV_ENCODING_REQUIRED = "UPL_CSV_ENCODING_REQUIRED";
    public static final String UPL_CSV_DELIMITER_REQUIRED = "UPL_CSV_DELIMITER_REQUIRED";
    public static final String UPL_XLSX_NO_CSV_PARAMS = "UPL_XLSX_NO_CSV_PARAMS";
    public static final String UPL_SHEET_NO_COLUMNS = "UPL_SHEET_NO_COLUMNS";
    public static final String UPL_SHEET_NAME_REQUIRED = "UPL_SHEET_NAME_REQUIRED";
    public static final String UPL_SHEET_NAME_DUPLICATE = "UPL_SHEET_NAME_DUPLICATE";
    public static final String UPL_OBJECT_KEY_COUNT = "UPL_OBJECT_KEY_COUNT";
    public static final String UPL_COLUMN_NAME_DUPLICATE = "UPL_COLUMN_NAME_DUPLICATE";
    public static final String UPL_TARGET_FIELD_DUPLICATE = "UPL_TARGET_FIELD_DUPLICATE";
    public static final String UPL_KEY_MASK_REQUIRED = "UPL_KEY_MASK_REQUIRED";
    public static final String UPL_KEY_MASK_INVALID = "UPL_KEY_MASK_INVALID";
    public static final String UPL_KEY_RULE_NOT_KEY = "UPL_KEY_RULE_NOT_KEY";
    public static final String UPL_KEY_PAD_MAX_WITHOUT_LENGTH = "UPL_KEY_PAD_MAX_WITHOUT_LENGTH";
    public static final String UPL_UNIT_NOT_NUMERIC = "UPL_UNIT_NOT_NUMERIC";
    public static final String UPL_BASE_UNIT_REQUIRED = "UPL_BASE_UNIT_REQUIRED";
    public static final String UPL_UNIT_UNKNOWN = "UPL_UNIT_UNKNOWN";
    public static final String UPL_BASE_UNIT_MISMATCH = "UPL_BASE_UNIT_MISMATCH";
    public static final String UPL_REF_BOOK_REQUIRED = "UPL_REF_BOOK_REQUIRED";
    public static final String UPL_REF_BOOK_NOT_REF = "UPL_REF_BOOK_NOT_REF";
    public static final String UPL_POSITION_REQUIRED = "UPL_POSITION_REQUIRED";
    public static final String UPL_POSITION_DUPLICATE = "UPL_POSITION_DUPLICATE";

    private final FndUnitService units;

    public UplFormatValidator(FndUnitService units) {
        this.units = units;
    }

    /** Все нарушения анкеты; пустой список — версию можно публиковать. */
    public List<FieldErrorItem> validate(FormatVersion v) {
        List<FieldErrorItem> errors = new ArrayList<>();
        checkVersion(v, errors);
        List<Sheet> sheets = v.sheets() == null ? List.of() : v.sheets();
        Set<String> sheetNames = new HashSet<>();
        for (int i = 0; i < sheets.size(); i++) {
            String path = "sheets[" + i + "]";
            checkSheet(v, sheets.get(i), path, errors);
            checkSheetNameUnique(v, sheets.get(i), path, sheetNames, errors);
        }
        return errors;
    }

    private void checkVersion(FormatVersion v, List<FieldErrorItem> errors) {
        int sheetCount = v.sheets() == null ? 0 : v.sheets().size();
        if (sheetCount == 0) {
            add(errors, "sheets", UPL_NO_SHEETS);
        }
        if (v.fileKind() == FileKind.CSV) {
            if (sheetCount > 1) {
                add(errors, "sheets", UPL_CSV_ONE_SHEET);
            }
            if (v.encoding() == null) {
                add(errors, "encoding", UPL_CSV_ENCODING_REQUIRED);
            }
            if (v.delimiter() == null) {
                add(errors, "delimiter", UPL_CSV_DELIMITER_REQUIRED);
            }
        } else {
            if (v.encoding() != null) {
                add(errors, "encoding", UPL_XLSX_NO_CSV_PARAMS);
            }
            if (v.delimiter() != null) {
                add(errors, "delimiter", UPL_XLSX_NO_CSV_PARAMS);
            }
        }
    }

    private void checkSheet(FormatVersion v, Sheet sheet, String path, List<FieldErrorItem> errors) {
        List<Column> columns = sheet.columns() == null ? List.of() : sheet.columns();
        if (columns.isEmpty()) {
            add(errors, path + ".columns", UPL_SHEET_NO_COLUMNS);
        }
        if (v.fileKind() != FileKind.CSV && isBlank(sheet.sheetName())) {
            add(errors, path + ".sheetName", UPL_SHEET_NAME_REQUIRED);
        }
        long keys = columns.stream().filter(c -> c.dataType() == DataType.OBJECT_KEY).count();
        if (!columns.isEmpty() && keys != 1) {
            add(errors, path + ".columns", UPL_OBJECT_KEY_COUNT);
        }
        Set<String> names = new HashSet<>();
        Set<String> targets = new HashSet<>();
        Set<Integer> positions = new HashSet<>();
        for (int j = 0; j < columns.size(); j++) {
            Column c = columns.get(j);
            String colPath = path + ".columns[" + j + "]";
            checkDuplicates(c, colPath, names, targets, errors);
            checkKeyRules(c, colPath, errors);
            checkUnits(c, colPath, errors);
            checkRefBook(c, colPath, errors);
            checkPosition(v, c, colPath, positions, errors);
        }
    }

    private static void checkSheetNameUnique(FormatVersion v, Sheet sheet, String path, Set<String> seen,
                                             List<FieldErrorItem> errors) {
        if (v.fileKind() == FileKind.CSV || isBlank(sheet.sheetName())) {
            return;
        }
        if (!seen.add(sheet.sheetName().strip().toLowerCase(Locale.ROOT))) {
            add(errors, path + ".sheetName", UPL_SHEET_NAME_DUPLICATE);
        }
    }

    private void checkDuplicates(Column c, String path, Set<String> names, Set<String> targets,
                                 List<FieldErrorItem> errors) {
        if (c.nameInFile() != null && !names.add(c.nameInFile().strip().toLowerCase(Locale.ROOT))) {
            add(errors, path + ".nameInFile", UPL_COLUMN_NAME_DUPLICATE);
        }
        if (c.targetField() != null && !targets.add(c.targetField())) {
            add(errors, path + ".targetField", UPL_TARGET_FIELD_DUPLICATE);
        }
    }

    private void checkKeyRules(Column c, String path, List<FieldErrorItem> errors) {
        if (c.dataType() == DataType.OBJECT_KEY) {
            checkKeyMask(c.keyMask(), path, errors);
        } else if (c.keyMask() != null || c.keyPadLength() != null || c.keyPadMax() != null) {
            add(errors, path + ".keyMask", UPL_KEY_RULE_NOT_KEY);
        }
        if (c.keyPadMax() != null && c.keyPadLength() == null) {
            add(errors, path + ".keyPadMax", UPL_KEY_PAD_MAX_WITHOUT_LENGTH);
        }
    }

    private void checkKeyMask(String mask, String path, List<FieldErrorItem> errors) {
        if (isBlank(mask)) {
            add(errors, path + ".keyMask", UPL_KEY_MASK_REQUIRED);
            return;
        }
        try {
            Pattern.compile(mask);
        } catch (PatternSyntaxException e) {
            add(errors, path + ".keyMask", UPL_KEY_MASK_INVALID);
        }
    }

    private void checkUnits(Column c, String path, List<FieldErrorItem> errors) {
        if (c.sourceUnit() == null && c.baseUnit() == null) {
            return;
        }
        if (c.dataType() != DataType.INTEGER && c.dataType() != DataType.NUMBER) {
            add(errors, path + ".sourceUnit", UPL_UNIT_NOT_NUMERIC);
            return;
        }
        if (c.sourceUnit() != null && c.baseUnit() == null) {
            add(errors, path + ".baseUnit", UPL_BASE_UNIT_REQUIRED);
        }
        Optional<FndUnit> source = findUnit(c.sourceUnit(), path + ".sourceUnit", errors);
        Optional<FndUnit> base = findUnit(c.baseUnit(), path + ".baseUnit", errors);
        if (source.isPresent() && base.isPresent() && !c.baseUnit().equals(baseOf(source.get()))) {
            add(errors, path + ".baseUnit", UPL_BASE_UNIT_MISMATCH);
        }
    }

    private static String baseOf(FndUnit unit) {
        return Objects.requireNonNullElse(unit.baseUnitCode(), unit.code());
    }

    private Optional<FndUnit> findUnit(String code, String field, List<FieldErrorItem> errors) {
        if (code == null) {
            return Optional.empty();
        }
        Optional<FndUnit> unit = units.findUnit(code);
        if (unit.isEmpty()) {
            add(errors, field, UPL_UNIT_UNKNOWN);
        }
        return unit;
    }

    private void checkRefBook(Column c, String path, List<FieldErrorItem> errors) {
        if (c.dataType() == DataType.REF_CODE && isBlank(c.refBookCode())) {
            add(errors, path + ".refBookCode", UPL_REF_BOOK_REQUIRED);
        } else if (c.dataType() != DataType.REF_CODE && c.refBookCode() != null) {
            add(errors, path + ".refBookCode", UPL_REF_BOOK_NOT_REF);
        }
    }

    private void checkPosition(FormatVersion v, Column c, String path, Set<Integer> positions,
                               List<FieldErrorItem> errors) {
        if (v.matchColumnsBy() != MatchBy.POSITION) {
            return;
        }
        if (c.filePosition() == null) {
            add(errors, path + ".filePosition", UPL_POSITION_REQUIRED);
        } else if (!positions.add(c.filePosition())) {
            add(errors, path + ".filePosition", UPL_POSITION_DUPLICATE);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static void add(List<FieldErrorItem> errors, String field, String code) {
        errors.add(new FieldErrorItem(field, code, code));
    }
}
