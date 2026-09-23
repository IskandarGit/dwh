package com.greenwhite.dwh.instance.rpt.service;

import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawSpec;
import com.greenwhite.dwh.instance.rpt.RptModel.SheetItem;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.SourceView;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository.AppliedPackage;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Что видит отчёт в источнике (контракт И15а, Ф-3/Ф-4 — правило «Обзора»): показанные загрузки, анкета их наибольшей
 * версии, её листы и колонки выбранного листа. Общий для описания и расчёта отчёта.
 */
@Component
public class RptSourceLayouts {

    private final UplSourceService sources;
    private final UplPackageRepository packages;

    public RptSourceLayouts(UplSourceService sources, UplPackageRepository packages) {
        this.sources = sources;
        this.packages = packages;
    }

    /**
     * Источник глазами отчёта: {@code chosen} — выбранный лист или null, если такого листа нет;
     * {@code columns} — колонки выбранного листа по {@code targetField} в порядке анкеты.
     */
    public record Layout(long sourceId, String sourceName, List<SheetItem> sheets, Sheet chosen,
                         Map<String, Column> columns, List<Long> loadIds, Map<Long, String> fileByLoad) {

        /** Подпись колонки для экрана: название в файле, пустое — поле анкеты. */
        public String label(String field) {
            Column column = columns.get(field);
            if (column == null) {
                return null;
            }
            return column.nameInFile() == null || column.nameInFile().isBlank()
                    ? column.targetField() : column.nameInFile();
        }
    }

    /** Источника нет или у него нет опубликованной анкеты — пусто; {@code sheetOrdinal == null} — первый лист. */
    public Optional<Layout> resolve(long sourceId, Integer sheetOrdinal) {
        Optional<SourceView> view = sourceView(sourceId);
        if (view.isEmpty()) {
            return Optional.empty();
        }
        List<AppliedPackage> shown = packages.appliedPackages(sourceId);
        Integer version = shown.stream().map(AppliedPackage::formatVersion).max(Integer::compare)
                .orElse(view.get().lastPublishedVersion());
        if (version == null) {
            return Optional.empty();
        }
        FormatVersion format = sources.getVersion(sourceId, version);
        List<Sheet> sheets = format.sheets().stream().sorted(Comparator.comparingInt(Sheet::ordinal)).toList();
        List<SheetItem> sheetItems = sheets.stream().map(s -> new SheetItem(s.ordinal(), s.sheetName())).toList();
        Sheet chosen = sheets.stream()
                .filter(s -> sheetOrdinal == null || s.ordinal() == sheetOrdinal)
                .findFirst()
                .orElse(null);
        Map<String, Column> columns = new LinkedHashMap<>();
        if (chosen != null) {
            chosen.columns().stream()
                    .sorted(Comparator.comparingInt(Column::ordinal))
                    .forEach(column -> columns.put(column.targetField(), column));
        }
        Map<Long, String> fileByLoad = new LinkedHashMap<>();
        shown.forEach(p -> fileByLoad.put(p.loadId(), p.fileName()));
        return Optional.of(new Layout(sourceId, view.get().source().name(), sheetItems, chosen, columns,
                List.copyOf(fileByLoad.keySet()), fileByLoad));
    }

    /** Тип значения для чтения raw — как в «Обзоре». */
    public static FndRawSpec.Type rawType(DataType type) {
        return switch (type) {
            case TEXT, OBJECT_KEY, REF_CODE -> FndRawSpec.Type.TEXT;
            case INTEGER, NUMBER -> FndRawSpec.Type.NUMBER;
            case DATE -> FndRawSpec.Type.DATE;
        };
    }

    /** Спецификация чтения выбранного листа; лист не выбран — {@link IllegalArgumentException}. */
    public static FndRawSpec spec(Layout layout) {
        if (layout.chosen() == null) {
            throw new IllegalArgumentException("Лист источника не выбран");
        }
        LinkedHashMap<String, FndRawSpec.Type> types = new LinkedHashMap<>();
        layout.columns().forEach((field, column) -> types.put(field, rawType(column.dataType())));
        return new FndRawSpec(layout.loadIds(), layout.chosen().sheetName(), types);
    }

    private Optional<SourceView> sourceView(long sourceId) {
        try {
            return Optional.of(sources.getSource(sourceId));
        } catch (ApiException notFound) {
            return Optional.empty();
        }
    }
}
