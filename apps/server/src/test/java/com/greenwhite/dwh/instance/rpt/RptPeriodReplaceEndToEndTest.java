package com.greenwhite.dwh.instance.rpt;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.KeyPair;
import com.greenwhite.dwh.instance.rpt.RptModel.LevelPart;
import com.greenwhite.dwh.instance.rpt.RptModel.Measure;
import com.greenwhite.dwh.instance.rpt.RptModel.RefPart;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptTestData.RefRow;
import com.greenwhite.dwh.instance.rpt.RptTestData.SourceRow;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.rpt.service.RptViewService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Сквозной тест правила «более поздняя загрузка с пересекающимся периодом прячет раннюю» через отчёт
 * (контракт загрузок раздел 11; условия приёмки period-replace AC-1, AC-5). Значения — выдуманные TEST.
 */
class RptPeriodReplaceEndToEndTest extends EmbeddedPostgresTest {

    private static final int DIVISOR = 1000;
    private static final LocalDate YEAR_FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate JUNE_TO = LocalDate.of(2026, 6, 30);
    private static final LocalDate JULY_TO = LocalDate.of(2026, 7, 31);
    private static final LocalDate JAN_TO = LocalDate.of(2026, 1, 31);

    /** Файл за январь–июнь: 6 строк, сумма 2100. */
    private static final List<SourceRow> JUNE = List.of(
            new SourceRow("15.01.2026", 100, 1, "TEST-1", "TEST g1"),
            new SourceRow("20.02.2026", 200, 1, "TEST-1", "TEST g2"),
            new SourceRow("10.03.2026", 300, 1, "TEST-2", "TEST g1"),
            new SourceRow("05.04.2026", 400, 1, "TEST-2", "TEST g2"),
            new SourceRow("12.05.2026", 500, 1, "TEST-1", "TEST g1"),
            new SourceRow("30.06.2026", 600, 1, "TEST-2", "TEST g2"));

    /** Файл за январь–июль: те же 6 строк и 2 строки июля, 8 строк, сумма 3600. */
    private static final List<SourceRow> JULY = withJuly();

    @Autowired
    private RptViewService service;
    @Autowired
    private RptDefinitionService definitions;
    @Autowired
    private UplSourceService sources;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplPackageRepository repo;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplApplyService applies;
    @Autowired
    private MfFileService files;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    @Qualifier(FndPref.DWH)
    private JdbcClient dwhJdbc;
    @Autowired
    private TransactionTemplate tx;

    private RptTestData data;
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
        data = new RptTestData(sources, packages, parseJob, applies, files, userId);
        sourceId = data.publishedSource();
        refId = data.publishedRef();
        data.applyRef(refId, List.of(
                new RefRow("TEST-1", "TEST Alpha"),
                new RefRow("TEST-2", "TEST beta"),
                new RefRow("TEST-1", "TEST Alpha повтор")), YEAR_FROM, JAN_TO);
    }

    @Test
    @DisplayName("AC-1: файл за январь–июнь, затем за январь–июль — отчёт считает каждую строку один раз")
    void laterOverlappingFileReplacesEarlier() {
        PackageRow a = data.applySource(sourceId, JUNE, YEAR_FROM, JUNE_TO);
        long id = twoLevels();

        ReportView first = service.view(id, null);
        assertThat(first.grand().count()).isEqualTo(6);
        assertThat(new BigDecimal(first.grand().total())).isEqualByComparingTo(scaled(2100));

        PackageRow b = data.applySource(sourceId, JULY, YEAR_FROM, JULY_TO);
        ReportView second = service.view(id, null);
        assertThat(second.grand().count()).isEqualTo(8);
        assertThat(new BigDecimal(second.grand().total())).isEqualByComparingTo(scaled(3600));
        assertThat(new BigDecimal(second.grand().cells().getFirst())).isEqualByComparingTo(scaled(100));
        assertThat(new BigDecimal(second.grand().cells().get(6))).isEqualByComparingTo(scaled(700 + 800));

        assertThat(repo.appliedPackages(sourceId)).singleElement()
                .satisfies(applied -> assertThat(applied.loadId()).isEqualTo(b.loadId()));
        assertThat(dwhJdbc.sql("select count(*) from raw.rows where load_id = :loadId")
                .param("loadId", a.loadId()).query(Long.class).single()).isEqualTo(6L);
        assertThat(packages.get(a.publicId().toString()).replacedBy().id()).isEqualTo(b.publicId());
    }

    @Test
    @DisplayName("AC-5: «Применить» сначала у позднего файла, потом у раннего — считается поздний")
    void uploadOrderDecidesNotApplyOrder() {
        PackageRow a = data.verifiedSource(sourceId, JUNE, YEAR_FROM, JUNE_TO);
        PackageRow b = data.verifiedSource(sourceId, JULY, YEAR_FROM, JULY_TO);
        assertThat(a.status()).isEqualTo(UplPackageModel.VERIFIED);
        assertThat(b.status()).isEqualTo(UplPackageModel.VERIFIED);

        PackageRow appliedB = applies.apply(b.publicId().toString(), userId);
        PackageRow appliedA = applies.apply(a.publicId().toString(), userId);
        assertThat(appliedB.status()).isEqualTo(UplPackageModel.APPLIED);
        assertThat(appliedA.status()).isEqualTo(UplPackageModel.APPLIED);

        ReportView view = service.view(twoLevels(), null);
        assertThat(view.grand().count()).isEqualTo(8);
        assertThat(new BigDecimal(view.grand().total())).isEqualByComparingTo(scaled(3600));

        assertThat(repo.appliedPackages(sourceId)).singleElement()
                .satisfies(applied -> assertThat(applied.loadId()).isEqualTo(appliedB.loadId()));
        assertThat(packages.get(a.publicId().toString()).replacedBy().id()).isEqualTo(b.publicId());
    }

    // ---------- помощники ----------

    private static List<SourceRow> withJuly() {
        List<SourceRow> rows = new ArrayList<>(JUNE);
        rows.add(new SourceRow("10.07.2026", 700, 1, "TEST-1", "TEST g1"));
        rows.add(new SourceRow("25.07.2026", 800, 1, "TEST-2", "TEST g2"));
        return List.copyOf(rows);
    }

    private static BigDecimal scaled(long amount) {
        return BigDecimal.valueOf(amount).divide(BigDecimal.valueOf(DIVISOR));
    }

    /** Отчёт: уровень 1 — название справочника, уровень 2 — группа источника, мера — сумма, делитель 1000. */
    private long twoLevels() {
        RefPart ref = new RefPart(refId, 1, List.of(new KeyPair(RptTestData.CODE, RptTestData.REF_CODE)));
        return definitions.create(input("TEST two levels", sourceId, ref,
                new LevelPart(RptModel.ORIGIN_REF, RptTestData.REF_NAME),
                new LevelPart(RptModel.ORIGIN_SOURCE, RptTestData.GROUP),
                new Measure(RptModel.MEASURE_TOTAL, RptTestData.AMOUNT), DIVISOR), userId).id();
    }

    private static DefinitionInput input(String name, long source, RefPart ref, LevelPart level1, LevelPart level2,
                                         Measure measure, int divisor) {
        return new DefinitionInput(name, source, 1, RptTestData.DATE, measure, divisor, 2, ref, level1, level2, null);
    }
}
