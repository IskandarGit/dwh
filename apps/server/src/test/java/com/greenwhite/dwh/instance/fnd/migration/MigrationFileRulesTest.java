package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** AC-2: регламент файлов миграций (промпт 02 п.1–2, п.8) — без базы, по содержимому файлов. */
class MigrationFileRulesTest {

    /** Унаследованные файлы A1 (до появления регламента имён {@code V\d{3}}) — проверяются только по деструктивности. */
    static final Set<String> LEGACY_A1 = Set.of("V1__auth_roles.sql", "V2__api_guards.sql", "V3__oneid.sql",
            "V4__system_roles_immutable.sql", "V5__login_failures_by_login_ip.sql");

    private static final Pattern NAME = Pattern.compile("^V\\d{3}__[a-z0-9_]+\\.sql$");
    private static final Pattern DESTRUCTIVE = Pattern.compile(
            "(?i)\\b(DROP\\s+(TABLE|COLUMN|SCHEMA|INDEX|CONSTRAINT)|TRUNCATE|ALTER\\s+TABLE\\s+\\S+\\s+(DROP|RENAME|ALTER\\s+COLUMN\\s+\\S+\\s+(TYPE|SET\\s+NOT\\s+NULL)))\\b");
    private static final Pattern DDL = Pattern.compile("(?i)^\\s*(CREATE|ALTER|DROP)\\b", Pattern.MULTILINE);
    private static final Pattern SEED = Pattern.compile("(?i)^\\s*(INSERT|COPY)\\b", Pattern.MULTILINE);
    private static final Pattern DOLLAR_BODY = Pattern.compile("\\$\\$.*?\\$\\$", Pattern.DOTALL);

    record Violation(String file, String rule) {
    }

    @Test
    @DisplayName("AC-2: реальные каталоги db/oltp и db/dwh соответствуют регламенту")
    void realCatalogsAreClean() throws IOException {
        List<Violation> violations = new ArrayList<>();
        violations.addAll(check("classpath*:" + FndPref.OLTP_MIGRATIONS + "/V*.sql"));
        violations.addAll(check("classpath*:" + FndPref.DWH_MIGRATIONS + "/V*.sql"));
        violations.addAll(check("classpath*:migration-fixtures/good/V*.sql"));
        assertThat(violations).isEmpty();
    }

    @Test
    @DisplayName("AC-2: фикстура-нарушитель даёт красный по каждому правилу")
    void violatorIsRed() throws IOException {
        List<Violation> violations = check("classpath*:migration-fixtures/bad/V*.sql");
        assertThat(violations).extracting(Violation::rule)
                .contains("header_timeouts", "ddl_and_seed_mixed", "destructive_not_approved");
    }

    static List<Violation> check(String pattern) throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver().getResources(pattern);
        assertThat(files).as("каталог %s не пуст", pattern).isNotEmpty();
        List<Violation> out = new ArrayList<>();
        for (Resource file : files) {
            String name = file.getFilename();
            String text = file.getContentAsString(StandardCharsets.UTF_8);
            boolean legacy = LEGACY_A1.contains(name);
            if (!legacy) {
                if (!NAME.matcher(name).matches()) {
                    out.add(new Violation(name, "file_name"));
                }
                List<String> head = Arrays.stream(text.split("\\R")).filter(l -> !l.isBlank()).limit(2).toList();
                if (head.size() < 2 || !head.get(0).trim().equals("set lock_timeout = '2s';")
                        || !head.get(1).trim().equals("set statement_timeout = '60s';")) {
                    out.add(new Violation(name, "header_timeouts"));
                }
                // Тела функций ($$ … $$) — часть DDL: INSERT внутри триггера сидом не считается
                String topLevel = DOLLAR_BODY.matcher(text).replaceAll("\\$\\$body\\$\\$");
                if (DDL.matcher(topLevel).find() && SEED.matcher(topLevel).find()) {
                    out.add(new Violation(name, "ddl_and_seed_mixed"));
                }
            }
            if (DESTRUCTIVE.matcher(text).find() && !approved(text)) {
                out.add(new Violation(name, "destructive_not_approved"));
            }
        }
        return out;
    }

    private static boolean approved(String text) {
        return text.contains("-- destructive: approved")
                && Pattern.compile("^-- reason: \\S", Pattern.MULTILINE).matcher(text).find()
                && Pattern.compile("^-- approved_by: \\S", Pattern.MULTILINE).matcher(text).find();
    }
}
