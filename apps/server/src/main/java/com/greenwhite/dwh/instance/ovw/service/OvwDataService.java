package com.greenwhite.dwh.instance.ovw.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.dwh.DwhQueryTimeoutException;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawReader;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawSpec;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.ovw.OvwErrors;
import com.greenwhite.dwh.instance.ovw.OvwLimits;
import com.greenwhite.dwh.instance.ovw.OvwModel.ColumnItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.FilterItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsResult;
import com.greenwhite.dwh.instance.ovw.OvwModel.Layout;
import com.greenwhite.dwh.instance.ovw.OvwModel.PackageItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsPage;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.SheetItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.SortItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.SourceItem;
import com.greenwhite.dwh.instance.ovw.OvwModel.TotalItem;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.SourceView;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository.AppliedPackage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Обзор данных (контракт И14): источники с применёнными пакетами, раскладка листа по анкете,
 * строки страницей, группы с итогом. Только чтение; значения ячеек в журнал не пишутся.
 */
@Service
@Transactional(readOnly = true)
public class OvwDataService {

    private static final Logger log = LoggerFactory.getLogger(OvwDataService.class);

    private static final String MODULE = "ovw";
    private static final String OP_CONTAINS = "contains";
    private static final String OP_BETWEEN = "between";
    private static final String OP_EQ = "eq";
    private static final String DIR_ASC = "asc";
    private static final String DIR_DESC = "desc";
    private static final Pattern PLAIN_NUMBER = Pattern.compile(
            "^-?\\d{1," + OvwLimits.MAX_NUMBER_DIGITS + "}(\\.\\d{1," + OvwLimits.MAX_NUMBER_DIGITS + "})?$");
    /**
     * Число из группы для {@code eq}: значение приходит из ответа сервера, экспоненты в нём нет;
     * длину ограничивает размер тела запроса. {@code \d} в Java — только цифры 0–9.
     */
    private static final Pattern EQ_NUMBER = Pattern.compile("^-?\\d+(\\.\\d+)?$");

    private final UplSourceService sources;
    private final UplPackageRepository packages;
    private final FndRawReader raw;
    private final ModuleRegistryService modules;

    public OvwDataService(UplSourceService sources, UplPackageRepository packages, FndRawReader raw,
                          @Autowired(required = false) ModuleRegistryService modules) {
        this.sources = sources;
        this.packages = packages;
        this.raw = raw;
        this.modules = modules;
    }

    public List<SourceItem> sources() {
        requireModule();
        return packages.appliedSources().stream()
                .map(source -> new SourceItem(source.id(), source.code(), source.name()))
                .toList();
    }

    public Layout layout(long sourceId, Integer sheet) {
        requireModule();
        long started = System.nanoTime();
        Layout layout = timed(() -> resolve(sourceId, sheet).layout());
        logDone(sourceId, 0, started);
        return layout;
    }

    public RowsPage rows(long sourceId, RowsQuery query) {
        requireModule();
        long started = System.nanoTime();
        RowsPage page = timed(() -> readRows(sourceId, query));
        logDone(sourceId, sizeOf(query.filters()), started);
        return page;
    }

    public GroupsResult groups(long sourceId, GroupsQuery query) {
        requireModule();
        long started = System.nanoTime();
        GroupsResult result = timed(() -> readGroups(sourceId, query));
        logDone(sourceId, sizeOf(query.filters()), started);
        return result;
    }

    private RowsPage readRows(long sourceId, RowsQuery query) {
        Resolved resolved = resolve(sourceId, query.sheet());
        int offset = query.offset() == null ? 0 : query.offset();
        List<FieldErrorItem> errors = new ArrayList<>();
        List<FndRawSpec.Filter> filters = filters(resolved.spec(), query.filters(), errors);
        FndRawSpec.Sort sort = sort(resolved.spec(), query.sort(), errors);
        if (offset < 0 || offset % OvwLimits.PAGE_SIZE != 0) {
            errors.add(error("offset", OvwErrors.OVW_PAGE_INVALID));
        }
        throwIfAny(errors);
        long total = raw.count(resolved.spec(), filters);
        if (total > 0 && offset >= total) {
            throwIfAny(List.of(error("offset", OvwErrors.OVW_PAGE_INVALID)));
        }
        List<RowItem> items = raw.page(resolved.spec(), filters, sort, offset, OvwLimits.PAGE_SIZE).stream()
                .map(row -> new RowItem(resolved.fileByLoad().get(row.loadId()), row.sheet(), row.sourceRowNo(),
                        row.values()))
                .toList();
        return new RowsPage(total, offset, OvwLimits.PAGE_SIZE, items);
    }

    private GroupsResult readGroups(long sourceId, GroupsQuery query) {
        Resolved resolved = resolve(sourceId, query.sheet());
        List<FieldErrorItem> errors = new ArrayList<>();
        List<FndRawSpec.Filter> filters = filters(resolved.spec(), query.filters(), errors);
        String groupBy = query.groupBy();
        if (groupBy == null || !resolved.spec().columns().containsKey(groupBy)) {
            errors.add(error("groupBy", OvwErrors.OVW_COLUMN_UNKNOWN));
        }
        throwIfAny(errors);
        FndRawSpec.Groups groups = raw.groups(resolved.spec(), filters, groupBy, OvwLimits.MAX_GROUPS);
        FndRawSpec.Group total = raw.totals(resolved.spec(), filters);
        List<GroupItem> items = groups.groups().stream()
                .map(group -> new GroupItem(group.value(), group.count(), plain(group.sums())))
                .toList();
        return new GroupsResult(groups.groupsTotal(), items.size(), items,
                new TotalItem(total.count(), plain(total.sums())));
    }

    private Resolved resolve(long sourceId, Integer sheet) {
        SourceView view = sourceView(sourceId);
        List<AppliedPackage> shown = packages.appliedPackages(sourceId);
        Integer version = shown.stream().map(AppliedPackage::formatVersion).max(Integer::compare)
                .orElse(view.lastPublishedVersion());
        if (version == null) {
            return Resolved.empty(new Layout(sourceId, List.of(), null, null, List.of(), List.of(), 0));
        }
        FormatVersion format = sources.getVersion(sourceId, version);
        List<Sheet> sheets = format.sheets().stream().sorted(Comparator.comparingInt(Sheet::ordinal)).toList();
        List<SheetItem> sheetItems = sheets.stream().map(s -> new SheetItem(s.ordinal(), s.sheetName())).toList();
        Sheet chosen = chooseSheet(sheets, sheet);
        List<PackageItem> packageItems = shown.stream()
                .map(p -> new PackageItem(p.fileName(), p.periodFrom(), p.periodTo()))
                .toList();

        LinkedHashMap<String, FndRawSpec.Type> columns = new LinkedHashMap<>();
        Map<String, String> labelByField = new LinkedHashMap<>();
        List<ColumnItem> columnItems = new ArrayList<>();
        for (Column column : chosen.columns().stream().sorted(Comparator.comparingInt(Column::ordinal)).toList()) {
            FndRawSpec.Type type = rawType(column.dataType());
            String label = column.nameInFile() == null || column.nameInFile().isBlank()
                    ? column.targetField() : column.nameInFile();
            columns.put(column.targetField(), type);
            labelByField.put(column.targetField(), label);
            columnItems.add(new ColumnItem(column.targetField(), label, column.dataType().db(),
                    type == FndRawSpec.Type.NUMBER));
        }

        Map<Long, String> fileByLoad = new LinkedHashMap<>();
        shown.forEach(p -> fileByLoad.put(p.loadId(), p.fileName()));
        FndRawSpec spec = new FndRawSpec(List.copyOf(fileByLoad.keySet()), chosen.sheetName(), columns);
        long rowsTotal = raw.count(spec, List.of());
        Layout layout = new Layout(sourceId, sheetItems, chosen.ordinal(), version, columnItems, packageItems,
                rowsTotal);
        return new Resolved(spec, layout, fileByLoad, labelByField);
    }

    private SourceView sourceView(long sourceId) {
        try {
            return sources.getSource(sourceId);
        } catch (ApiException notFound) {
            throw ApiException.notFound(ErrorCode.NOT_FOUND, OvwErrors.OVW_SOURCE_NOT_FOUND);
        }
    }

    private static Sheet chooseSheet(List<Sheet> sheets, Integer sheet) {
        return sheets.stream()
                .filter(s -> sheet == null || s.ordinal() == sheet)
                .findFirst()
                .orElseThrow(() -> ApiException.validation(OvwErrors.OVW_QUERY_INVALID,
                        List.of(error("sheet", OvwErrors.OVW_SHEET_UNKNOWN))));
    }

    private static FndRawSpec.Type rawType(DataType type) {
        return switch (type) {
            case TEXT, OBJECT_KEY, REF_CODE -> FndRawSpec.Type.TEXT;
            case INTEGER, NUMBER -> FndRawSpec.Type.NUMBER;
            case DATE -> FndRawSpec.Type.DATE;
        };
    }

    // ---------- проверка запроса ----------

    private static List<FndRawSpec.Filter> filters(FndRawSpec spec, List<FilterItem> items,
                                                   List<FieldErrorItem> errors) {
        if (items == null || items.isEmpty()) {
            return List.of();
        }
        if (items.size() > OvwLimits.MAX_FILTERS) {
            errors.add(error("filters", OvwErrors.OVW_FILTER_TOO_MANY));
            return List.of();
        }
        List<FndRawSpec.Filter> filters = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            String field = "filters[" + i + "]";
            FilterItem item = items.get(i);
            if (item == null || item.field() == null || !spec.columns().containsKey(item.field())) {
                errors.add(error(field, OvwErrors.OVW_COLUMN_UNKNOWN));
                continue;
            }
            try {
                filters.add(filter(spec.type(item.field()), item));
            } catch (FilterRejected rejected) {
                errors.add(error(field, rejected.code));
            }
        }
        return filters;
    }

    private static FndRawSpec.Filter filter(FndRawSpec.Type type, FilterItem item) {
        String op = item.op();
        if (OP_CONTAINS.equals(op)) {
            return contains(type, item);
        }
        if (OP_BETWEEN.equals(op)) {
            return between(type, item);
        }
        if (OP_EQ.equals(op)) {
            return new FndRawSpec.Eq(item.field(), item.value() == null ? null : convert(type, item.value(), EQ_NUMBER));
        }
        throw new FilterRejected(OvwErrors.OVW_FILTER_OP);
    }

    private static FndRawSpec.Filter contains(FndRawSpec.Type type, FilterItem item) {
        if (type != FndRawSpec.Type.TEXT) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_OP);
        }
        String value = item.value();
        if (value == null || value.isEmpty() || value.length() > OvwLimits.MAX_FILTER_VALUE_LENGTH) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_VALUE);
        }
        return new FndRawSpec.Contains(item.field(), value);
    }

    private static FndRawSpec.Filter between(FndRawSpec.Type type, FilterItem item) {
        if (type == FndRawSpec.Type.TEXT) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_OP);
        }
        Object from = isBlank(item.from()) ? null : convert(type, item.from(), PLAIN_NUMBER);
        Object to = isBlank(item.to()) ? null : convert(type, item.to(), PLAIN_NUMBER);
        if (from == null && to == null) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_VALUE);
        }
        if (from != null && to != null && compare(from, to) > 0) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_VALUE);
        }
        return new FndRawSpec.Between(item.field(), from, to);
    }

    private static Object convert(FndRawSpec.Type type, String value, Pattern numberFormat) {
        try {
            return switch (type) {
                case TEXT -> value;
                case NUMBER -> number(value, numberFormat);
                case DATE -> LocalDate.parse(value.trim());
            };
        } catch (NumberFormatException | DateTimeParseException invalid) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_VALUE);
        }
    }

    private static BigDecimal number(String value, Pattern numberFormat) {
        String trimmed = value.trim();
        if (!numberFormat.matcher(trimmed).matches()) {
            throw new FilterRejected(OvwErrors.OVW_FILTER_VALUE);
        }
        return new BigDecimal(trimmed);
    }

    @SuppressWarnings("unchecked")
    private static int compare(Object from, Object to) {
        return ((Comparable<Object>) from).compareTo(to);
    }

    private static FndRawSpec.Sort sort(FndRawSpec spec, SortItem sort, List<FieldErrorItem> errors) {
        if (sort == null) {
            return null;
        }
        boolean knownField = sort.field() != null && spec.columns().containsKey(sort.field());
        boolean knownDir = DIR_ASC.equals(sort.dir()) || DIR_DESC.equals(sort.dir());
        if (!knownField || !knownDir) {
            errors.add(error("sort", OvwErrors.OVW_COLUMN_UNKNOWN));
            return null;
        }
        return new FndRawSpec.Sort(sort.field(), DIR_DESC.equals(sort.dir()));
    }

    // ---------- помощники ----------

    private void requireModule() {
        if (modules != null && !modules.isModuleActive(MODULE)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, OvwErrors.OVW_MODULE_DISABLED);
        }
    }

    private static <T> T timed(Supplier<T> call) {
        try {
            return call.get();
        } catch (DwhQueryTimeoutException timeout) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, OvwErrors.OVW_QUERY_TIMEOUT);
        }
    }

    private static void logDone(long sourceId, int filters, long started) {
        log.info("Обзор: источник {}, фильтров {}, {} мс", sourceId, filters,
                (System.nanoTime() - started) / 1_000_000);
    }

    private static int sizeOf(List<FilterItem> filters) {
        return filters == null ? 0 : filters.size();
    }

    private static void throwIfAny(List<FieldErrorItem> errors) {
        if (!errors.isEmpty()) {
            throw ApiException.validation(OvwErrors.OVW_QUERY_INVALID, List.copyOf(errors));
        }
    }

    private static FieldErrorItem error(String field, String code) {
        return new FieldErrorItem(field, code, code);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static Map<String, String> plain(Map<String, BigDecimal> sums) {
        Map<String, String> result = new LinkedHashMap<>();
        sums.forEach((field, amount) -> result.put(field, amount == null ? null : amount.toPlainString()));
        return result;
    }

    /** Фильтр не принят: код ошибки для {@code filters[i]}. */
    private static final class FilterRejected extends RuntimeException {

        private final String code;

        FilterRejected(String code) {
            super(code, null, false, false);
            this.code = code;
        }
    }

    private record Resolved(FndRawSpec spec, Layout layout, Map<Long, String> fileByLoad,
                            Map<String, String> labelByField) {

        static Resolved empty(Layout layout) {
            return new Resolved(new FndRawSpec(List.of(), "", new LinkedHashMap<>()), layout, Map.of(), Map.of());
        }
    }
}
