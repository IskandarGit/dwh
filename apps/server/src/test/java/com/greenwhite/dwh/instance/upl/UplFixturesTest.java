package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Format;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatColumn;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatSheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
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
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/** Анкеты клиентов из фикстур заводятся через сервис без правки кода (И3 шаг 3.7). */
class UplFixturesTest extends EmbeddedPostgresTest {

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
        UplFixtureSources.registerUnits(units, actors, dept);
        for (Format f : dept.formats()) {
            long id = service.createSource(UplFixtureSources.sourceData(f), userId).source().id();
            service.createDraft(id, null, userId);
            int lock = service.getVersion(id, UplFixtureSources.FIRST_VERSION).lockVersion();
            service.replaceDraft(id, UplFixtureSources.FIRST_VERSION, lock, UplFixtureSources.draftData(f), userId);
            service.publish(id, UplFixtureSources.FIRST_VERSION, f.validFrom(), userId);
            assertThat(service.versionAt(id, f.validFrom()).version()).isEqualTo(UplFixtureSources.FIRST_VERSION);
            assertStored(f, service.getVersion(id, UplFixtureSources.FIRST_VERSION));
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
