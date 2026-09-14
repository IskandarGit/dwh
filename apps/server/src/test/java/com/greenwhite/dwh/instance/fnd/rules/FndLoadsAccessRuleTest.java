package com.greenwhite.dwh.instance.fnd.rules;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-39 (18 п.14): запись в {@code fnd_loads}/{@code fnd_load_log} — только через фасад {@code FndLoadService}.
 * Grep-тест по {@code src/main}: имена таблиц в SQL-литералах, YAML и прочих исходниках вне пакета
 * {@code ..instance.fnd..} и наших миграций — красный с перечнем файл:строка.
 * [допущение] JPA в каркасе нет (JdbcClient), поэтому проверка сущностей сводится к тому же grep.
 */
class FndLoadsAccessRuleTest {

    private static final Path MAIN = Path.of("src/main");
    private static final Pattern TABLE = Pattern.compile("(?i)(?<![\\p{L}\\p{N}_])fnd_load(s|_log)(?![\\p{L}\\p{N}_])");
    private static final Set<String> SOURCE_EXTENSIONS = Set.of("java", "kt", "sql", "xml", "yml", "yaml", "properties");
    /** AC-30/M-10: load_id — единый номер fnd_loads.id; своих sequence/uuid у него нет. */
    private static final Pattern LOAD_SEQUENCE = Pattern.compile("(?i)create\\s+sequence\\s+\\S*load");
    private static final Pattern LOAD_ID_TYPE = Pattern.compile("(?i)\\bload_(id|version)\\s+(uuid|bigserial|serial|smallserial)\\b");
    private static final Pattern LOAD_ID_GENERATOR = Pattern.compile(
            "(?i)\\b(load_?id|load_version)\\b[^;,]*\\b(gen_random_uuid|randomUUID|nextval|uuid_generate_v\\d|generated\\s+(always|by\\s+default)\\s+as\\s+identity)\\b");

    @Test
    @DisplayName("AC-39: вне пакета fnd и наших миграций таблицы fnd_loads/fnd_load_log не упоминаются")
    void loadsTablesOnlyInsideFnd() throws IOException {
        assertThat(Files.isDirectory(MAIN)).as("рабочий каталог теста — apps/server").isTrue();
        assertThat(violations(MAIN)).isEmpty();
    }

    @Test
    @DisplayName("AC-39: фикстура-нарушитель вне fnd — красный с файлом и строкой")
    void violatorOutsideFndIsRed(@TempDir Path root) throws IOException {
        Path upl = root.resolve("java/com/greenwhite/dwh/instance/upl/UplLoader.java");
        Path fnd = root.resolve("java/com/greenwhite/dwh/instance/fnd/load/FndLoadService.java");
        Path migration = root.resolve("resources/db/migration/V104__fnd_loads.sql");
        Files.createDirectories(upl.getParent());
        Files.createDirectories(fnd.getParent());
        Files.createDirectories(migration.getParent());
        Files.writeString(upl, "class UplLoader {\n  String sql = \"insert into fnd_loads (id) values (1)\";\n"
                + "  String log = \"select * from fnd_load_log\";\n}\n", StandardCharsets.UTF_8);
        Files.writeString(fnd, "class FndLoadService { String sql = \"insert into fnd_loads\"; }\n", StandardCharsets.UTF_8);
        Files.writeString(migration, "create table fnd_loads (id bigserial primary key);\n", StandardCharsets.UTF_8);

        List<String> violations = violations(root);

        assertThat(violations).hasSize(2)
                .allSatisfy(v -> assertThat(v).contains("UplLoader.java"))
                .anySatisfy(v -> assertThat(v).endsWith(":2"))
                .anySatisfy(v -> assertThat(v).endsWith(":3"));
    }

    @Test
    @DisplayName("AC-30: load_id/load_version — только ссылка на fnd_loads.id, своих sequence и uuid нет")
    void loadIdHasNoOwnGenerator() throws IOException {
        assertThat(loadIdViolations(MAIN)).isEmpty();
    }

    @Test
    @DisplayName("AC-30: нарушитель — sequence, uuid и генератор у load_id — красный с файлом и строкой")
    void loadIdGeneratorViolatorIsRed(@TempDir Path root) throws IOException {
        Path migration = root.resolve("resources/db/migration/V150__bad_loads.sql");
        Path java = root.resolve("java/com/greenwhite/dwh/instance/upl/UplLoads.java");
        Files.createDirectories(migration.getParent());
        Files.createDirectories(java.getParent());
        Files.writeString(migration, "create sequence load_version_seq;\n"
                + "create table upl_x (\n    load_id uuid default gen_random_uuid(),\n    row_no int\n);\n"
                + "create table upl_y (load_id bigint references fnd_loads (id));\n", StandardCharsets.UTF_8);
        Files.writeString(java, "class UplLoads { String loadId = UUID.randomUUID().toString(); long ok = loadId(); }\n",
                StandardCharsets.UTF_8);

        assertThat(loadIdViolations(root)).hasSize(3)
                .anySatisfy(v -> assertThat(v).endsWith("V150__bad_loads.sql:1"))
                .anySatisfy(v -> assertThat(v).endsWith("V150__bad_loads.sql:3"))
                .anySatisfy(v -> assertThat(v).endsWith("UplLoads.java:1"));
    }

    /** Файлы {@code src/main} вне {@code instance/fnd/} и вне наших миграций ({@code V1xx__fnd_*}, {@code db/dwh}). */
    static List<String> violations(Path root) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> tree = Files.walk(root)) {
            for (Path file : tree.filter(Files::isRegularFile).filter(FndLoadsAccessRuleTest::isSource).toList()) {
                String unix = root.relativize(file).toString().replace('\\', '/');
                if (unix.contains("/instance/fnd/") || unix.matches(".*/db/migration/V[1-9]\\d{2,}__fnd_.*\\.sql")
                        || unix.contains("/db/dwh/")) {
                    continue;
                }
                List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
                for (int number = 1; number <= lines.size(); number++) {
                    if (TABLE.matcher(lines.get(number - 1)).find()) {
                        found.add(unix + ":" + number);
                    }
                }
            }
        }
        return found;
    }

    /** AC-30: все исходники {@code src/main}, включая fnd и миграции — строки, где load_id получает свой генератор или тип не bigint. */
    static List<String> loadIdViolations(Path root) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> tree = Files.walk(root)) {
            for (Path file : tree.filter(Files::isRegularFile).filter(FndLoadsAccessRuleTest::isSource).toList()) {
                String unix = root.relativize(file).toString().replace('\\', '/');
                List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
                for (int number = 1; number <= lines.size(); number++) {
                    String line = lines.get(number - 1);
                    if (LOAD_SEQUENCE.matcher(line).find() || LOAD_ID_TYPE.matcher(line).find()
                            || LOAD_ID_GENERATOR.matcher(line).find()) {
                        found.add(unix + ":" + number);
                    }
                }
            }
        }
        return found;
    }

    private static boolean isSource(Path file) {
        String name = file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot > 0 && SOURCE_EXTENSIONS.contains(name.substring(dot + 1));
    }
}
