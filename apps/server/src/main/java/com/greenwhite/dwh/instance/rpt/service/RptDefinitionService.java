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
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceLayout;
import com.greenwhite.dwh.instance.rpt.repo.RptReportRepository;
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
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Описание сводного отчёта (контракт И15а, разделы 2, 2.2): список, чтение, создание и правка с {@code lockVersion},
 * источники и раскладка для формы. Названия и поля отчёта в журнал не пишутся.
 */
@Service
@Transactional(readOnly = true)
public class RptDefinitionService {

    private static final Logger log = LoggerFactory.getLogger(RptDefinitionService.class);

    private static final String MODULE = "rpt";
    private static final String LABEL_SOURCE = "source:";
    private static final String LABEL_REF = "ref:";
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

    // ---------- проверка описания (2.2) ----------

    private void validate(DefinitionInput in, Long ownId) {
        List<FieldErrorItem> errors = new ArrayList<>();
        if (ownId != null && in.lockVersion() == null) {
            errors.add(error("lockVersion", RptErrors.RPT_DEFINITION_INVALID));
        }
        checkName(in.name(), ownId, errors);
        checkFormat(in, errors);
        Layout source = sourcePart(in, errors);
        Layout ref = refPart(in, errors);
        checkColumn(source, in.dateField(), "dateField", Set.of(DataType.DATE), errors);
        checkMeasure(in.measure(), source, errors);
        checkKeys(in.ref(), source, ref, errors);
        checkLevel("level1", in.level1(), in, source, ref, errors);
        checkLevel2(in, source, ref, errors);
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

    private static void checkFormat(DefinitionInput in, List<FieldErrorItem> errors) {
        if (in.divisor() == null || !RptLimits.DIVISORS.contains(in.divisor())) {
            errors.add(error("divisor", RptErrors.RPT_FORMAT_INVALID));
        }
        if (in.decimals() == null || in.decimals() < 0 || in.decimals() > RptLimits.MAX_DECIMALS) {
            errors.add(error("decimals", RptErrors.RPT_FORMAT_INVALID));
        }
    }

    /** Лист источника по анкете; источника или листа нет — ошибка и null (колонки тогда не проверяются). */
    private Layout sourcePart(DefinitionInput in, List<FieldErrorItem> errors) {
        return part(in.sourceId(), in.sourceSheet(), "sourceId", "sourceSheet", errors);
    }

    private Layout refPart(DefinitionInput in, List<FieldErrorItem> errors) {
        RefPart ref = in.ref();
        if (ref == null) {
            return null;
        }
        if (ref.sourceId() != null && ref.sourceId().equals(in.sourceId())) {
            errors.add(error("ref.sourceId", RptErrors.RPT_SOURCE_UNKNOWN));
            return null;
        }
        return part(ref.sourceId(), ref.sheet(), "ref.sourceId", "ref.sheet", errors);
    }

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

    private static void checkMeasure(Measure measure, Layout source, List<FieldErrorItem> errors) {
        if (measure == null || measure.kind() == null) {
            errors.add(error("measure.kind", RptErrors.RPT_FORMAT_INVALID));
            return;
        }
        switch (measure.kind()) {
            case RptModel.MEASURE_TOTAL -> checkColumn(source, measure.field(), "measure.field", NUMERIC, errors);
            case RptModel.MEASURE_COUNT -> {
                if (measure.field() != null) {
                    errors.add(error("measure.field", RptErrors.RPT_FORMAT_INVALID));
                }
            }
            default -> errors.add(error("measure.kind", RptErrors.RPT_FORMAT_INVALID));
        }
    }

    private static void checkKeys(RefPart ref, Layout source, Layout refLayout, List<FieldErrorItem> errors) {
        if (ref == null) {
            return;
        }
        List<KeyPair> keys = ref.keys();
        if (keys == null || keys.isEmpty() || keys.size() > RptLimits.MAX_KEYS
                || keys.stream().anyMatch(Objects::isNull)) {
            errors.add(error("ref.keys", RptErrors.RPT_KEYS_INVALID));
            return;
        }
        if (keys.size() > 1 && (Objects.equals(keys.get(0).field(), keys.get(1).field())
                || Objects.equals(keys.get(0).refField(), keys.get(1).refField()))) {
            errors.add(error("ref.keys", RptErrors.RPT_KEYS_INVALID));
        }
        for (int i = 0; i < keys.size(); i++) {
            String path = "ref.keys[" + i + "]";
            checkColumn(source, keys.get(i).field(), path + ".field", NOT_DATE, errors);
            checkColumn(refLayout, keys.get(i).refField(), path + ".refField", NOT_DATE, errors);
        }
    }

    private static void checkLevel(String path, LevelPart level, DefinitionInput in, Layout source, Layout ref,
                                   List<FieldErrorItem> errors) {
        String field = path + ".field";
        if (level == null) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        boolean fromSource = RptModel.ORIGIN_SOURCE.equals(level.origin());
        boolean fromRef = RptModel.ORIGIN_REF.equals(level.origin());
        if (!fromSource && !(fromRef && in.ref() != null)) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        if (fromSource && isMeasureColumn(in.measure(), level.field())) {
            errors.add(error(field, RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        checkColumn(fromSource ? source : ref, level.field(), field, NOT_DATE, errors);
    }

    private static void checkLevel2(DefinitionInput in, Layout source, Layout ref, List<FieldErrorItem> errors) {
        LevelPart level2 = in.level2();
        if (level2 == null) {
            return;
        }
        LevelPart level1 = in.level1();
        if (level1 != null && Objects.equals(level1.origin(), level2.origin())
                && Objects.equals(level1.field(), level2.field())) {
            errors.add(error("level2.field", RptErrors.RPT_LEVEL_INVALID));
            return;
        }
        checkLevel("level2", level2, in, source, ref, errors);
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
        Measure measure = in.measure();
        boolean total = RptModel.MEASURE_TOTAL.equals(measure.kind());
        RefPart ref = in.ref();
        KeyPair key1 = ref == null ? null : ref.keys().get(0);
        KeyPair key2 = ref == null || ref.keys().size() < RptLimits.MAX_KEYS ? null : ref.keys().get(1);
        LevelPart level2 = in.level2();
        return new Row(null, in.name().strip(), in.sourceId(), in.sourceSheet(), in.dateField(), measure.kind(),
                total ? measure.field() : null, in.divisor(), in.decimals(),
                ref == null ? null : ref.sourceId(), ref == null ? null : ref.sheet(),
                key1 == null ? null : key1.field(), key1 == null ? null : key1.refField(),
                key2 == null ? null : key2.field(), key2 == null ? null : key2.refField(),
                in.level1().origin(), in.level1().field(),
                level2 == null ? null : level2.origin(), level2 == null ? null : level2.field(),
                0, null, null);
    }

    private Definition definition(Row row) {
        RefPart ref = row.refSourceId() == null ? null
                : new RefPart(row.refSourceId(), row.refSheet(), keys(row));
        LevelPart level2 = row.level2Origin() == null ? null : new LevelPart(row.level2Origin(), row.level2Field());
        return new Definition(row.id(), row.name(), row.sourceId(), row.sourceSheet(), row.dateField(),
                new Measure(row.measureKind(), row.measureField()), row.divisor(), row.decimals(), ref,
                new LevelPart(row.level1Origin(), row.level1Field()), level2,
                row.lockVersion(), row.modifiedAt(), row.modifiedBy(), labels(row));
    }

    private static List<KeyPair> keys(Row row) {
        List<KeyPair> keys = new ArrayList<>();
        keys.add(new KeyPair(row.key1Field(), row.key1RefField()));
        if (row.key2Field() != null) {
            keys.add(new KeyPair(row.key2Field(), row.key2RefField()));
        }
        return List.copyOf(keys);
    }

    /** Подписи полей описания по текущей анкете; поля, которого в анкете нет, в ответе нет (2.3). */
    private Map<String, String> labels(Row row) {
        List<String> sourceFields = new ArrayList<>(List.of(row.dateField()));
        List<String> refFields = new ArrayList<>();
        addIfPresent(sourceFields, row.measureField());
        addIfPresent(sourceFields, row.key1Field());
        addIfPresent(sourceFields, row.key2Field());
        addIfPresent(refFields, row.key1RefField());
        addIfPresent(refFields, row.key2RefField());
        addLevel(row.level1Origin(), row.level1Field(), sourceFields, refFields);
        addLevel(row.level2Origin(), row.level2Field(), sourceFields, refFields);

        Map<String, String> labels = new LinkedHashMap<>();
        layouts.resolve(row.sourceId(), row.sourceSheet())
                .ifPresent(layout -> putLabels(labels, LABEL_SOURCE, layout, sourceFields));
        if (row.refSourceId() != null) {
            layouts.resolve(row.refSourceId(), row.refSheet())
                    .ifPresent(layout -> putLabels(labels, LABEL_REF, layout, refFields));
        }
        return labels;
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
