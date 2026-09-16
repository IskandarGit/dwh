package com.greenwhite.dwh.instance.upl.api;

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
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Strictness;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.SourceView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/** Запросы и ответы API анкеты файла (контракт И3). Перечисления — строки в нижнем регистре, как в БД. */
public final class UplSourceDtos {

    private UplSourceDtos() {
    }

    private static <E, R> R mapOrNull(E value, Function<E, R> mapper) {
        return value == null ? null : mapper.apply(value);
    }

    public record SourceRequest(
            @NotBlank @Size(max = 63) String code,
            @NotBlank @Size(max = 200) String name,
            @NotBlank @Size(max = 200) String ownerOrg,
            @Size(max = 200) String ownerContact,
            @NotNull @Pattern(regexp = "month|quarter|year|adhoc") String periodicity,
            @Min(0) @Max(366) int slaDays,
            @Pattern(regexp = "file") String sourceType,
            @Pattern(regexp = "error|warning") String reconciliationStrictness,
            @PositiveOrZero Integer lockVersion) {

        public SourceData toData() {
            return new SourceData(code, name, ownerOrg, ownerContact, Periodicity.fromDb(periodicity), slaDays,
                    mapOrNull(sourceType, SourceType::fromDb),
                    mapOrNull(reconciliationStrictness, Strictness::fromDb));
        }
    }

    public record SourceItem(long id, String code, String name, String periodicity,
                             Integer lastPublishedVersion, boolean hasDraft) {

        public static SourceItem of(SourceSummary s) {
            return new SourceItem(s.id(), s.code(), s.name(), mapOrNull(s.periodicity(), Periodicity::db),
                    s.lastPublishedVersion(), s.hasDraft());
        }
    }

    public record SourceResponse(long id, String code, String name, String ownerOrg, String ownerContact,
                                 String periodicity, int slaDays, String sourceType, String reconciliationStrictness,
                                 int lockVersion, Integer lastPublishedVersion, boolean hasDraft,
                                 Instant createdAt, Instant modifiedAt) {

        public static SourceResponse of(SourceView v) {
            var s = v.source();
            return new SourceResponse(s.id(), s.code(), s.name(), s.ownerOrg(), s.ownerContact(),
                    mapOrNull(s.periodicity(), Periodicity::db), s.slaDays(),
                    mapOrNull(s.sourceType(), SourceType::db), mapOrNull(s.strictness(), Strictness::db),
                    s.lockVersion(), v.lastPublishedVersion(), v.hasDraft(), s.createdAt(), s.modifiedAt());
        }
    }

    public record VersionItem(int version, String status, LocalDate validFrom, LocalDate validTo,
                              Instant publishedAt, String publishedBy) {

        public static VersionItem of(FormatVersion v) {
            return new VersionItem(v.version(), v.status(), v.validFrom(), v.validTo(),
                    v.publishedAt(), v.publishedBy());
        }
    }

    public record ColumnDto(
            Long id,
            Integer ordinal,
            @Positive Integer filePosition,
            @NotBlank @Size(max = 200) String nameInFile,
            @NotNull @Pattern(regexp = "[a-z][a-z0-9_]{0,62}") String targetField,
            @NotNull @Pattern(regexp = "text|integer|number|date|object_key|ref_code") String dataType,
            boolean required,
            String sourceUnit,
            String baseUnit,
            String keyMask,
            @Positive Integer keyPadLength,
            @Positive Integer keyPadMax,
            String refBookCode) {

        /** Порядок колонки берётся из позиции в списке (контракт: {@code ordinal} = позиция), id назначает БД. */
        public Column toModel(int position) {
            return new Column(null, position, filePosition, nameInFile, targetField, DataType.fromDb(dataType),
                    required, sourceUnit, baseUnit, keyMask, keyPadLength, keyPadMax, refBookCode);
        }

        public static ColumnDto of(Column c) {
            return new ColumnDto(c.id(), c.ordinal(), c.filePosition(), c.nameInFile(), c.targetField(),
                    mapOrNull(c.dataType(), DataType::db), c.required(), c.sourceUnit(), c.baseUnit(),
                    c.keyMask(), c.keyPadLength(), c.keyPadMax(), c.refBookCode());
        }
    }

    public record SheetDto(
            Long id,
            Integer ordinal,
            String sheetName,
            @Min(1) int headerRow,
            String totalRowMarker,
            @NotNull List<@Valid ColumnDto> columns) {

        /** Порядок листа и колонок берётся из позиции в списке, id назначает БД. */
        public Sheet toModel(int position) {
            List<Column> models = new ArrayList<>(columns.size());
            for (int i = 0; i < columns.size(); i++) {
                models.add(columns.get(i).toModel(i + 1));
            }
            return new Sheet(null, position, sheetName, headerRow, totalRowMarker, List.copyOf(models));
        }

        public static SheetDto of(Sheet s) {
            return new SheetDto(s.id(), s.ordinal(), s.sheetName(), s.headerRow(), s.totalRowMarker(),
                    s.columns() == null ? List.of() : s.columns().stream().map(ColumnDto::of).toList());
        }
    }

    public record FormatDraftRequest(
            @NotNull @PositiveOrZero Integer lockVersion,
            @Pattern(regexp = "xlsx|csv") String fileKind,
            String encoding,
            @Size(min = 1, max = 1) String delimiter,
            @Pattern(regexp = "header|position") String matchColumnsBy,
            @NotNull List<@Valid SheetDto> sheets) {

        public DraftData toData() {
            List<Sheet> models = new ArrayList<>(sheets.size());
            for (int i = 0; i < sheets.size(); i++) {
                models.add(sheets.get(i).toModel(i + 1));
            }
            return new DraftData(mapOrNull(fileKind, FileKind::fromDb), encoding, delimiter,
                    mapOrNull(matchColumnsBy, MatchBy::fromDb), List.copyOf(models));
        }
    }

    public record FormatVersionResponse(long sourceId, int version, String status, LocalDate validFrom,
                                        LocalDate validTo, Instant publishedAt, String publishedBy, int lockVersion,
                                        String fileKind, String encoding, String delimiter, String matchColumnsBy,
                                        List<SheetDto> sheets) {

        public static FormatVersionResponse of(FormatVersion v) {
            return new FormatVersionResponse(v.sourceId(), v.version(), v.status(), v.validFrom(), v.validTo(),
                    v.publishedAt(), v.publishedBy(), v.lockVersion(), mapOrNull(v.fileKind(), FileKind::db),
                    v.encoding(), v.delimiter(), mapOrNull(v.matchColumnsBy(), MatchBy::db),
                    v.sheets() == null ? List.of() : v.sheets().stream().map(SheetDto::of).toList());
        }
    }

    public record CreateDraftRequest(@Positive Integer copyFrom) {
    }

    public record PublishRequest(@NotNull LocalDate validFrom) {
    }
}
