package com.greenwhite.dwh.instance.fnd;

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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * AC-24 и AC-40: в ядре нет ни имён единиц покупателя, ни множителей «в коде», ни имён самих покупателей.
 * Проверяются наши пакеты {@code ..instance.{fnd,upl,ref,reg,vit}} и наши миграции ({@code V1xx}, {@code db/dwh});
 * код каркаса (upstream) не проверяется. Список терминов — тест-ресурс {@code forbidden-terms.txt},
 * в {@code src/main} его нет. Фикстуры конфигураций А/Б (AC-41) — тоже только тест-ресурсы.
 */
class FndCorePurityTest {

    private static final Path INSTANCE = Path.of("src/main/java/com/greenwhite/dwh/instance");
    private static final List<String> OUR_MODULES = List.of("fnd", "upl", "ref", "reg", "vit", "ovw", "rpt");
    private static final Path OLTP_MIGRATIONS = Path.of("src/main/resources/db/migration");
    private static final Path DWH_MIGRATIONS = Path.of("src/main/resources/db/dwh");
    private static final Path TERMS = Path.of("src/test/resources/forbidden-terms.txt");
    private static final Path ALLOWED_NUMBERS = Path.of("src/test/resources/allowed-numbers.txt");
    /** Дробь или число от 4 цифр как отдельный токен: 127.0.0.1, V100, id_2026 не считаются. */
    private static final Pattern NUMBER = Pattern.compile("(?<![\\p{L}\\p{N}_.])(\\d+\\.\\d+|\\d{4,})(?![\\p{L}\\p{N}_.])");
    private static final Pattern LINE_COMMENT = Pattern.compile("//.*$|--.*$");

    @Test
    @DisplayName("AC-24/AC-40: ядро и наши миграции не упоминают единиц, множителей и имён покупателей")
    void coreMentionsNoBuyer() throws IOException {
        List<String> terms = terms();
        assertThat(terms).as("список терминов пуст — проверка была бы бессмысленной").hasSizeGreaterThan(20);
        assertThat(terms).as("имена покупателей в списке").contains("фармкомитет", "sqb", "узпромстройматериалы");

        List<Path> files = coreFiles();
        assertThat(files).as("исходники ядра не найдены — проверьте рабочий каталог теста").isNotEmpty();
        assertThat(scan(files, terms)).isEmpty();
    }

    @Test
    @DisplayName("AC-40: список терминов и фикстуры конфигураций лежат только в тест-ресурсах")
    void termsAndFixturesStayOutOfMain() throws IOException {
        try (Stream<Path> tree = Files.walk(Path.of("src/main"))) {
            List<String> leaked = tree.filter(Files::isRegularFile)
                    .map(path -> path.getFileName().toString())
                    .filter(name -> name.equals("forbidden-terms.txt") || name.matches("dept-[ab]\\.ya?ml"))
                    .toList();
            assertThat(leaked).isEmpty();
        }
        assertThat(Files.exists(Path.of("src/test/resources/fixtures/dept-a.yaml"))).isTrue();
        assertThat(Files.exists(Path.of("src/test/resources/fixtures/dept-b.yaml"))).isTrue();
    }

    @Test
    @DisplayName("AC-40: фикстура-нарушитель — красный с перечнем файл:строка, кириллица и латиница без учёта регистра")
    void violatorIsReportedWithFileAndLine(@TempDir Path root) throws IOException {
        Path violator = root.resolve("UplService.java");
        Files.writeString(violator, "class UplService {\n"
                + "  // Заказчик: ФармКомитет\n"
                + "  String bank = \"SQB\";\n"
                + "  long checksum = 1; // не единица: слово с префиксом\n"
                + "  BigDecimal total = sum(values); // SQL-агрегат, не единица\n"
                + "}\n", StandardCharsets.UTF_8);

        List<String> hits = scan(List.of(violator), terms());

        assertThat(hits).hasSize(2)
                .anySatisfy(hit -> assertThat(hit).startsWith(violator + ":2").contains("фармкомитет"))
                .anySatisfy(hit -> assertThat(hit).startsWith(violator + ":3").contains("sqb"));
    }

    @Test
    @DisplayName("AC-24/M-9: в ядре и наших миграциях нет числовых констант пересчёта вне allowed-numbers.txt")
    void coreHasNoUnlistedNumbers() throws IOException {
        Set<String> allowed = allowedNumbers();
        for (String entry : allowed) {
            String path = entry.substring(0, entry.lastIndexOf(':'));
            assertThat(Files.exists(Path.of(path))).as("устаревшая запись allowlist: %s", entry).isTrue();
        }
        assertThat(scanNumbers(coreFiles(), allowed)).isEmpty();
    }

    @Test
    @DisplayName("AC-24/M-9: нарушитель — красный с файл:строка и числом; комментарии, версии и IP не считаются")
    void numberViolatorIsReported(@TempDir Path root) throws IOException {
        Path violator = root.resolve("UplUnits.java");
        Files.writeString(violator, "class UplUnits {\n"
                + "  long grams = kg * 1000; // 2026 — в комментарии не считается\n"
                + "  double toTonnes = 0.001;\n"
                + "  String ip = \"127.0.0.1\"; String v = \"V100\"; int id_2026 = 1;\n"
                + "}\n", StandardCharsets.UTF_8);
        String key = violator.toString().replace('\\', '/');

        assertThat(scanNumbers(List.of(violator), Set.of())).hasSize(2)
                .anySatisfy(hit -> assertThat(hit).startsWith(key + ":2").endsWith("1000"))
                .anySatisfy(hit -> assertThat(hit).startsWith(key + ":3").endsWith("0.001"));
        assertThat(scanNumbers(List.of(violator), Set.of(key + ":1000"))).hasSize(1);
    }

    // ---------- механика ----------

    static List<String> scan(List<Path> files, List<String> terms) throws IOException {
        List<String> hits = new ArrayList<>();
        for (Path file : files) {
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
        return hits;
    }

    /** AC-24/M-9: числовые токены вне allowlist; ключ — {@code путь:число}, путь с прямыми слэшами от apps/server. */
    static List<String> scanNumbers(List<Path> files, Set<String> allowed) throws IOException {
        List<String> hits = new ArrayList<>();
        for (Path file : files) {
            String key = file.toString().replace('\\', '/');
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            for (int number = 1; number <= lines.size(); number++) {
                String line = lines.get(number - 1).trim();
                if (line.startsWith("*") || line.startsWith("/*")) {
                    continue; // javadoc и блочные комментарии
                }
                Matcher matcher = NUMBER.matcher(LINE_COMMENT.matcher(line).replaceAll(""));
                while (matcher.find()) {
                    if (!allowed.contains(key + ":" + matcher.group(1))) {
                        hits.add(key + ":" + number + " — " + matcher.group(1));
                    }
                }
            }
        }
        return hits;
    }

    /** Строки {@code путь:число # причина}; пустые и {@code #} пропускаются. */
    private static Set<String> allowedNumbers() throws IOException {
        try (Stream<String> lines = Files.lines(ALLOWED_NUMBERS, StandardCharsets.UTF_8)) {
            return lines.map(line -> line.contains("#") ? line.substring(0, line.indexOf('#')) : line)
                    .map(String::trim).filter(line -> !line.isEmpty())
                    .collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new));
        }
    }

    /** Термин как отдельное слово, без учёта регистра; {@code sum(} — SQL-агрегат, а не единица. */
    private static boolean mentions(String line, String term) {
        Matcher matcher = Pattern.compile("(?<![\\p{L}\\p{N}_])" + Pattern.quote(term) + "(?![\\p{L}\\p{N}_])",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(line);
        while (matcher.find()) {
            int after = matcher.end();
            if (after >= line.length() || line.charAt(after) != '(') {
                return true;
            }
        }
        return false;
    }

    private static List<String> terms() throws IOException {
        try (Stream<String> lines = Files.lines(TERMS, StandardCharsets.UTF_8)) {
            return lines.map(String::trim)
                    .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                    .toList();
        }
    }

    private static List<Path> coreFiles() throws IOException {
        List<Path> roots = new ArrayList<>();
        OUR_MODULES.forEach(module -> roots.add(INSTANCE.resolve(module)));
        roots.add(OLTP_MIGRATIONS);
        roots.add(DWH_MIGRATIONS);
        List<Path> files = new ArrayList<>();
        for (Path root : roots) {
            if (!Files.exists(root)) {
                continue; // модули upl/ref/reg/vit появятся в A3–A7
            }
            try (Stream<Path> tree = Files.walk(root)) {
                tree.filter(Files::isRegularFile)
                        // В общем каталоге миграций лежат и файлы каркаса: наши — от V100
                        .filter(path -> !root.equals(OLTP_MIGRATIONS)
                                || path.getFileName().toString().matches("^V[1-9]\\d{2,}__.+\\.sql$"))
                        .forEach(files::add);
            }
        }
        return files;
    }
}
