package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.FndPref;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseJob;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ReplacedBy;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository;
import com.greenwhite.dwh.instance.upl.upload.UplPackageRepository.AppliedPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Какие применённые загрузки видны и кем скрыта каждая (контракт И5, раздел 11; условия приёмки period-replace). */
class UplPackageRepositoryTest extends EmbeddedPostgresTest {

    @Autowired
    private UplApplyService applies;
    @Autowired
    private UplPackageService packages;
    @Autowired
    private UplPackageRepository repo;
    @Autowired
    private UplParseJob parseJob;
    @Autowired
    private UplSourceService sources;
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

    private long userId;
    private long sourceId;

    @BeforeEach
    void setUp() {
        userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        tx.executeWithoutResult(status -> {
            actors.apply(actors.system());
            jdbc.sql("delete from upl_package_errors").update();
            jdbc.sql("delete from upl_packages").update();
        });
        dwhJdbc.sql("delete from raw.rows").update();
        sourceId = UplPackageTestData.publishedSource(sources, userId, LocalDate.of(2026, 1, 1));
    }

    @Test
    @DisplayName("AC-1: загрузка за январь–июль скрывает загрузку за январь–июнь, строки и статус скрытой не тронуты")
    void laterOverlappingPackageHidesEarlierOne() {
        PackageRow a = applied(date(1, 1), date(6, 30));
        PackageRow b = applied(date(1, 1), date(7, 31));

        assertThat(visibleLoadIds()).containsExactly(b.loadId());
        PackageRow reloadedA = reload(a);
        assertThat(reloadedA.replacedBy()).isNotNull();
        assertThat(reloadedA.replacedBy().id()).isEqualTo(b.publicId());
        assertThat(reloadedA.status()).isEqualTo(UplPackageModel.APPLIED);
        assertThat(reload(b).replacedBy()).isNull();
        assertThat(rawCount(a.loadId())).isEqualTo(3);
    }

    @Test
    @DisplayName("AC-2: помесячные загрузки без пересечения видны все; пересечение одним днём скрывает март целиком")
    void monthlyPackagesStayVisibleUntilOverlapByOneDay() {
        PackageRow jan = applied(date(1, 1), date(1, 31));
        PackageRow feb = applied(date(2, 1), date(2, 28));
        PackageRow mar = applied(date(3, 1), date(3, 31));

        assertThat(visibleLoadIds()).containsExactly(jan.loadId(), feb.loadId(), mar.loadId());
        assertThat(List.of(reload(jan), reload(feb), reload(mar)))
                .allSatisfy(row -> assertThat(row.replacedBy()).isNull());

        PackageRow late = applied(date(3, 15), date(4, 15));

        assertThat(visibleLoadIds()).containsExactly(jan.loadId(), feb.loadId(), late.loadId());
        assertThat(reload(mar).replacedBy().id()).isEqualTo(late.publicId());
        assertThat(reload(jan).replacedBy()).isNull();
        assertThat(reload(feb).replacedBy()).isNull();
    }

    @Test
    @DisplayName("AC-3: из двух загрузок одного периода видна только более поздняя")
    void samePeriodKeepsLaterPackage() {
        PackageRow first = applied(date(5, 1), date(5, 31));
        PackageRow second = applied(date(5, 1), date(5, 31));

        assertThat(second.loadId()).isGreaterThan(first.loadId());
        assertThat(visibleLoadIds()).containsExactly(second.loadId());
        assertThat(reload(first).replacedBy().id()).isEqualTo(second.publicId());
        assertThat(reload(second).replacedBy()).isNull();
    }

    @Test
    @DisplayName("AC-4: неприменённая загрузка с пересекающимся периодом ничего не скрывает и не помечается")
    void notAppliedPackageNeitherHidesNorIsMarked() {
        PackageRow a = applied(date(1, 1), date(6, 30));
        PackageRow c = verifiedPackage(date(1, 1), date(8, 31));

        assertThat(visibleLoadIds()).containsExactly(a.loadId());
        assertThat(reload(a).replacedBy()).isNull();
        assertThat(reload(c).replacedBy()).isNull();
    }

    @Test
    @DisplayName("AC-5: решает порядок приёма файлов, а не порядок «Применить»")
    void fileOrderDecidesNotApplyOrder() {
        PackageRow a = verifiedPackage(date(1, 1), date(6, 30));
        PackageRow b = verifiedPackage(date(1, 1), date(7, 31));

        PackageRow appliedB = applies.apply(b.publicId().toString(), userId);
        PackageRow appliedA = applies.apply(a.publicId().toString(), userId);

        assertThat(visibleLoadIds()).containsExactly(appliedB.loadId());
        ReplacedBy replacedBy = reload(appliedA).replacedBy();
        assertThat(replacedBy).isNotNull();
        assertThat(replacedBy.id()).isEqualTo(b.publicId());
        assertThat(reload(appliedB).replacedBy()).isNull();
    }

    @Test
    @DisplayName("AC-6: повторная загрузка файла за январь–июнь возвращает его и скрывает обе прежние, ничего не удалено")
    void reloadingEarlierFileHidesBothPrevious() {
        PackageRow a = applied(date(1, 1), date(6, 30));
        PackageRow b = applied(date(1, 1), date(7, 31));
        PackageRow a2 = applied(date(1, 1), date(6, 30));

        assertThat(visibleLoadIds()).containsExactly(a2.loadId());
        assertThat(reload(a).replacedBy().id()).isEqualTo(a2.publicId());
        assertThat(reload(b).replacedBy().id()).isEqualTo(a2.publicId());
        assertThat(reload(a2).replacedBy()).isNull();
        assertThat(jdbc.sql("select count(*) from upl_packages").query(Long.class).single()).isEqualTo(3L);
    }

    private static LocalDate date(int month, int day) {
        return LocalDate.of(2026, month, day);
    }

    private List<Long> visibleLoadIds() {
        return repo.appliedPackages(sourceId).stream().map(AppliedPackage::loadId).toList();
    }

    private PackageRow reload(PackageRow row) {
        return repo.findByPublicId(row.publicId()).orElseThrow();
    }

    private long rawCount(long loadId) {
        return dwhJdbc.sql("select count(*) from raw.rows where load_id = :id")
                .param("id", loadId).query(Long.class).single();
    }

    private PackageRow applied(LocalDate from, LocalDate to) {
        PackageRow row = verifiedPackage(from, to);
        PackageRow applied = applies.apply(row.publicId().toString(), userId);
        assertThat(applied.status()).isEqualTo(UplPackageModel.APPLIED);
        return applied;
    }

    private PackageRow verifiedPackage(LocalDate from, LocalDate to) {
        PackageRow row = parsedPackage(UplPackageTestData.workbook(3, 0), from, to);
        assertThat(row.status()).isEqualTo(UplPackageModel.VERIFIED);
        return row;
    }

    private PackageRow parsedPackage(byte[] content, LocalDate from, LocalDate to) {
        FileRecord file = files.uploadFile("TEST.xlsx", UplPackageTestData.XLSX_MIME,
                new ByteArrayInputStream(content), content.length, userId);
        PackageRow row = packages.register(new NewPackage(sourceId, 1, from, to, file.id(),
                file.originalName(), file.sha256(), file.sizeBytes(), userId));
        parseJob.run(Map.of("packageId", row.publicId().toString()));
        return packages.get(row.publicId().toString());
    }
}
