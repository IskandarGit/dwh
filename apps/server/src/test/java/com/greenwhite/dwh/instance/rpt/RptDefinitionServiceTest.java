package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.ColumnItem;
import com.greenwhite.dwh.instance.rpt.RptModel.Definition;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.MeasureInput;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SheetItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceLayout;
import com.greenwhite.dwh.instance.rpt.RptTestData.RefRow;
import com.greenwhite.dwh.instance.rpt.RptTestData.SourceRow;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.entry;
import static org.assertj.core.api.Assertions.tuple;

/** Описание сводного отчёта: создание, чтение, правило за правилом проверки 2.2, lockVersion, раскладка (контракт И15а). */
class RptDefinitionServiceTest extends EmbeddedPostgresTest {

    private static final LocalDate JAN_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);
    private static final Path RPT_MAIN = Path.of("src/main/java/com/greenwhite/dwh/instance/rpt");
    private static final String REPOSITORY_FILE = "RptReportRepository.java";
    private static final Pattern WRITE_SQL = Pattern.compile(
            "insert\\s+into\\s+(\\w+)|update\\s+(\\w+)\\s+set|delete\\s+from\\s+(\\w+)", Pattern.CASE_INSENSITIVE);

    @Autowired
    private RptDefinitionService service;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private MfFileService files;
    @Autowired
    private ModuleRegistryService modules;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private TransactionTemplate tx;
    @Autowired
    private JsonMapper json;

    private long userId;
    private long sourceId;
    private long refId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from rpt_reports").update();
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        RptTestData data = new RptTestData(sources, packages, parseJob, applies, files, userId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
        data.applySource(sourceId, List.of(
                new SourceRow("15.01.2026", 10.5, 1, "TEST-1", "TEST группа")), JAN_FROM, JAN_TO);
        data.applyRef(refId, List.of(new RefRow("TEST-1", "TEST название")), JAN_FROM, JAN_TO);
    }

    @AfterEach
    void enableModule() {
        setModule(true);
    }

    @Test
    @DisplayName("AC-2: описание создаётся и читается как введено, подписи полей — из анкеты; список — с именем источника")
    void createAndReadDefinition() {
        DefinitionInput input = valid().build();

        Definition created = service.create(input, userId);
        Definition read = service.get(created.id());

        assertThat(read).isEqualTo(created);
        assertThat(read.name()).isEqualTo(input.name());
        assertThat(read.sourceId()).isEqualTo(input.sourceId());
        assertThat(read.sourceSheet()).isEqualTo(input.sourceSheet());
        assertThat(read.dateField()).isEqualTo(input.dateField());
        assertThat(read.measure()).isEqualTo(input.measure());
        assertThat(read.divisor()).isEqualTo(input.divisor());
        assertThat(read.decimals()).isEqualTo(input.decimals());
        assertThat(read.ref()).isEqualTo(input.ref());
        assertThat(read.level1()).isEqualTo(input.level1());
        assertThat(read.level2()).isEqualTo(input.level2());
        assertThat(read.lockVersion()).isZero();
        assertThat(read.modifiedBy()).isEqualTo(String.valueOf(userId));
        assertThat(read.labels()).containsOnly(
                entry("source:" + RptTestData.DATE, "Дата TEST"),
                entry("source:" + RptTestData.AMOUNT, "Сумма TEST"),
                entry("source:" + RptTestData.CODE, "Код TEST"),
                entry("source:" + RptTestData.GROUP, "Группа TEST"),
                entry("ref:" + RptTestData.REF_CODE, "Код справочника TEST"),
                entry("ref:" + RptTestData.REF_NAME, "Название TEST"));

        assertThat(service.list()).extracting(ReportItem::id, ReportItem::name, ReportItem::sourceName)
                .containsExactly(tuple(created.id(), input.name(), "TEST источник"));
    }

    @Test
    @DisplayName("2.2: пустое название — name RPT_DEFINITION_INVALID")
    void emptyName() {
        assertInvalid(valid().name("   "), "name", RptErrors.RPT_DEFINITION_INVALID);
    }

    @Test
    @DisplayName("2.2: название занято без учёта регистра и пробелов — name RPT_NAME_TAKEN")
    void nameTaken() {
        service.create(valid().name("TEST report A").build(), userId);

        assertInvalid(valid().name("  test REPORT a "), "name", RptErrors.RPT_NAME_TAKEN);
    }

    @Test
    @DisplayName("2.2: название кириллицей в другом регистре занято — name RPT_NAME_TAKEN")
    void cyrillicNameTaken() {
        service.create(valid().name("TEST Свод").build(), userId);

        assertInvalid(valid().name("test СВОД"), "name", RptErrors.RPT_NAME_TAKEN);
    }

    @Test
    @DisplayName("Индекс rpt_reports_uk_name: две строки, отличающиеся регистром кириллицы, не вставляются")
    void uniqueIndexIgnoresCyrillicCase() {
        insertReportRow("TEST Свод");

        assertThatThrownBy(() -> insertReportRow("test СВОД"))
                .isInstanceOf(DuplicateKeyException.class)
                .hasMessageContaining("rpt_reports_uk_name");
    }

    @Test
    @DisplayName("2.2: источника нет — sourceId RPT_SOURCE_UNKNOWN")
    void unknownSource() {
        assertInvalid(valid().sourceId(-1L), "sourceId", RptErrors.RPT_SOURCE_UNKNOWN);
    }

    @Test
    @DisplayName("2.2: листа нет в анкете — sourceSheet RPT_SOURCE_UNKNOWN")
    void unknownSheet() {
        assertInvalid(valid().sourceSheet(99), "sourceSheet", RptErrors.RPT_SOURCE_UNKNOWN);
    }

    @Test
    @DisplayName("2.2: справочник равен источнику — ref.sourceId RPT_SOURCE_UNKNOWN")
    void refIsSource() {
        assertInvalid(valid().ref(new RefPart(sourceId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.CODE)))),
                "ref.sourceId", RptErrors.RPT_SOURCE_UNKNOWN);
    }

    @Test
    @DisplayName("2.2: колонка даты не типа «дата» — dateField RPT_COLUMN_TYPE")
    void dateFieldNotDate() {
        assertInvalid(valid().dateField(RptTestData.CODE), "dateField", RptErrors.RPT_COLUMN_TYPE);
    }

    @Test
    @DisplayName("2.2: мера — текстовая колонка — measure.field RPT_COLUMN_TYPE")
    void measureIsText() {
        assertInvalid(valid().measure(new Measure(RptModel.MEASURE_TOTAL, RptTestData.CODE)),
                "measure.field", RptErrors.RPT_COLUMN_TYPE);
    }

    @Test
    @DisplayName("2.2: мера «число строк» с колонкой — measure.field RPT_FORMAT_INVALID")
    void countWithField() {
        assertInvalid(valid().measure(new Measure(RptModel.MEASURE_COUNT, RptTestData.AMOUNT)),
                "measure.field", RptErrors.RPT_FORMAT_INVALID);
    }

    @Test
    @DisplayName("2.2: пар ключа 0 или 3 — ref.keys RPT_KEYS_INVALID")
    void keysCount() {
        assertInvalid(valid().ref(new RefPart(refId, 1, List.of())), "ref.keys", RptErrors.RPT_KEYS_INVALID);
        KeyPair pair = new KeyPair(RptTestData.CODE, RptTestData.REF_CODE);
        assertInvalid(valid().ref(new RefPart(refId, 1, List.of(pair,
                        new KeyPair(RptTestData.GROUP, RptTestData.REF_NAME),
                        new KeyPair(RptTestData.QTY, RptTestData.OBJECT)))),
                "ref.keys", RptErrors.RPT_KEYS_INVALID);
    }

    @Test
    @DisplayName("2.2: колонка ключа — дата — ref.keys[0].field RPT_COLUMN_TYPE")
    void keyIsDate() {
        assertInvalid(valid().ref(new RefPart(refId, 1, List.of(new KeyPair(RptTestData.DATE, RptTestData.REF_CODE)))),
                "ref.keys[0].field", RptErrors.RPT_COLUMN_TYPE);
    }

    @Test
    @DisplayName("2.2: уровень из справочника без справочника — level1.field RPT_LEVEL_INVALID")
    void refLevelWithoutRef() {
        assertInvalid(valid().ref(null).level1(new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME)),
                "level1.field", RptErrors.RPT_LEVEL_INVALID);
    }

    @Test
    @DisplayName("2.2: уровень 2 равен уровню 1 — level2.field RPT_LEVEL_INVALID")
    void level2EqualsLevel1() {
        LevelPart group = new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP);
        assertInvalid(valid().level1(group).level2(group), "level2.field", RptErrors.RPT_LEVEL_INVALID);
    }

    @Test
    @DisplayName("2.2: уровень — колонка меры — level1.field RPT_LEVEL_INVALID")
    void levelIsMeasure() {
        assertInvalid(valid().level1(new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.AMOUNT)),
                "level1.field", RptErrors.RPT_LEVEL_INVALID);
    }

    @Test
    @DisplayName("2.2: делитель не из списка — divisor RPT_FORMAT_INVALID")
    void divisorOutOfList() {
        assertInvalid(valid().divisor(10), "divisor", RptErrors.RPT_FORMAT_INVALID);
    }

    @Test
    @DisplayName("2.2: знаков после запятой 4 — decimals RPT_FORMAT_INVALID")
    void decimalsOutOfRange() {
        assertInvalid(valid().decimals(4), "decimals", RptErrors.RPT_FORMAT_INVALID);
    }

    @Test
    @DisplayName("2.2: несколько ошибок — все в одном ответе")
    void allErrorsAtOnce() {
        assertInvalid(valid().name("").divisor(10).dateField("TEST_none"),
                tuple("name", RptErrors.RPT_DEFINITION_INVALID),
                tuple("divisor", RptErrors.RPT_FORMAT_INVALID),
                tuple("dateField", RptErrors.RPT_COLUMN_UNKNOWN));
    }

    @Test
    @DisplayName("AC-2: правка с верным lockVersion увеличивает его, со старым — 409 RPT_CONFLICT")
    void lockVersionGuardsUpdate() {
        Definition created = service.create(valid().build(), userId);

        Definition updated = service.update(created.id(), valid().name("TEST renamed").lockVersion(0).build(), userId);

        assertThat(updated.lockVersion()).isEqualTo(1);
        assertThat(updated.name()).isEqualTo("TEST renamed");
        assertThatThrownBy(() -> service.update(created.id(), valid().lockVersion(0).build(), userId))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
                    assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(409);
                    assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_CONFLICT);
                });
    }

    @Test
    @DisplayName("AC-2: раскладка для формы — листы и колонки с типами; источники — только с применённой загрузкой")
    void layoutAndSources() {
        SourceLayout layout = service.layout(sourceId, null);

        assertThat(layout.sheets()).containsExactly(new SheetItem(1, RptTestData.SOURCE_SHEET));
        assertThat(layout.sheet()).isEqualTo(1);
        assertThat(layout.columns()).extracting(ColumnItem::field, ColumnItem::label, ColumnItem::type)
                .containsExactly(
                        tuple(RptTestData.OBJECT, "Ключ TEST", "object_key"),
                        tuple(RptTestData.DATE, "Дата TEST", "date"),
                        tuple(RptTestData.AMOUNT, "Сумма TEST", "number"),
                        tuple(RptTestData.QTY, "Количество TEST", "integer"),
                        tuple(RptTestData.CODE, "Код TEST", "text"),
                        tuple(RptTestData.GROUP, "Группа TEST", "text"));

        long notApplied = new RptTestData(sources, packages, parseJob, applies, files, userId).publishedSource();
        assertThat(service.sources()).extracting(SourceItem::id)
                .contains(sourceId, refId)
                .doesNotContain(notApplied);
    }

    @Test
    @DisplayName("Модуль «Отчёты» выключен — 400 RPT_MODULE_DISABLED")
    void disabledModule() {
        setModule(false);

        assertThatThrownBy(() -> service.list()).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.BAD_REQUEST);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(400);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_MODULE_DISABLED);
        });
    }

    @Test
    @DisplayName("Запись: создание даёт одну строку rpt_reports; SQL записи в rpt — только в хранилище и только в rpt_reports или rpt_report_measures2")
    void writesOnlyReportsTable() throws IOException {
        service.create(valid().build(), userId);

        assertThat(jdbc.sql("select count(*) from rpt_reports").query(Long.class).single()).isEqualTo(1L);

        List<Path> moduleFiles;
        try (Stream<Path> tree = Files.walk(RPT_MAIN)) {
            moduleFiles = tree.filter(path -> path.toString().endsWith(".java")).toList();
        }
        assertThat(moduleFiles).isNotEmpty();
        for (Path file : moduleFiles) {
            Matcher matcher = WRITE_SQL.matcher(Files.readString(file, StandardCharsets.UTF_8));
            boolean repository = file.getFileName().toString().equals(REPOSITORY_FILE);
            while (matcher.find()) {
                assertThat(repository).as(file.toString()).isTrue();
                assertThat(tableOf(matcher).toLowerCase(Locale.ROOT)).as(file.toString())
                        .isIn("rpt_reports", "rpt_report_measures2");
            }
        }
    }

    // ---------- И15б: название меры, колонки-месяцы, мера 2 (контракт 10.3, 10.10) ----------

    @Test
    @DisplayName("10.3: прежнее тело JSON без новых полей — отчёт создаётся, measureName/monthFields/second = null")
    void oldJsonBodyAccepted() {
        String body = """
                {"name": "TEST old body", "sourceId": %d, "sourceSheet": 1, "dateField": "%s",
                 "measure": {"kind": "total", "field": "%s"}, "divisor": 1000, "decimals": 2,
                 "ref": {"sourceId": %d, "sheet": 1, "keys": [{"field": "%s", "refField": "%s"}]},
                 "level1": {"origin": "ref", "field": "%s"}, "level2": {"origin": "source", "field": "%s"}}
                """.formatted(sourceId, RptTestData.DATE, RptTestData.AMOUNT, refId, RptTestData.CODE,
                RptTestData.REF_CODE, RptTestData.REF_NAME, RptTestData.GROUP);

        DefinitionInput input = json.readValue(body, DefinitionInput.class);
        Definition created = service.create(input, userId);
        Definition read = service.get(created.id());

        assertThat(input.measureName()).isNull();
        assertThat(input.monthFields()).isNull();
        assertThat(input.second()).isNull();
        assertThat(read.measureName()).isNull();
        assertThat(read.monthFields()).isNull();
        assertThat(read.second()).isNull();
        assertThat(read.dateField()).isEqualTo(RptTestData.DATE);
        assertThat(read.measure()).isEqualTo(new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT));
        assertThat(jdbc.sql("select count(*) from rpt_report_measures2").query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("10.3: название меры и колонки-месяцы сохраняются; в базе вид months, в API measure = null")
    void measureNameAndMonthFields() {
        List<String> months = RptTestData.months(RptTestData.AMOUNT, null, RptTestData.QTY);

        Definition created = service.create(valid().measureName("  TEST мера  ").dateField(null).measure(null)
                .monthFields(months).build(), userId);
        Definition read = service.get(created.id());

        assertThat(read.measureName()).isEqualTo("TEST мера");
        assertThat(read.monthFields()).containsExactlyElementsOf(months);
        assertThat(read.dateField()).isNull();
        assertThat(read.measure()).isNull();
        assertThat(read.labels()).contains(
                entry("source:" + RptTestData.AMOUNT, "Сумма TEST"),
                entry("source:" + RptTestData.QTY, "Количество TEST"));
        assertThat(jdbc.sql("select measure_kind from rpt_reports where id = :id").param("id", created.id())
                .query(String.class).single()).isEqualTo(RptModel.MEASURE_MONTHS);
    }

    @Test
    @DisplayName("10.3: мера 2 с тем же источником, что мера 1, принимается и читается как введена, подписи — с приставкой second.")
    void secondMeasureReadBack() {
        MeasureInput second = second(null, RptTestData.months(RptTestData.AMOUNT, RptTestData.QTY), null,
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP));

        Definition created = service.create(valid().second(second).build(), userId);
        Definition read = service.get(created.id());

        assertThat(read.second()).isEqualTo(second);
        assertThat(read.labels()).contains(
                entry("second.source:" + RptTestData.AMOUNT, "Сумма TEST"),
                entry("second.source:" + RptTestData.QTY, "Количество TEST"),
                entry("second.source:" + RptTestData.CODE, "Код TEST"),
                entry("second.source:" + RptTestData.GROUP, "Группа TEST"),
                entry("second.ref:" + RptTestData.REF_CODE, "Код справочника TEST"),
                entry("second.ref:" + RptTestData.REF_NAME, "Название TEST"));
        assertThat(jdbc.sql("select count(*) from rpt_report_measures2 where report_id = :id")
                .param("id", created.id()).query(Long.class).single()).isEqualTo(1L);
    }

    @Test
    @DisplayName("10.3: правка с новой мерой 2 заменяет прежнюю; правка без меры 2 удаляет её строку")
    void updateWithoutSecondRemovesIt() {
        MeasureInput byMonths = second(null, RptTestData.months(RptTestData.AMOUNT), null,
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP));
        Definition created = service.create(valid().second(byMonths).build(), userId);

        MeasureInput byDate = second(RptTestData.DATE, null, new Measure(RptModel.MEASURE_COUNT, null),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP));
        Definition replaced = service.update(created.id(), valid().second(byDate).lockVersion(0).build(), userId);
        assertThat(replaced.second()).isEqualTo(byDate);

        Definition removed = service.update(created.id(), valid().lockVersion(1).build(), userId);

        assertThat(removed.second()).isNull();
        assertThat(jdbc.sql("select count(*) from rpt_report_measures2 where report_id = :id")
                .param("id", created.id()).query(Long.class).single()).isZero();
    }

    @Test
    @DisplayName("10.3: нет ни колонки-даты, ни колонок-месяцев — dateField RPT_PERIOD_INVALID")
    void noPeriod() {
        assertInvalid(valid().dateField(null), "dateField", RptErrors.RPT_PERIOD_INVALID);
    }

    @Test
    @DisplayName("10.3: заданы и колонка-дата, и колонки-месяцы — dateField RPT_PERIOD_INVALID")
    void bothPeriods() {
        assertInvalid(valid().measure(null).monthFields(RptTestData.months(RptTestData.AMOUNT)),
                "dateField", RptErrors.RPT_PERIOD_INVALID);
    }

    @Test
    @DisplayName("10.3: мера задана при колонках-месяцах — dateField RPT_PERIOD_INVALID")
    void measureWithMonths() {
        assertInvalid(valid().dateField(null).monthFields(RptTestData.months(RptTestData.AMOUNT)),
                "dateField", RptErrors.RPT_PERIOD_INVALID);
    }

    @Test
    @DisplayName("10.3: колонок-месяцев не 12 — monthFields RPT_PERIOD_INVALID")
    void monthsNotTwelve() {
        assertInvalid(valid().dateField(null).measure(null).monthFields(List.of(RptTestData.AMOUNT)),
                "monthFields", RptErrors.RPT_PERIOD_INVALID);
    }

    @Test
    @DisplayName("10.3: все 12 месяцев «нет» — monthFields RPT_MONTHS_EMPTY")
    void monthsEmpty() {
        assertInvalid(valid().dateField(null).measure(null).monthFields(RptTestData.months()),
                "monthFields", RptErrors.RPT_MONTHS_EMPTY);
    }

    @Test
    @DisplayName("10.3: колонка месяца текстовая — monthFields[1] RPT_COLUMN_TYPE, неизвестная — monthFields[2] RPT_COLUMN_UNKNOWN")
    void monthColumnTypeAndUnknown() {
        assertInvalid(valid().dateField(null).measure(null)
                        .monthFields(RptTestData.months(RptTestData.AMOUNT, RptTestData.CODE, "TEST_none")),
                tuple("monthFields[1]", RptErrors.RPT_COLUMN_TYPE),
                tuple("monthFields[2]", RptErrors.RPT_COLUMN_UNKNOWN));
    }

    @Test
    @DisplayName("10.3: название меры пусто или длиннее 100 — measureName RPT_MEASURE_NAME_INVALID")
    void measureNameLength() {
        assertInvalid(valid().measureName("   "), "measureName", RptErrors.RPT_MEASURE_NAME_INVALID);
        assertInvalid(valid().measureName("T".repeat(101)), "measureName", RptErrors.RPT_MEASURE_NAME_INVALID);
    }

    @Test
    @DisplayName("10.3: у меры 2 нет названия — second.name RPT_MEASURE_NAME_INVALID")
    void secondNameRequired() {
        MeasureInput valid = second(RptTestData.DATE, null, new Measure(RptModel.MEASURE_COUNT, null),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP));
        MeasureInput noName = new MeasureInput(null, valid.sourceId(), valid.sourceSheet(), valid.dateField(),
                valid.monthFields(), valid.measure(), valid.divisor(), valid.decimals(), valid.ref(), valid.level1(),
                valid.level2());

        assertInvalid(valid().second(noName), "second.name", RptErrors.RPT_MEASURE_NAME_INVALID);
    }

    @Test
    @DisplayName("10.3: у меры 2 другое число уровней — second.level2 RPT_LEVELS_MISMATCH (в обе стороны)")
    void levelsMismatch() {
        MeasureInput oneLevel = second(RptTestData.DATE, null, new Measure(RptModel.MEASURE_COUNT, null), null);
        MeasureInput twoLevels = second(RptTestData.DATE, null, new Measure(RptModel.MEASURE_COUNT, null),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP));

        assertInvalid(valid().second(oneLevel), "second.level2", RptErrors.RPT_LEVELS_MISMATCH);
        assertInvalid(valid().level2(null).second(twoLevels), "second.level2", RptErrors.RPT_LEVELS_MISMATCH);
    }

    @Test
    @DisplayName("10.3: правила меры 1 действуют и у меры 2 — поле с приставкой second.")
    void secondUsesSameRules() {
        LevelPart group = new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP);
        assertInvalid(valid().second(second(RptTestData.CODE, null, new Measure(RptModel.MEASURE_COUNT, null), group)),
                "second.dateField", RptErrors.RPT_COLUMN_TYPE);
        assertInvalid(valid().second(second(null, null, null, group)),
                "second.dateField", RptErrors.RPT_PERIOD_INVALID);
        assertInvalid(valid().second(second(null, RptTestData.months(RptTestData.CODE), null, group)),
                "second.monthFields[0]", RptErrors.RPT_COLUMN_TYPE);
        assertInvalid(valid().second(second(null, RptTestData.months(), null, group)),
                "second.monthFields", RptErrors.RPT_MONTHS_EMPTY);

        MeasureInput base = second(RptTestData.DATE, null, new Measure(RptModel.MEASURE_COUNT, null), group);
        MeasureInput refIsSource = new MeasureInput(base.name(), base.sourceId(), base.sourceSheet(), base.dateField(),
                base.monthFields(), base.measure(), base.divisor(), base.decimals(),
                new RefPart(sourceId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.CODE))),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.CODE), group);
        assertInvalid(valid().second(refIsSource), "second.ref.sourceId", RptErrors.RPT_SOURCE_UNKNOWN);

        MeasureInput unknownSource = new MeasureInput(base.name(), -1L, base.sourceSheet(), base.dateField(),
                base.monthFields(), base.measure(), 10, base.decimals(), null,
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.CODE), group);
        assertInvalid(valid().second(unknownSource),
                tuple("second.sourceId", RptErrors.RPT_SOURCE_UNKNOWN),
                tuple("second.divisor", RptErrors.RPT_FORMAT_INVALID));
    }

    /** Мера 2 по тому же источнику и справочнику, что мера 1; уровень 1 — название из справочника. */
    private MeasureInput second(String dateField, List<String> monthFields, Measure measure, LevelPart level2) {
        return new MeasureInput("TEST мера 2", sourceId, 1, dateField, monthFields, measure, 1, 0,
                new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE))),
                new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME), level2);
    }

    // ---------- помощники ----------

    private InputBuilder valid() {
        return new InputBuilder(sourceId, refId);
    }

    private void assertInvalid(InputBuilder input, String field, String code) {
        assertInvalid(input, tuple(field, code));
    }

    private void assertInvalid(InputBuilder input, Tuple... expected) {
        ThrowingCallable call = () -> service.create(input.build(), userId);
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED);
            assertThat(e.getErrorCode().getDefaultStatus()).isEqualTo(422);
            assertThat(e.getMessage()).isEqualTo(RptErrors.RPT_DEFINITION_INVALID);
            assertThat(e.getFieldErrors()).extracting(FieldErrorItem::field, FieldErrorItem::code)
                    .containsExactlyInAnyOrder(expected);
        });
    }

    private static String tableOf(Matcher matcher) {
        for (int group = 1; group <= matcher.groupCount(); group++) {
            if (matcher.group(group) != null) {
                return matcher.group(group);
            }
        }
        return "";
    }

    private void insertReportRow(String name) {
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("""
                            insert into rpt_reports (name, source_id, source_sheet, date_field, measure_field,
                                                     level1_origin, level1_field, created_by, modified_by)
                            values (:name, :sourceId, 1, :dateField, :measureField, 'source', :levelField, 'TEST', 'TEST')
                            """)
                    .param("name", name)
                    .param("sourceId", sourceId)
                    .param("dateField", RptTestData.DATE)
                    .param("measureField", RptTestData.AMOUNT)
                    .param("levelField", RptTestData.GROUP)
                    .update();
        });
    }

    private void setModule(boolean enable) {
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            modules.toggleModuleStatus("rpt", enable);
        });
    }

    /** Верное описание по данным теста; методы меняют одно поле. */
    private static final class InputBuilder {

        private String name = "TEST report";
        private Long sourceId;
        private Integer sourceSheet = 1;
        private String dateField = RptTestData.DATE;
        private Measure measure = new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT);
        private Integer divisor = 1000;
        private Integer decimals = 2;
        private RefPart ref;
        private LevelPart level1 = new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME);
        private LevelPart level2 = new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP);
        private Integer lockVersion;
        private String measureName;
        private List<String> monthFields;
        private MeasureInput second;

        InputBuilder(long sourceId, long refId) {
            this.sourceId = sourceId;
            this.ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        }

        InputBuilder name(String value) {
            name = value;
            return this;
        }

        InputBuilder sourceId(Long value) {
            sourceId = value;
            return this;
        }

        InputBuilder sourceSheet(Integer value) {
            sourceSheet = value;
            return this;
        }

        InputBuilder dateField(String value) {
            dateField = value;
            return this;
        }

        InputBuilder measure(Measure value) {
            measure = value;
            return this;
        }

        InputBuilder divisor(Integer value) {
            divisor = value;
            return this;
        }

        InputBuilder decimals(Integer value) {
            decimals = value;
            return this;
        }

        InputBuilder ref(RefPart value) {
            ref = value;
            return this;
        }

        InputBuilder level1(LevelPart value) {
            level1 = value;
            return this;
        }

        InputBuilder level2(LevelPart value) {
            level2 = value;
            return this;
        }

        InputBuilder lockVersion(Integer value) {
            lockVersion = value;
            return this;
        }

        InputBuilder measureName(String value) {
            measureName = value;
            return this;
        }

        InputBuilder monthFields(List<String> value) {
            monthFields = value;
            return this;
        }

        InputBuilder second(MeasureInput value) {
            second = value;
            return this;
        }

        DefinitionInput build() {
            return new DefinitionInput(name, sourceId, sourceSheet, dateField, measure, divisor, decimals, ref,
                    level1, level2, lockVersion, measureName, monthFields, second);
        }
    }
}
