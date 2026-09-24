package com.greenwhite.dwh.instance.rpt.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.dwh.DwhQueryTimeoutException;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.Cell;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.CellRow;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.PeriodKind;
import com.greenwhite.dwh.instance.fnd.dwh.FndPivotSpec.Pivot;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawReader;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.rpt.RptErrors;
import com.greenwhite.dwh.instance.rpt.RptLimits;
import com.greenwhite.dwh.instance.rpt.RptModel;
import com.greenwhite.dwh.instance.rpt.RptModel.CellItem;
import com.greenwhite.dwh.instance.rpt.RptModel.CellQuery;
import com.greenwhite.dwh.instance.rpt.RptModel.CellRows;
import com.greenwhite.dwh.instance.rpt.RptModel.Labels;
import com.greenwhite.dwh.instance.rpt.RptModel.Line;
import com.greenwhite.dwh.instance.rpt.RptModel.Line1;
import com.greenwhite.dwh.instance.rpt.RptModel.Line2;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptModel.Undated;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository.Row;
import com.greenwhite.dwh.instance.rpt.service.RptSourceLayouts.Layout;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * Расчёт сводного отчёта и строки ячейки (контракт И15а, разделы 2.3, 3): сверка описания с текущей анкетой,
 * спецификация сводной для основы, раскладка ответа по уровням. Все цифры считает база; сервер только делит на
 * делитель и раскладывает. Значения ячеек и названия групп в журнал не пишутся.
 */
@Service
public class RptViewService {

    private static final Logger log = LoggerFactory.getLogger(RptViewService.class);

    private static final String MODULE = "rpt";
    private static final int MONTHS = 12;
    private static final Set<DataType> DATE_ONLY = Set.of(DataType.DATE);
    private static final Set<DataType> NUMERIC = Set.of(DataType.INTEGER, DataType.NUMBER);
    private static final Set<DataType> NOT_DATE = Set.copyOf(EnumSet.complementOf(EnumSet.of(DataType.DATE)));

    private final RptReportRepository repo;
    private final RptSourceLayouts layouts;
    private final FndRawReader raw;
    private final ModuleRegistryService modules;

    public RptViewService(RptReportRepository repo, RptSourceLayouts layouts, FndRawReader raw,
                          @Autowired(required = false) ModuleRegistryService modules) {
        this.repo = repo;
        this.layouts = layouts;
        this.raw = raw;
        this.modules = modules;
    }

    /** Отчёт за год; {@code year == null} — последний год, в котором есть даты. */
    public ReportView view(long id, Integer year) {
        requireModule();
        long started = System.nanoTime();
        Row row = requireRow(id);
        Sources sources = currentSources(row);
        Pivot pivot = timed(() -> raw.pivot(spec(row, sources, year)));
        Integer shownYear = pivot.years().isEmpty() ? null : year != null ? year : pivot.years().getLast();
        Lines lines = Lines.of(pivot.cells(), row.divisor());
        if (lines.count() > RptLimits.MAX_LINES) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, RptErrors.RPT_TOO_MANY_LINES);
        }
        Undated undated = pivot.undatedCount() == 0 ? null
                : new Undated(pivot.undatedCount(), shown(pivot.undatedValue(), row.divisor()));
        ReportView view = new ReportView(row.id(), row.name(), shownYear, pivot.years(), row.divisor(), row.decimals(),
                labels(row, sources), lines.grand(), lines.lines(), undated, pivot.refDuplicateKeys());
        log.info("Отчёт {}: год {}, линий {}, {} мс", id, shownYear, lines.count(),
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        return view;
    }

    /** Строки одной ячейки страницей по {@link RptLimits#PAGE_SIZE}; мера — до делителя. */
    public CellRows cells(long id, CellQuery query) {
        requireModule();
        Row row = requireRow(id);
        Sources sources = currentSources(row);
        FndPivotSpec.CellQuery cell = cellQuery(row, query);
        int offset = query.offset() == null ? 0 : query.offset();
        Integer year = cell.kind() == PeriodKind.UNDATED ? null : query.year();
        FndPivotSpec.CellRows rows = timed(() -> raw.pivotRows(spec(row, sources, year), cell, offset,
                RptLimits.PAGE_SIZE));
        if (rows.total() > 0 && offset >= rows.total()) {
            throw cellInvalid(List.of(error("offset", RptErrors.RPT_CELL_INVALID)));
        }
        Map<Long, String> files = sources.source().fileByLoad();
        List<CellItem> items = rows.rows().stream().map(r -> item(r, files)).toList();
        return new CellRows(rows.total(), offset, RptLimits.PAGE_SIZE, plain(rows.value()), items);
    }

    // ---------- сверка описания с анкетой (2.3) ----------

    /** Источник и справочник глазами отчёта; справочника нет — {@code ref == null}. */
    private record Sources(Layout source, Layout ref) {
    }

    private Sources currentSources(Row row) {
        List<FieldErrorItem> errors = new ArrayList<>();
        Layout source = part(row.sourceId(), row.sourceSheet(), "sourceId", "sourceSheet", errors);
        Layout ref = row.refSourceId() == null ? null
                : part(row.refSourceId(), row.refSheet(), "ref.sourceId", "ref.sheet", errors);
        checkColumn(source, row.dateField(), "dateField", DATE_ONLY, errors);
        if (RptModel.MEASURE_TOTAL.equals(row.measureKind())) {
            checkColumn(source, row.measureField(), "measure.field", NUMERIC, errors);
        }
        if (row.refSourceId() != null) {
            checkColumn(source, row.key1Field(), "ref.keys[0].field", NOT_DATE, errors);
            checkColumn(ref, row.key1RefField(), "ref.keys[0].refField", NOT_DATE, errors);
            if (row.key2Field() != null) {
                checkColumn(source, row.key2Field(), "ref.keys[1].field", NOT_DATE, errors);
                checkColumn(ref, row.key2RefField(), "ref.keys[1].refField", NOT_DATE, errors);
            }
        }
        checkLevel(row.level1Origin(), row.level1Field(), "level1.field", source, ref, errors);
        if (row.level2Origin() != null) {
            checkLevel(row.level2Origin(), row.level2Field(), "level2.field", source, ref, errors);
        }
        if (!errors.isEmpty()) {
            throw new ApiException(ErrorCode.CONFLICT, RptErrors.RPT_DEFINITION_STALE, List.copyOf(errors));
        }
        return new Sources(source, ref);
    }

    private Layout part(long sourceId, Integer sheet, String sourceField, String sheetField,
                        List<FieldErrorItem> errors) {
        Layout layout = layouts.resolve(sourceId, sheet).orElse(null);
        if (layout == null) {
            errors.add(error(sourceField, RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        if (layout.chosen() == null) {
            errors.add(error(sheetField, RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        return layout;
    }

    private static void checkLevel(String origin, String field, String path, Layout source, Layout ref,
                                   List<FieldErrorItem> errors) {
        Layout layout = RptModel.ORIGIN_REF.equals(origin) ? ref : source;
        checkColumn(layout, field, path, NOT_DATE, errors);
    }

    /** Колонка есть в анкете листа и её тип из разрешённых; лист не определён — уже ошибка выше. */
    private static void checkColumn(Layout layout, String field, String path, Set<DataType> allowed,
                                    List<FieldErrorItem> errors) {
        if (layout == null) {
            return;
        }
        Column column = field == null ? null : layout.columns().get(field);
        if (column == null) {
            errors.add(error(path, RptErrors.RPT_COLUMN_UNKNOWN));
        } else if (!allowed.contains(column.dataType())) {
            errors.add(error(path, RptErrors.RPT_COLUMN_TYPE));
        }
    }

    // ---------- спецификация сводной ----------

    private static FndPivotSpec spec(Row row, Sources sources, Integer year) {
        boolean withRef = sources.ref() != null;
        List<FndPivotSpec.Key> keys = !withRef ? List.of() : row.key2Field() == null
                ? List.of(new FndPivotSpec.Key(row.key1Field(), row.key1RefField()))
                : List.of(new FndPivotSpec.Key(row.key1Field(), row.key1RefField()),
                        new FndPivotSpec.Key(row.key2Field(), row.key2RefField()));
        String measureField = RptModel.MEASURE_TOTAL.equals(row.measureKind()) ? row.measureField() : null;
        return new FndPivotSpec(RptSourceLayouts.spec(sources.source()), row.dateField(), measureField,
                withRef ? RptSourceLayouts.spec(sources.ref()) : null, keys,
                level(row.level1Origin(), row.level1Field()), level(row.level2Origin(), row.level2Field()), year);
    }

    private static FndPivotSpec.Level level(String origin, String field) {
        if (origin == null) {
            return null;
        }
        FndPivotSpec.Origin side = RptModel.ORIGIN_REF.equals(origin) ? FndPivotSpec.Origin.REF : FndPivotSpec.Origin.DATA;
        return new FndPivotSpec.Level(side, field);
    }

    private static Labels labels(Row row, Sources sources) {
        String measure = RptModel.MEASURE_TOTAL.equals(row.measureKind())
                ? sources.source().label(row.measureField()) : null;
        return new Labels(levelLabel(row.level1Origin(), row.level1Field(), sources),
                levelLabel(row.level2Origin(), row.level2Field(), sources), measure);
    }

    private static String levelLabel(String origin, String field, Sources sources) {
        if (origin == null) {
            return null;
        }
        Layout layout = RptModel.ORIGIN_REF.equals(origin) ? sources.ref() : sources.source();
        return layout.label(field);
    }

    // ---------- запрос ячейки ----------

    private static FndPivotSpec.CellQuery cellQuery(Row row, CellQuery query) {
        List<FieldErrorItem> errors = new ArrayList<>();
        PeriodKind kind = query == null ? null : periodKind(query.period());
        if (kind == null) {
            errors.add(error("period", RptErrors.RPT_CELL_INVALID));
        }
        if (kind != null && kind != PeriodKind.UNDATED && query.year() == null) {
            errors.add(error("year", RptErrors.RPT_CELL_INVALID));
        }
        int levels = row.level2Origin() == null ? 1 : 2;
        if (query == null || query.path() == null || query.path().size() > levels) {
            errors.add(error("path", RptErrors.RPT_CELL_INVALID));
        }
        Integer offset = query == null ? null : query.offset();
        if (offset != null && (offset < 0 || offset % RptLimits.PAGE_SIZE != 0)) {
            errors.add(error("offset", RptErrors.RPT_CELL_INVALID));
        }
        if (!errors.isEmpty()) {
            throw cellInvalid(errors);
        }
        Integer month = kind == PeriodKind.MONTH ? query.period().month() : null;
        return new FndPivotSpec.CellQuery(kind, month, query.path());
    }

    /** Вид периода ячейки; неизвестный вид или месяц вне 1–12 — null. */
    private static PeriodKind periodKind(RptModel.Period period) {
        if (period == null || period.kind() == null) {
            return null;
        }
        return switch (period.kind()) {
            case RptModel.PERIOD_MONTH -> period.month() != null && period.month() >= 1 && period.month() <= MONTHS
                    ? PeriodKind.MONTH : null;
            case RptModel.PERIOD_YEAR -> PeriodKind.YEAR;
            case RptModel.PERIOD_UNDATED -> PeriodKind.UNDATED;
            default -> null;
        };
    }

    private static CellItem item(CellRow row, Map<Long, String> files) {
        return new CellItem(files.get(row.loadId()), row.sheet(), row.sourceRowNo(), row.date(), row.measure(),
                row.level1(), row.level2());
    }

    // ---------- раскладка ответа ----------

    /** Линии отчёта из ячеек сводной в порядке базы: общий итог, уровень 1, внутри — уровень 2. */
    private record Lines(Line grand, List<Line1> lines, int count) {

        static Lines of(List<Cell> cells, int divisor) {
            LineBuilder grand = new LineBuilder(null);
            Map<String, LineBuilder> level1 = new LinkedHashMap<>();
            Map<String, Map<String, LineBuilder>> level2 = new LinkedHashMap<>();
            int count = 0;
            for (Cell cell : cells) {
                LineBuilder target;
                if (cell.depth() == 0) {
                    target = grand;
                } else if (cell.depth() == 1) {
                    target = level1.get(cell.key1());
                    if (target == null) {
                        target = new LineBuilder(cell.key1());
                        level1.put(cell.key1(), target);
                        level2.put(cell.key1(), new LinkedHashMap<>());
                        count++;
                    }
                } else {
                    Map<String, LineBuilder> children = level2.computeIfAbsent(cell.key1(), k -> new LinkedHashMap<>());
                    target = children.get(cell.key2());
                    if (target == null) {
                        target = new LineBuilder(cell.key2());
                        children.put(cell.key2(), target);
                        count++;
                    }
                }
                target.put(cell, divisor);
            }
            List<Line1> lines = level1.values().stream()
                    .map(line -> line.line1(level2.get(line.key).values().stream().map(LineBuilder::line2).toList()))
                    .toList();
            return new Lines(grand.line(), lines, count);
        }
    }

    /** Одна линия: 12 месяцев, «Итого», число строк, название группы. */
    private static final class LineBuilder {

        private final String key;
        private final String[] months = new String[MONTHS];
        private String name;
        private String total;
        private long count;

        LineBuilder(String key) {
            this.key = key;
        }

        void put(Cell cell, int divisor) {
            if (cell.count() == 0) {
                return;
            }
            String value = shown(cell.value(), divisor);
            if (cell.month() == null) {
                total = value;
                count = cell.count();
                name = cell.depth() == 2 ? cell.name2() : cell.name1();
            } else {
                months[cell.month() - 1] = value;
            }
        }

        Line line() {
            return new Line(Arrays.asList(months.clone()), total, count);
        }

        Line1 line1(List<Line2> children) {
            return new Line1(key, name, Arrays.asList(months.clone()), total, count, children);
        }

        Line2 line2() {
            return new Line2(key, name, Arrays.asList(months.clone()), total, count);
        }
    }

    /** Значение для экрана: поделено на делитель без округления, единый вид без лишних нулей. */
    private static String shown(BigDecimal value, int divisor) {
        return value == null ? null : plain(value.divide(BigDecimal.valueOf(divisor)));
    }

    private static String plain(BigDecimal value) {
        return value == null ? null : value.stripTrailingZeros().toPlainString();
    }

    // ---------- помощники ----------

    private <T> T timed(Supplier<T> query) {
        try {
            return query.get();
        } catch (DwhQueryTimeoutException slow) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, RptErrors.RPT_QUERY_TIMEOUT);
        }
    }

    private Row requireRow(long id) {
        return repo.find(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, RptErrors.RPT_REPORT_NOT_FOUND));
    }

    private void requireModule() {
        if (modules != null && !modules.isModuleActive(MODULE)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, RptErrors.RPT_MODULE_DISABLED);
        }
    }

    private static ApiException cellInvalid(List<FieldErrorItem> errors) {
        return ApiException.validation(RptErrors.RPT_CELL_INVALID, List.copyOf(errors));
    }

    private static FieldErrorItem error(String field, String code) {
        return new FieldErrorItem(field, code, code);
    }
}
