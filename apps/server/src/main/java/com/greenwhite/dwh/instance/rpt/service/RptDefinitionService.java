package com.greenwhite.dwh.instance.rpt.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.rpt.RptErrors;
import com.greenwhite.dwh.instance.rpt.RptLimits;
import com.greenwhite.dwh.instance.rpt.RptModel;
import com.greenwhite.dwh.instance.rpt.RptModel.ColumnItem;
import com.greenwhite.dwh.instance.rpt.RptModel.Definition;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInput;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceLayout;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository.MeasureRow;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository.Row;
import com.greenwhite.dwh.instance.rpt.service.RptSourceLayouts.Layout;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Описание сводного отчёта (контракт И15а, разделы 2, 2.2; И15б, 10.3): список, чтение, создание и правка с {@code lockVersion},
 * источники и раскладка для формы. Названия и поля отчёта в журнал не пишутся.
 */
@Service
@Transactional(readOnly = true)
public class RptDefinitionService {

    private static final Logger log = LoggerFactory.getLogger(RptDefinitionService.class);

    private static final String MODULE = "rpt";
    private static final String LABEL_SOURCE = "source:";
    private static final String LABEL_REF = "ref:";
    /** Приставка полей меры 2 в {@code errors[]} и {@code labels}; у меры 1 — пусто. */
    private static final String SECOND = "second.";
    private static final String FIRST = "";
    private static final Set<DataType> NUMERIC = Set.of(DataType.INTEGER, DataType.NUMBER);
    private static final Set<DataType> NOT_DATE = Set.copyOf(EnumSet.complementOf(EnumSet.of(DataType.DATE)));

    private final RptReportRepository repo;
    private final RptSourceLayouts layouts;
    private final UplPackageRepository packages;
    private final FndActors actors;
    private final ModuleRegistryService modules;

    public RptDefinitionService(RptReportRepository repo, RptSourceLayouts layouts, UplPackageRepository packages,
                                FndActors actors, @Autowired(required = false) ModuleRegistryService modules) {
        this.repo = repo;
        this.layouts = layouts;
        this.packages = packages;
        this.actors = actors;
        this.modules = modules;
    }

    public List<ReportItem> list() {
        requireModule();
        return repo.list();
    }

    public Definition get(long id) {
        requireModule();
        return definition(requireRow(id));
    }

    @Transactional
    public Definition create(DefinitionInput input, long userId) {
        requireModule();
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        validate(input, null);
        long id;
        try {
            id = repo.insert(toRow(input), actor.name());
        } catch (DuplicateKeyException race) {
            throw nameTaken();
        }
        log.info("Отчёт {}: описание сохранено", id);
        return definition(requireRow(id));
    }

    @Transactional
    public Definition update(long id, DefinitionInput input, long userId) {
        requireModule();
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        requireRow(id);
        validate(input, id);
        int updated;
        try {
            updated = repo.update(id, input.lockVersion(), toRow(input), actor.name());
        } catch (DuplicateKeyException race) {
            throw nameTaken();
        }
        if (updated == 0) {
            throw ApiException.conflict(ErrorCode.CONFLICT, RptErrors.RPT_CONFLICT);
        }
        log.info("Отчёт {}: описание сохранено", id);
        return definition(requireRow(id));
    }

    public List<SourceItem> sources() {
        requireModule();
        return packages.appliedSources().stream()
                .map(source -> new SourceItem(source.id(), source.code(), source.name()))
                .toList();
    }

    public SourceLayout layout(long sourceId, Integer sheet) {
        requireModule();
        Layout layout = layouts.resolve(sourceId, sheet)
                .orElseThrow(() -> invalid(List.of(error("sourceId", RptErrors.RPT_SOURCE_UNKNOWN))));
        if (layout.chosen() == null) {
            throw invalid(List.of(error("sourceSheet", RptErrors.RPT_SOURCE_UNKNOWN)));
        }
        List<ColumnItem> columns = layout.columns().values().stream()
                .map(column -> new ColumnItem(column.targetField(), layout.label(column.targetField()),
                        column.dataType().db()))
                .toList();
        return new SourceLayout(sourceId, layout.sheets(), layout.chosen().ordinal(), columns);
    }

    // ---------- проверка описания (2.2, 10.3) ----------

    private void validate(DefinitionInput in, Long ownId) {
        List<FieldErrorItem> errors = new ArrayList<>();
        if (ownId != null && in.lockVersion() == null) {
            errors.add(error("lockVersion", RptErrors.RPT_DEFINITION_INVALID));
        }
        checkName(in.name(), ownId, errors);
        if (in.measureName() != null || in.first().monthFields() != null) {
            checkMeasureName(in.measureName(), "measureName", errors);
        }
        checkMeasurePart(FIRST, in.first(), errors);
        MeasureInput second = in.second();
        if (second != null) {
            checkMeasureName(second.name(), SECOND + "name", errors);
            checkMeasurePart(SECOND, second, errors);
            if ((second.level2() == null) != (in.level2() == null)) {
                errors.add(error(SECOND + "level2", RptErrors.RPT_LEVELS_MISMATCH));
            }
        }
        if (!errors.isEmpty()) {
            throw invalid(errors);
        }
    }

    private void checkName(String name, Long ownId, List<FieldErrorItem> errors) {
        String trimmed = name == null ? "" : name.strip();
        if (trimmed.isEmpty() || trimmed.length() > RptLimits.MAX_NAME_LENGTH) {
            errors.add(error("name", RptErrors.RPT_DEFINITION_INVALID));
        } else if (repo.nameTaken(trimmed, ownId)) {
            errors.add(error("name", RptErrors.RPT_NAME_TAKEN));
        }
    }

    private static void checkMeasureName(String name, String path, List<FieldErrorItem> errors) {
        String trimmed = name == null ? "" : name.strip();
        if (trimmed.isEmpty() || trimmed.length() > RptLimits.MAX_MEASURE_NAME_LENGTH) {
            errors.add(error(path, RptErrors.RPT_MEASURE_NAME_INVALID));
        }
    }

    /** Все правила одной меры; {@code prefix} — приставка полей в {@code errors[]} (у меры 2 — {@code second.}). */
    private void checkMeasurePart(String prefix, MeasureInput m, List<FieldErrorItem> errors) {
        checkFormat(prefix, m, errors);
        Layout source = part(m.sourceId(), m.sourceSheet(), prefix + "sourceId", prefix + "sourceSheet", errors);
        Layout ref = refPart(prefix, m, errors);
        checkPeriod(prefix, m, source, errors);
        checkKeys(prefix, m.ref(), source, ref, errors);
        checkLevel(prefix, "level1", m.level1(), m, source, ref, errors);
        checkLevel2(prefix, m, source, ref, errors);
    }

    private static void checkFormat(String prefix, MeasureInput m, List<FieldErrorItem> errors) {
        if (m.divisor() == null || !RptLimits.DIVISORS.contains(m.divisor())) {
            errors.add(error(prefix + "divisor", RptErrors.RPT_FORMAT_INVALID));
        }
        if (m.decimals() == null || m.decimals() < 0 || m.decimals() > RptLimits.MAX_DECIMALS) {
            errors.add(error(prefix + "decimals", RptErrors.RPT_FORMAT_INVALID));
        }
    }

    private Layout refPart(String prefix, MeasureInput m, List<FieldErrorItem> errors) {
        RefPart ref = m.ref();
        if (ref == null) {
            return null;
        }
        if (ref.sourceId() != null && ref.sourceId().equals(m.sourceId())) {
            errors.add(error(prefix + "ref.sourceId", RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        return part(ref.sourceId(), ref.sheet(), prefix + "ref.sourceId", prefix + "ref.sheet", errors);
    }

    /** Лист источника по анкете; источника или листа нет — ошибка и null (колонки тогда не проверяются). */
    private Layout part(Long sourceId, Integer sheet, String sourceField, String sheetField,
                        List<FieldErrorItem> errors) {
        if (sourceId == null) {
            errors.add(error(sourceField, RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        Layout layout = layouts.resolve(sourceId, sheet).orElse(null);
        if (layout == null) {
            errors.add(error(sourceField, RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        if (sheet == null || layout.chosen() == null) {
            errors.add(error(sheetField, RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        return layout;
    }

    /** Период меры: ровно одно из колонки-даты (тогда нужна мера) и колонок-месяцев (тогда меры нет). */
    private static void checkPeriod(String prefix, MeasureInput m, Layout source, List<FieldErrorItem> errors) {
        boolean byDate = m.dateField() != null;
        boolean byMonths = m.monthFields() != null;
        if (byDate == byMonths) {
            errors.add(error(prefix + "dateField", RptErrors.RPT_PERIOD_INVALID));
            return;
        }
        if (byDate) {
            checkColumn(source, m.dateField(), prefix + "dateField", Set.of(DataType.DATE), errors);
            checkMeasure(prefix, m.measure(), source, errors);
            return;
        }
        if (m.measure() != null) {
            errors.add(error(prefix + "dateField", RptErrors.RPT_PERIOD_INVALID));
        }
        checkMonths(prefix, m.monthFields(), source, errors);
    }

    private static void checkMonths(String prefix, List<String> months, Layout source, List<FieldErrorItem> errors) {
        String path = prefix + "monthFields";
        if (months.size() != RptLimits.MONTHS) {
            errors.add(error(path, RptErrors.RPT_PERIOD_INVALID));
            return;
        }
        if (months.stream().allMatch(Objects::isNull)) {
            errors.add(error(path, RptErrors.RPT_MONTHS_EMPTY));
            return;
        }
        for (int i = 0; i < months.size(); i++) {
            if (months.get(i) != null) {
                checkColumn(source, months.get(i), path + "[" + i + "]", NUMERIC, errors);
            }
        }
    }

    private static void checkMeasure(String prefix, Measure measure, Layout source, List<FieldErrorItem> errors) {
        if (measure == null || measure.kind() == null) {
            errors.add(error(prefix + "measure.kind", RptErrors.RPT_FORMAT_INVALID));
            return;
        }
        switch (measure.kind()) {
            case RptModel.MEASURE_TOTAL -> checkColumn(source, measure.field(), prefix + "measure.field", NUMERIC, errors);
            case RptModel.MEASURE_COUNT -> {
                if (measure.field() != null) {
                    errors.add(error(prefix + "measure.field", RptErrors.RPT_FORMAT_INVALID));
                }
            }
            default -> errors.add(error(prefix + "measure.kind", RptErrors.RPT_FORMAT_INVALID));
        }
    }

    private static void checkKeys(String prefix, RefPart ref, Layout source, Layout refLayout,
                                  List<FieldErrorItem> errors) {
        if (ref == null) {
            return;
        }
        List<KeyPair> keys = ref.keys();
        if (keys == null || keys.isEmpty() || keys.size() > RptLimits.MAX_KEYS
                || keys.stream().anyMatch(Objects::isNull)) {
            errors.add(error(prefix + "ref.keys", RptErrors.RPT_KEYS_INVALID));
            return;
        }
        if (keys.size() > 1 && (Objects.equals(keys.get(0).field(), keys.get(1).field())
                || Objects.equals(keys.get(0).refField(), keys.get(1).refField()))) {
            errors.add(error(prefix + "ref.keys", RptErrors.RPT_KEYS_INVALID));
        }
        for (int i = 0; i < keys.size(); i++) {
            String path = prefix + "ref.keys[" + i + "]";
            checkColumn(source, keys.get(i).field(), path + ".field", NOT_DATE, errors);
            checkColumn(refLayout, keys.get(i).refField(), path + ".refField", NOT_DATE, errors);
        }
    }

    private static void checkLevel(String prefix, String name, LevelPart level, MeasureInput m, Layout source,
                                   Layout ref, List<FieldErrorItem> errors) {
        String field = prefix + name + ".field";
        if (level == null) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        boolean fromSource = RptModel.ORIGIN_SOURCE.equals(level.origin());
        boolean fromRef = RptModel.ORIGIN_REF.equals(level.origin());
        if (!fromSource && !(fromRef && m.ref() != null)) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        if (fromSource && isMeasureColumn(m.measure(), level.field())) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        checkColumn(fromSource ? source : ref, level.field(), field, NOT_DATE, errors);
    }

    private static void checkLevel2(String prefix, MeasureInput m, Layout source, Layout ref,
                                    List<FieldErrorItem> errors) {
        LevelPart level2 = m.level2();
        if (level2 == null) {
            return;
        }
        LevelPart level1 = m.level1();
        if (level1 != null && Objects.equals(level1.origin(), level2.origin())
                && Objects.equals(level1.field(), level2.field())) {
            errors.add(error(prefix + "level2.field", RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        checkLevel(prefix, "level2", level2, m, source, ref, errors);
    }

    private static boolean isMeasureColumn(Measure measure, String field) {
        return measure != null && RptModel.MEASURE_TOTAL.equals(measure.kind())
                && measure.field() != null && measure.field().equals(field);
    }

    /** Колонка есть в анкете листа и её тип из разрешённых; лист не определён — не проверяется. */
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

    // ---------- преобразования ----------

    private static Row toRow(DefinitionInput in) {
        MeasureRow first = measureRow(in.first());
        MeasureRow second = in.second() == null ? null : measureRow(in.second());
        return new Row(null, in.name().strip(), first.sourceId(), first.sourceSheet(), first.dateField(),
                first.measureKind(), first.measureField(), first.divisor(), first.decimals(),
                first.refSourceId(), first.refSheet(), first.key1Field(), first.key1RefField(),
                first.key2Field(), first.key2RefField(), first.level1Origin(), first.level1Field(),
                first.level2Origin(), first.level2Field(), 0, null, null,
                first.name(), first.monthFields(), second);
    }

    /** Мера из проверенного описания в колонки базы; колонки-месяцы — вид {@code months} без колонки меры. */
    private static MeasureRow measureRow(MeasureInput m) {
        boolean byMonths = m.monthFields() != null;
        String kind = byMonths ? RptModel.MEASURE_MONTHS : m.measure().kind();
        String measureField = RptModel.MEASURE_TOTAL.equals(kind) ? m.measure().field() : null;
        RefPart ref = m.ref();
        KeyPair key1 = ref == null ? null : ref.keys().get(0);
        KeyPair key2 = ref == null || ref.keys().size() < RptLimits.MAX_KEYS ? null : ref.keys().get(1);
        LevelPart level2 = m.level2();
        return new MeasureRow(m.name() == null ? null : m.name().strip(), m.sourceId(), m.sourceSheet(),
                byMonths ? null : m.dateField(), byMonths ? copyMonths(m.monthFields()) : null,
                kind, measureField, m.divisor(), m.decimals(),
                ref == null ? null : ref.sourceId(), ref == null ? null : ref.sheet(),
                key1 == null ? null : key1.field(), key1 == null ? null : key1.refField(),
                key2 == null ? null : key2.field(), key2 == null ? null : key2.refField(),
                m.level1().origin(), m.level1().field(),
                level2 == null ? null : level2.origin(), level2 == null ? null : level2.field());
    }

    private static List<String> copyMonths(List<String> months) {
        return Collections.unmodifiableList(new ArrayList<>(months));
    }

    private Definition definition(Row row) {
        MeasureInput first = measureInput(row.first());
        Map<String, String> labels = new LinkedHashMap<>();
        putMeasureLabels(labels, FIRST, row.first());
        MeasureInput second = null;
        if (row.second() != null) {
            second = measureInput(row.second());
            putMeasureLabels(labels, SECOND, row.second());
        }
        return new Definition(row.id(), row.name(), row.sourceId(), row.sourceSheet(), first.dateField(),
                first.measure(), row.divisor(), row.decimals(), first.ref(), first.level1(), first.level2(),
                row.lockVersion(), row.modifiedAt(), row.modifiedBy(), labels,
                first.name(), first.monthFields(), second);
    }

    /** Мера из колонок базы в вид API: при колонках-месяцах {@code measure = null}. */
    private static MeasureInput measureInput(MeasureRow row) {
        boolean byMonths = RptModel.MEASURE_MONTHS.equals(row.measureKind());
        RefPart ref = row.refSourceId() == null ? null
                : new RefPart(row.refSourceId(), row.refSheet(), keys(row));
        LevelPart level2 = row.level2Origin() == null ? null : new LevelPart(row.level2Origin(), row.level2Field());
        return new MeasureInput(row.name(), row.sourceId(), row.sourceSheet(), row.dateField(), row.monthFields(),
                byMonths ? null : new Measure(row.measureKind(), row.measureField()), row.divisor(), row.decimals(),
                ref, new LevelPart(row.level1Origin(), row.level1Field()), level2);
    }

    private static List<KeyPair> keys(MeasureRow row) {
        List<KeyPair> keys = new ArrayList<>();
        keys.add(new KeyPair(row.key1Field(), row.key1RefField()));
        if (row.key2Field() != null) {
            keys.add(new KeyPair(row.key2Field(), row.key2RefField()));
        }
        return List.copyOf(keys);
    }

    /** Подписи полей меры по текущей анкете; поля, которого в анкете нет, в ответе нет (2.3). */
    private void putMeasureLabels(Map<String, String> labels, String prefix, MeasureRow row) {
        List<String> sourceFields = new ArrayList<>();
        List<String> refFields = new ArrayList<>();
        addIfPresent(sourceFields, row.dateField());
        if (row.monthFields() != null) {
            row.monthFields().forEach(field -> addIfPresent(sourceFields, field));
        }
        addIfPresent(sourceFields, row.measureField());
        addIfPresent(sourceFields, row.key1Field());
        addIfPresent(sourceFields, row.key2Field());
        addIfPresent(refFields, row.key1RefField());
        addIfPresent(refFields, row.key2RefField());
        addLevel(row.level1Origin(), row.level1Field(), sourceFields, refFields);
        addLevel(row.level2Origin(), row.level2Field(), sourceFields, refFields);

        layouts.resolve(row.sourceId(), row.sourceSheet())
                .ifPresent(layout -> putLabels(labels, prefix + LABEL_SOURCE, layout, sourceFields));
        if (row.refSourceId() != null) {
            layouts.resolve(row.refSourceId(), row.refSheet())
                    .ifPresent(layout -> putLabels(labels, prefix + LABEL_REF, layout, refFields));
        }
    }

    private static void addLevel(String origin, String field, List<String> sourceFields, List<String> refFields) {
        if (RptModel.ORIGIN_SOURCE.equals(origin)) {
            addIfPresent(sourceFields, field);
        } else if (RptModel.ORIGIN_REF.equals(origin)) {
            addIfPresent(refFields, field);
        }
    }

    private static void addIfPresent(List<String> fields, String field) {
        if (field != null) {
            fields.add(field);
        }
    }

    private static void putLabels(Map<String, String> labels, String prefix, Layout layout, List<String> fields) {
        if (layout.chosen() == null) {
            return;
        }
        for (String field : fields) {
            String label = layout.label(field);
            if (label != null) {
                labels.put(prefix + field, label);
            }
        }
    }

    // ---------- помощники ----------

    private Row requireRow(long id) {
        return repo.find(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, RptErrors.RPT_REPORT_NOT_FOUND));
    }

    private void requireModule() {
        if (modules != null && !modules.isModuleActive(MODULE)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, RptErrors.RPT_MODULE_DISABLED);
        }
    }

    private static ApiException nameTaken() {
        return invalid(List.of(error("name", RptErrors.RPT_NAME_TAKEN)));
    }

    private static ApiException invalid(List<FieldErrorItem> errors) {
        return ApiException.validation(RptErrors.RPT_DEFINITION_INVALID, List.copyOf(errors));
    }

    private static FieldErrorItem error(String field, String code) {
        return new FieldErrorItem(field, code, code);
    }
}
