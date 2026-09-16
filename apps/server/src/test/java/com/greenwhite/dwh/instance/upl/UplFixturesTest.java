package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Format;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatColumn;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatSheet;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Unit;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/** Анкеты клиентов из фикстур заводятся через сервис без правки кода (И3 шаг 3.7). */
class UplFixturesTest extends EmbeddedPostgresTest {

    private static final String SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final int SUFFIX_LENGTH = 6;
    private static final int FIRST_VERSION = 1;

    @Autowired
    private UplSourceService service;
    @Autowired
    private FndUnitService units;
    @Autowired
    private FndActors actors;
    @Autowired
    private JdbcClient jdbc;

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("Анкеты фикстуры публикуются через сервис и читаются без потерь")
    void formatsAreConfiguredWithoutCode(DepartmentFixture dept) {
        assertThat(dept.formats()).isNotEmpty();
        long userId = jdbc.sql("select id from md_users where login = 'system'").query(Long.class).single();
        registerUnits(dept);
        for (Format f : dept.formats()) {
            long id = service.createSource(sourceData(f), userId).source().id();
            service.createDraft(id, null, userId);
            int lock = service.getVersion(id, FIRST_VERSION).lockVersion();
            service.replaceDraft(id, FIRST_VERSION, lock, draftData(f), userId);
            service.publish(id, FIRST_VERSION, f.validFrom(), userId);
            assertThat(service.versionAt(id, f.validFrom()).version()).isEqualTo(FIRST_VERSION);
            assertStored(f, service.getVersion(id, FIRST_VERSION));
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture#departments")
    @DisplayName("Коды анкет и имена колонок фикстуры не встречаются в src/main")
    void mainCodeHasNoFixtureNames(DepartmentFixture dept) {
        List<String> names = new ArrayList<>();
        for (Format f : dept.formats()) {
            names.add(f.code());
            f.sheets().forEach(s -> s.columns().forEach(c -> names.add(c.name())));
        }
        List<String> offenders = mainFiles().stream()
                .filter(path -> hasLiteral(read(path), names))
                .map(Path::toString)
                .toList();
        assertThat(offenders).as("src/main содержит имена фикстуры как литералы").isEmpty();
    }

    private static boolean hasLiteral(String text, List<String> names) {
        return names.stream().anyMatch(name ->
                text.contains("\"" + name + "\"") || text.contains("'" + name + "'"));
    }

    private void registerUnits(DepartmentFixture dept) {
        dept.units().stream().filter(u -> u.code().equals(u.base())).forEach(this::ensureUnit);
        dept.units().stream().filter(u -> !u.code().equals(u.base())).forEach(this::ensureUnit);
    }

    private void ensureUnit(Unit u) {
        if (units.findUnit(u.code()).isEmpty()) {
            units.registerUnit(u.code(), Map.of("uz", u.nameUz()), u.base(), actors.system());
        }
    }

    private static void assertStored(Format f, FormatVersion stored) {
        assertThat(stored.status()).isEqualTo("published");
        assertThat(stored.sheets()).hasSameSizeAs(f.sheets());
        for (int i = 0; i < f.sheets().size(); i++) {
            FormatSheet expected = f.sheets().get(i);
            Sheet actual = stored.sheets().get(i);
            assertThat(actual.sheetName()).isEqualTo(expected.sheetName());
            assertThat(actual.headerRow()).isEqualTo(expected.headerRow());
            assertThat(actual.totalRowMarker()).isEqualTo(expected.totalRowMarker());
            assertThat(actual.columns()).hasSameSizeAs(expected.columns());
            for (int j = 0; j < expected.columns().size(); j++) {
                assertColumn(expected.columns().get(j), actual.columns().get(j));
            }
        }
    }

    private static void assertColumn(FormatColumn expected, Column actual) {
        assertThat(actual.nameInFile()).isEqualTo(expected.name());
        assertThat(actual.targetField()).isEqualTo(expected.field());
        assertThat(actual.dataType().db()).isEqualTo(expected.type());
        assertThat(actual.required()).isEqualTo(expected.required());
        assertThat(actual.sourceUnit()).isEqualTo(expected.sourceUnit());
        assertThat(actual.baseUnit()).isEqualTo(expected.baseUnit());
        assertThat(actual.keyMask()).isEqualTo(expected.keyMask());
        assertThat(actual.keyPadLength()).isEqualTo(expected.keyPadLength());
        assertThat(actual.keyPadMax()).isEqualTo(expected.keyPadMax());
        assertThat(actual.refBookCode()).isEqualTo(expected.refBook());
        assertThat(actual.filePosition()).isEqualTo(expected.filePosition());
    }

    private static SourceData sourceData(Format f) {
        return new SourceData(f.code() + "-" + randomSuffix(), f.name(), f.ownerOrg(), null,
                Periodicity.fromDb(f.periodicity()), f.slaDays(), null, null);
    }

    private static DraftData draftData(Format f) {
        List<Sheet> sheets = f.sheets().stream()
                .map(s -> new Sheet(null, 0, s.sheetName(), s.headerRow(), s.totalRowMarker(),
                        s.columns().stream().map(UplFixturesTest::column).toList()))
                .toList();
        return new DraftData(FileKind.fromDb(f.fileKind()), f.encoding(), f.delimiter(),
                MatchBy.fromDb(f.matchColumnsBy()), sheets);
    }

    private static Column column(FormatColumn c) {
        return new Column(null, 0, c.filePosition(), c.name(), c.field(), DataType.fromDb(c.type()), c.required(),
                c.sourceUnit(), c.baseUnit(), c.keyMask(), c.keyPadLength(), c.keyPadMax(), c.refBook());
    }

    private static String randomSuffix() {
        StringBuilder suffix = new StringBuilder(SUFFIX_LENGTH);
        for (int i = 0; i < SUFFIX_LENGTH; i++) {
            suffix.append(SUFFIX_ALPHABET.charAt(ThreadLocalRandom.current().nextInt(SUFFIX_ALPHABET.length())));
        }
        return suffix.toString();
    }

    private static List<Path> mainFiles() {
        try (Stream<Path> paths = Files.walk(Path.of("src/main"))) {
            return paths.filter(Files::isRegularFile)
                    .filter(UplFixturesTest::isCodeOrMigration)
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException("Не обойти src/main", e);
        }
    }

    private static boolean isCodeOrMigration(Path path) {
        String fileName = path.getFileName().toString();
        return fileName.endsWith(".java") || fileName.endsWith(".sql");
    }

    private static String read(Path path) {
        try {
            return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Не прочитан " + path, e);
        }
    }
}
