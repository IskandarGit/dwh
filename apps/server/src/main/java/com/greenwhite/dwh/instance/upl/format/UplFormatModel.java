package com.greenwhite.dwh.instance.upl.format;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;

/** Модель анкеты файла: источник, версия формата, листы и колонки (таблицы V111). */
public final class UplFormatModel {

    private UplFormatModel() {
    }

    private static String toDb(Enum<?> value) {
        return value.name().toLowerCase(Locale.ROOT);
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value) {
        if (value == null) {
            throw new IllegalArgumentException("Пустое значение для " + type.getSimpleName());
        }
        return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
    }

    public enum Periodicity {
        MONTH, QUARTER, YEAR, ADHOC;

        public String db() {
            return toDb(this);
        }

        public static Periodicity fromDb(String v) {
            return parse(Periodicity.class, v);
        }
    }

    public enum SourceType {
        FILE;

        public String db() {
            return toDb(this);
        }

        public static SourceType fromDb(String v) {
            return parse(SourceType.class, v);
        }
    }

    public enum Strictness {
        ERROR, WARNING;

        public String db() {
            return toDb(this);
        }

        public static Strictness fromDb(String v) {
            return parse(Strictness.class, v);
        }
    }

    public enum FileKind {
        XLSX, CSV;

        public String db() {
            return toDb(this);
        }

        public static FileKind fromDb(String v) {
            return parse(FileKind.class, v);
        }
    }

    public enum MatchBy {
        HEADER, POSITION;

        public String db() {
            return toDb(this);
        }

        public static MatchBy fromDb(String v) {
            return parse(MatchBy.class, v);
        }
    }

    public enum DataType {
        TEXT, INTEGER, NUMBER, DATE, OBJECT_KEY, REF_CODE;

        public String db() {
            return toDb(this);
        }

        public static DataType fromDb(String v) {
            return parse(DataType.class, v);
        }
    }

    public record SourceData(String code, String name, String ownerOrg, String ownerContact,
                             Periodicity periodicity, int slaDays, SourceType sourceType, Strictness strictness) {
    }

    public record Source(long id, String code, String name, String ownerOrg, String ownerContact,
                         Periodicity periodicity, int slaDays, SourceType sourceType, Strictness strictness,
                         int lockVersion, Instant createdAt, String createdBy, Instant modifiedAt, String modifiedBy) {
    }

    public record SourceSummary(long id, String code, String name, Periodicity periodicity,
                                Integer lastPublishedVersion, boolean hasDraft) {
    }

    public record Column(Long id, int ordinal, Integer filePosition, String nameInFile, String targetField,
                         DataType dataType, boolean required, String sourceUnit, String baseUnit,
                         String keyMask, Integer keyPadLength, Integer keyPadMax, String refBookCode) {
    }

    public record Sheet(Long id, int ordinal, String sheetName, int headerRow, String totalRowMarker,
                        List<Column> columns) {
    }

    public record FormatVersion(long sourceId, int version, LocalDate validFrom, LocalDate validTo, String status,
                                Instant publishedAt, String publishedBy, int lockVersion, FileKind fileKind,
                                String encoding, String delimiter, MatchBy matchColumnsBy, List<Sheet> sheets) {

        public FormatVersion withSheets(List<Sheet> s) {
            return new FormatVersion(sourceId, version, validFrom, validTo, status, publishedAt, publishedBy,
                    lockVersion, fileKind, encoding, delimiter, matchColumnsBy, s);
        }
    }
}
