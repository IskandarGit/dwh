package com.greenwhite.dwh.instance.fnd;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-24 (и заготовка AC-40): в ядре нет ни имён единиц покупателя, ни множителей пересчёта «в коде».
 * Проверяются наши исходники {@code ..instance.fnd..} и наши миграции ({@code V1xx}, {@code db/dwh});
 * код каркаса (upstream) не проверяется. Список терминов — тест-ресурс {@code forbidden-terms.txt},
 * в {@code src/main} его нет.
 */
class FndCorePurityTest {

    private static final Path SOURCES = Path.of("src/main/java/com/greenwhite/dwh/instance/fnd");
    private static final Path OLTP_MIGRATIONS = Path.of("src/main/resources/db/migration");
    private static final Path DWH_MIGRATIONS = Path.of("src/main/resources/db/dwh");

    @Test
    @DisplayName("AC-24: единицы и коэффициенты берутся только из базы экземпляра — в ядре их имён нет")
    void coreMentionsNoUnitOfAnyBuyer() throws IOException {
        List<String> terms = terms();
        assertThat(terms).as("список терминов пуст — проверка была бы бессмысленной").isNotEmpty();

        List<String> hits = new ArrayList<>();
        for (Path file : coreFiles()) {
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            for (int number = 1; number <= lines.size(); number++) {
                String line = lines.get(number - 1);
                for (String term : terms) {
                    if (mentions(line, term)) {
                        hits.add(file + ":" + number + " — " + term);
                    }
                }
            }
        }
        assertThat(hits).isEmpty();
    }

    /** Термин как отдельное слово, без учёта регистра; {@code sum(} — SQL-агрегат, а не единица. */
    private static boolean mentions(String line, String term) {
        Matcher matcher = Pattern.compile("(?<![\\p{L}\\p{N}_])" + Pattern.quote(term) + "(?![\\p{L}\\p{N}_])",
                Pattern.CASE_INSENSITIVE).matcher(line);
        while (matcher.find()) {
            int after = matcher.end();
            if (after >= line.length() || line.charAt(after) != '(') {
                return true;
            }
        }
        return false;
    }

    private static List<String> terms() throws IOException {
        try (Stream<String> lines = Files.lines(Path.of("src/test/resources/forbidden-terms.txt"),
                StandardCharsets.UTF_8)) {
            return lines.map(String::trim)
                    .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                    .toList();
        }
    }

    private static List<Path> coreFiles() throws IOException {
        List<Path> files = new ArrayList<>();
        for (Path root : List.of(SOURCES, OLTP_MIGRATIONS, DWH_MIGRATIONS)) {
            if (!Files.exists(root)) {
                continue;
            }
            try (Stream<Path> tree = Files.walk(root)) {
                tree.filter(Files::isRegularFile)
                        // В общем каталоге миграций лежат и файлы каркаса: наши — от V100
                        .filter(path -> !root.equals(OLTP_MIGRATIONS)
                                || path.getFileName().toString().matches("^V[1-9]\\d{2,}__.+\\.sql$"))
                        .forEach(files::add);
            }
        }
        assertThat(files).as("исходники ядра не найдены — проверьте рабочий каталог теста").isNotEmpty();
        return files;
    }
}
