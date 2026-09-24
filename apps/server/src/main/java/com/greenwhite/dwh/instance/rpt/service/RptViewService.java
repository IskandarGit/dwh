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
import com.greenwhite.dwh.instance.rpt.RptModel.M2;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInfo;
import com.greenwhite.dwh.instance.rpt.RptModel.Ratio;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptModel.Undated;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository.MeasureRow;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository.Row;
import com.greenwhite.dwh.instance.rpt.service.RptSourceLayouts.Layout;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.EnumSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * Расчёт сводного отчёта и строки ячейки (контракт И15а, разделы 2.3, 3; И15б, 10.6–10.8): сверка описания с текущей
 * анкетой, спецификация сводной каждой меры для основы, склейка линий двух мер и отношение. Все цифры считает база;
 * сервер только делит на делитель, раскладывает и делит меру 1 на меру 2 в уже сложенных ячейках. Значения ячеек и
 * названия групп в журнал не пишутся.
 */
@Service
public class RptViewService {

    private static final Logger log = LoggerFactory.getLogger(RptViewService.class);

    private static final String MODULE = "rpt";
    private static final String SECOND = "second.";
    private static final int MONTHS = 12;
    private static final int FIRST_MEASURE = 1;
    private static final int SECOND_MEASURE = 2;
    private static final int RATIO_SCALE = 6;
    private static final BigDecimal PERCENT = BigDecimal.valueOf(100);
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
        MeasureRow first = row.first();
        MeasureRow second = row.second();
        Pivot pivot1 = timed(() -> raw.pivot(spec(first, sources.first(), year, null)));
        int ytdMonth = ytdMonth(pivot1);
        Integer secondYear = byMonths(first) ? year : shownYear(pivot1.years(), year);
        Pivot pivot2 = second == null ? null
                : timed(() -> raw.pivot(spec(second, sources.second(), secondYear, ytdMonth)));
        List<Integer> years = years(first, pivot1, second, pivot2);
        Integer shownYear = shownYear(years, year);
        boolean empty = years.isEmpty() && (!byMonths(first) || second != null && !byMonths(second));
        List<Cell> cells1 = empty ? Collections.emptyList() : pivot1.cells();
        Tree tree1 = Tree.of(cells1, row.divisor());
        Tree tree2 = null;
        if (pivot2 != null) {
            List<Cell> cells2 = empty ? Collections.emptyList() : pivot2.cells();
            tree2 = Tree.of(cells2, second.divisor());
        }
        Lines lines = Lines.of(tree1, tree2, row.divisor(), second == null ? 1 : second.divisor());
        if (lines.count() > RptLimits.MAX_LINES) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, RptErrors.RPT_TOO_MANY_LINES);
        }
        Labels labels = labels(row, sources.first());
        Undated undated2 = pivot2 == null || byMonths(second) ? null : undated(pivot2, second.divisor());
        ReportView view = new ReportView(row.id(), row.name(), shownYear, years, row.divisor(), row.decimals(),
                labels, lines.grand(), lines.lines(), undated(pivot1, row.divisor()), pivot1.refDuplicateKeys(),
                ytdMonth, measures(row, labels), undated2);
        log.info("Отчёт {}: год {}, линий {}, мер {}, {} мс", id, shownYear, lines.count(), second == null ? 1 : 2,
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        return view;
    }

    /** Строки одной ячейки страницей по {@link RptLimits#PAGE_SIZE}; мера — до делителя. */
    public CellRows cells(long id, CellQuery query) {
        requireModule();
        Row row = requireRow(id);
        Sources sources = currentSources(row);
        CellRequest request = cellRequest(row, query);
        boolean second = request.measure() == SECOND_MEASURE;
        MeasureRow measure = second ? row.second() : row.first();
        MeasureSources measureSources = second ? sources.second() : sources.first();
        FndPivotSpec.CellQuery cell = request.cell();
        int offset = query.offset() == null ? 0 : query.offset();
        Integer year = cell.kind() == PeriodKind.UNDATED || byMonths(measure) ? null : query.year();
        Integer untilMonth = second && cell.kind() == PeriodKind.YEAR
                ? ytdMonth(timed(() -> raw.pivot(spec(row.first(), sources.first(), query.year(), null)))) : null;
        FndPivotSpec.CellRows rows = timed(() -> raw.pivotRows(spec(measure, measureSources, year, untilMonth), cell,
                offset, RptLimits.PAGE_SIZE));
        if (rows.total() > 0 && offset >= rows.total()) {
            throw cellInvalid(List.of(error("offset", RptErrors.RPT_CELL_INVALID)));
        }
        Layout source = measureSources.source();
        List<CellItem> items = rows.rows().stream().map(r -> item(r, source)).toList();
        return new CellRows(rows.total(), offset, RptLimits.PAGE_SIZE, plain(rows.value()), items);
    }

    // ---------- сверка описания с анкетой (2.3, 10.3) ----------

    /** Источник и справочник одной меры глазами отчёта; справочника нет — {@code ref == null}. */
    private record MeasureSources(Layout source, Layout ref) {
    }

    /** Источники обеих мер; меры 2 нет — {@code second == null}. */
    private record Sources(MeasureSources first, MeasureSources second) {
    }

    private Sources currentSources(Row row) {
        List<FieldErrorItem> errors = new ArrayList<>();
        MeasureSources first = measureSources(row.first(), "", errors);
        MeasureSources second = row.second() == null ? null : measureSources(row.second(), SECOND, errors);
        if (!errors.isEmpty()) {
            throw new ApiException(ErrorCode.CONFLICT, RptErrors.RPT_DEFINITION_STALE, List.copyOf(errors));
        }
        return new Sources(first, second);
    }

    /** Сверка полей одной меры; {@code prefix} — приставка имён полей в ошибках ("" у меры 1, "second." у меры 2). */
    private MeasureSources measureSources(MeasureRow measure, String prefix, List<FieldErrorItem> errors) {
        Layout source = part(measure.sourceId(), measure.sourceSheet(), prefix + "sourceId", prefix + "sourceSheet",
                errors);
        Layout ref = measure.refSourceId() == null ? null
                : part(measure.refSourceId(), measure.refSheet(), prefix + "ref.sourceId", prefix + "ref.sheet", errors);
        if (byMonths(measure)) {
            List<String> fields = measure.monthFields();
            for (int month = 0; month < fields.size(); month++) {
                if (fields.get(month) != null) {
                    checkColumn(source, fields.get(month), prefix + "monthFields[" + month + "]", NUMERIC, errors);
                }
            }
        } else {
            checkColumn(source, measure.dateField(), prefix + "dateField", DATE_ONLY, errors);
        }
        if (RptModel.MEASURE_TOTAL.equals(measure.measureKind())) {
            checkColumn(source, measure.measureField(), prefix + "measure.field", NUMERIC, errors);
        }
        if (measure.refSourceId() != null) {
            checkColumn(source, measure.key1Field(), prefix + "ref.keys[0].field", NOT_DATE, errors);
            checkColumn(ref, measure.key1RefField(), prefix + "ref.keys[0].refField", NOT_DATE, errors);
            if (measure.key2Field() != null) {
                checkColumn(source, measure.key2Field(), prefix + "ref.keys[1].field", NOT_DATE, errors);
                checkColumn(ref, measure.key2RefField(), prefix + "ref.keys[1].refField", NOT_DATE, errors);
            }
        }
        checkLevel(measure.level1Origin(), measure.level1Field(), prefix + "level1.field", source, ref, errors);
        if (measure.level2Origin() != null) {
            checkLevel(measure.level2Origin(), measure.level2Field(), prefix + "level2.field", source, ref, errors);
        }
        return new MeasureSources(source, ref);
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

    // ---------- спецификация сводной и период (10.6) ----------

    private static boolean byMonths(MeasureRow measure) {
        return measure.monthFields() != null;
    }

    private static FndPivotSpec spec(MeasureRow measure, MeasureSources sources, Integer year, Integer untilMonth) {
        boolean withRef = sources.ref() != null;
        List<FndPivotSpec.Key> keys = !withRef ? List.of() : measure.key2Field() == null
                ? List.of(new FndPivotSpec.Key(measure.key1Field(), measure.key1RefField()))
                : List.of(new FndPivotSpec.Key(measure.key1Field(), measure.key1RefField()),
                        new FndPivotSpec.Key(measure.key2Field(), measure.key2RefField()));
        FndPivotSpec.Period period = byMonths(measure) ? new FndPivotSpec.MonthsPeriod(measure.monthFields())
                : new FndPivotSpec.DatePeriod(measure.dateField());
        String measureField = RptModel.MEASURE_TOTAL.equals(measure.measureKind()) ? measure.measureField() : null;
        return new FndPivotSpec(RptSourceLayouts.spec(sources.source()), period, measureField,
                withRef ? RptSourceLayouts.spec(sources.ref()) : null, keys,
                level(measure.level1Origin(), measure.level1Field()),
                level(measure.level2Origin(), measure.level2Field()), byMonths(measure) ? null : year, untilMonth);
    }

    private static FndPivotSpec.Level level(String origin, String field) {
        if (origin == null) {
            return null;
        }
        FndPivotSpec.Origin side = RptModel.ORIGIN_REF.equals(origin) ? FndPivotSpec.Origin.REF : FndPivotSpec.Origin.DATA;
        return new FndPivotSpec.Level(side, field);
    }

    /** N — последний месяц, где у меры 1 есть строки; строк нет — 12. */
    private static int ytdMonth(Pivot first) {
        return first.monthsWithRows().isEmpty() ? MONTHS : first.monthsWithRows().getLast();
    }

    /** Годы отчёта: меры 1 по дате, иначе меры 2 по дате; обе по колонкам-месяцам — пусто. */
    private static List<Integer> years(MeasureRow first, Pivot pivot1, MeasureRow second, Pivot pivot2) {
        if (!byMonths(first)) {
            return pivot1.years();
        }
        return second != null && !byMonths(second) ? pivot2.years() : List.of();
    }

    private static Integer shownYear(List<Integer> years, Integer year) {
        return years.isEmpty() ? null : year != null ? year : years.getLast();
    }

    private static Undated undated(Pivot pivot, int divisor) {
        return pivot.undatedCount() == 0 ? null : new Undated(pivot.undatedCount(), shown(pivot.undatedValue(), divisor));
    }

    private static Labels labels(Row row, MeasureSources sources) {
        String measure = RptModel.MEASURE_TOTAL.equals(row.measureKind())
                ? sources.source().label(row.measureField()) : null;
        return new Labels(levelLabel(row.level1Origin(), row.level1Field(), sources),
                levelLabel(row.level2Origin(), row.level2Field(), sources), measure);
    }

    private static String levelLabel(String origin, String field, MeasureSources sources) {
        if (origin == null) {
            return null;
        }
        Layout layout = RptModel.ORIGIN_REF.equals(origin) ? sources.ref() : sources.source();
        return layout.label(field);
    }

    /** Меры ответа: мера 1 — её название или прежняя подпись меры; мера 2 — её название. */
    private static List<MeasureInfo> measures(Row row, Labels labels) {
        MeasureInfo first = new MeasureInfo(row.measureName() != null ? row.measureName() : labels.measure(),
                row.divisor(), row.decimals(), byMonths(row.first()));
        MeasureRow second = row.second();
        if (second == null) {
            return List.of(first);
        }
        return List.of(first, new MeasureInfo(second.name(), second.divisor(), second.decimals(), byMonths(second)));
    }

    // ---------- запрос ячейки (10.8) ----------

    /** Проверенный запрос ячейки: номер меры и ячейка для основы. */
    private record CellRequest(int measure, FndPivotSpec.CellQuery cell) {
    }

    private static CellRequest cellRequest(Row row, CellQuery query) {
        List<FieldErrorItem> errors = new ArrayList<>();
        Integer number = query == null ? null : query.measure();
        int measure = number == null ? FIRST_MEASURE : number;
        if (measure != FIRST_MEASURE && (measure != SECOND_MEASURE || row.second() == null)) {
            errors.add(error("measure", RptErrors.RPT_CELL_INVALID));
            measure = FIRST_MEASURE;
        }
        boolean months = byMonths(measure == SECOND_MEASURE ? row.second() : row.first());
        PeriodKind kind = query == null ? null : periodKind(query.period());
        if (kind == null || kind == PeriodKind.UNDATED && months) {
            errors.add(error("period", RptErrors.RPT_CELL_INVALID));
        }
        if (kind != null && kind != PeriodKind.UNDATED && !months && query.year() == null) {
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
        return new CellRequest(measure, new FndPivotSpec.CellQuery(kind, month, query.path()));
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

    private static CellItem item(CellRow row, Layout source) {
        String column = row.column() == null ? null : source.label(row.column());
        return new CellItem(source.fileByLoad().get(row.loadId()), row.sheet(), row.sourceRowNo(), row.date(),
                row.measure(), row.level1(), row.level2(), column);
    }

    // ---------- раскладка ответа ----------

    /** Ячейки одной меры по линиям в порядке базы: общий итог, уровень 1, внутри — уровень 2. */
    private record Tree(Part grand, Map<String, Part> level1, Map<String, Map<String, Part>> level2) {

        static Tree of(List<Cell> cells, int divisor) {
            Part grand = new Part();
            Map<String, Part> level1 = new LinkedHashMap<>();
            Map<String, Map<String, Part>> level2 = new LinkedHashMap<>();
            for (Cell cell : cells) {
                Part target;
                if (cell.depth() == 0) {
                    target = grand;
                } else if (cell.depth() == 1) {
                    target = level1.computeIfAbsent(cell.key1(), k -> new Part());
                    level2.computeIfAbsent(cell.key1(), k -> new LinkedHashMap<>());
                } else {
                    target = level2.computeIfAbsent(cell.key1(), k -> new LinkedHashMap<>())
                            .computeIfAbsent(cell.key2(), k -> new Part());
                }
                target.put(cell, divisor);
            }
            return new Tree(grand, level1, level2);
        }

        /** Линии уровня 2 под {@code key1}; их нет — пустая карта (допускает поиск по null). */
        Map<String, Part> children(String key1) {
            Map<String, Part> children = level2.get(key1);
            return children == null ? Collections.emptyMap() : children;
        }
    }

    /**
     * Линии отчёта: линии обеих мер склеены по {@code (key1, key2)} (10.6 п.3); линия одной меры — у другой части
     * пусто. Порядок — порядок базы у каждой меры, чужие ключи встают по тому же правилу, «Без названия» последней.
     */
    private record Lines(Line grand, List<Line1> lines, int count) {

        static Lines of(Tree first, Tree second, int divisor1, int divisor2) {
            Pair pair = new Pair(second != null, divisor1, divisor2);
            Collection<String> keys2 = second == null ? Collections.emptySet() : second.level1().keySet();
            List<Line1> lines = new ArrayList<>();
            int count = 0;
            for (String key1 : mergeKeys(first.level1().keySet(), keys2)) {
                Map<String, Part> children1 = first.children(key1);
                Map<String, Part> children2 = second == null ? Collections.emptyMap() : second.children(key1);
                List<Line2> children = new ArrayList<>();
                for (String key2 : mergeKeys(children1.keySet(), children2.keySet())) {
                    children.add(pair.line2(key2, children1.get(key2), children2.get(key2)));
                }
                Part part2 = second == null ? null : second.level1().get(key1);
                lines.add(pair.line1(key1, first.level1().get(key1), part2, List.copyOf(children)));
                count += 1 + children.size();
            }
            Line grand = pair.line(first.grand(), second == null ? null : second.grand());
            return new Lines(grand, Collections.unmodifiableList(lines), count);
        }

        /** Ключи двух мер без повторов: слияние двух упорядоченных списков, {@code null} («Без названия») последним. */
        private static List<String> mergeKeys(Collection<String> first, Collection<String> second) {
            List<String> merged = new ArrayList<>();
            Iterator<String> left = first.stream().filter(Objects::nonNull).iterator();
            Iterator<String> right = second.stream().filter(key -> key != null && !first.contains(key)).iterator();
            String a = left.hasNext() ? left.next() : null;
            String b = right.hasNext() ? right.next() : null;
            while (a != null || b != null) {
                if (b == null || a != null && KeyOrder.compare(a, b) <= 0) {
                    merged.add(a);
                    a = left.hasNext() ? left.next() : null;
                } else {
                    merged.add(b);
                    b = right.hasNext() ? right.next() : null;
                }
            }
            if (first.contains(null) || second.contains(null)) {
                merged.add(null);
            }
            return merged;
        }
    }

    /** Порядок названий групп между мерами — как у базы (сортировка ICU без учёта регистра, 3.7). */
    private static final class KeyOrder {

        private static final Collator COLLATOR = Collator.getInstance(Locale.ROOT);

        private KeyOrder() {
        }

        static int compare(String a, String b) {
            int order = COLLATOR.compare(a, b);
            return order != 0 ? order : a.compareTo(b);
        }
    }

    /** Сборка линии из частей двух мер; {@code twoMeasures == false} — {@code m2} и {@code ratio} null. */
    private record Pair(boolean twoMeasures, int divisor1, int divisor2) {

        Line line(Part first, Part second) {
            Part one = first == null ? Part.EMPTY : first;
            return new Line(one.cells(), one.total, one.count, m2(second, true), ratio(one, second));
        }

        Line1 line1(String key, Part first, Part second, List<Line2> children) {
            Part one = first == null ? Part.EMPTY : first;
            return new Line1(key, name(first, second), one.cells(), one.total, one.count, children,
                    m2(second, false), ratio(one, second));
        }

        Line2 line2(String key, Part first, Part second) {
            Part one = first == null ? Part.EMPTY : first;
            return new Line2(key, name(first, second), one.cells(), one.total, one.count, m2(second, false),
                    ratio(one, second));
        }

        private static String name(Part first, Part second) {
            if (first != null && first.name != null) {
                return first.name;
            }
            return second == null ? null : second.name;
        }

        /** Часть меры 2; у линии без пары — null, у общего итога — всегда есть. */
        private M2 m2(Part second, boolean grand) {
            if (!twoMeasures || second == null && !grand) {
                return null;
            }
            Part two = second == null ? Part.EMPTY : second;
            return new M2(two.cells(), two.total, two.count);
        }

        private Ratio ratio(Part first, Part second) {
            if (!twoMeasures) {
                return null;
            }
            Part two = second == null ? Part.EMPTY : second;
            String[] cells = new String[MONTHS];
            for (int month = 0; month < MONTHS; month++) {
                cells[month] = percent(first.rawMonths[month], two.rawMonths[month]);
            }
            return new Ratio(Arrays.asList(cells), percent(first.rawTotal, two.rawTotal));
        }

        /** (v1 / делитель1) / (v2 / делитель2) × 100, 6 знаков; v2 пусто или 0 — null; v1 пусто — "0". */
        private String percent(BigDecimal v1, BigDecimal v2) {
            if (v2 == null || v2.signum() == 0) {
                return null;
            }
            if (v1 == null) {
                return "0";
            }
            BigDecimal numerator = v1.multiply(BigDecimal.valueOf(divisor2)).multiply(PERCENT);
            BigDecimal denominator = v2.multiply(BigDecimal.valueOf(divisor1));
            return numerator.divide(denominator, RATIO_SCALE, RoundingMode.HALF_UP).toPlainString();
        }
    }

    /** Одна линия одной меры: 12 месяцев, «Итого», число строк, название группы; сырые значения — для отношения. */
    private static final class Part {

        static final Part EMPTY = new Part();

        private final String[] months = new String[MONTHS];
        private final BigDecimal[] rawMonths = new BigDecimal[MONTHS];
        private String name;
        private String total;
        private BigDecimal rawTotal;
        private long count;

        /** Ячейка итога без строк за месяцы 1…N оставляет итог пустым, но название группы даёт. */
        void put(Cell cell, int divisor) {
            if (cell.month() == null) {
                name = cell.depth() == 2 ? cell.name2() : cell.name1();
            }
            if (cell.count() == 0) {
                return;
            }
            String value = shown(cell.value(), divisor);
            if (cell.month() == null) {
                total = value;
                rawTotal = cell.value();
                count = cell.count();
            } else {
                months[cell.month() - 1] = value;
                rawMonths[cell.month() - 1] = cell.value();
            }
        }

        List<String> cells() {
            return Arrays.asList(months.clone());
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
