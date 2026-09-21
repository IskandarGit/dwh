package com.greenwhite.dwh.instance.fnd.migration;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** AC-2: регламент файлов миграций (промпт 02 п.1–2, п.8) — без базы, по содержимому файлов. */
class MigrationFileRulesTest {

    /** Наши файлы в общем каталоге каркаса — от V100; всё ниже принадлежит upstream и не проверяется (AC-2). */
    private static final Pattern OURS = Pattern.compile("^V([1-9]\\d{2,})__.+\\.sql$");

    private static final Pattern NAME = Pattern.compile("^V\\d{3}__[a-z0-9_]+\\.sql$");
    /** Деструктивный DDL — в любом месте верхнего уровня (тела функций $$…$$ вырезаются заранее). */
    private static final Pattern DESTRUCTIVE_DDL = Pattern.compile(
            "(?i)\\b(DROP\\s+(TABLE|COLUMN|SCHEMA|INDEX|CONSTRAINT|FUNCTION|TRIGGER|TYPE|VIEW)|TRUNCATE"
            + "|ALTER\\s+TABLE\\s+\\S+\\s+(DROP|RENAME|ALTER\\s+COLUMN\\s+\\S+\\s+(TYPE|SET\\s+NOT\\s+NULL)))\\b");
    /** Деструктивный DML — только как начало оператора: `on conflict do update` и `create trigger … after update` не считаются. */
    private static final Pattern DESTRUCTIVE_DML = Pattern.compile("(?im)^\\s*(DELETE\\s+FROM|UPDATE\\s+\\S+\\s+SET)\\b");
    private static final Pattern DDL = Pattern.compile("(?i)^\\s*(CREATE|ALTER|DROP)\\b", Pattern.MULTILINE);
    private static final Pattern SEED = Pattern.compile("(?i)^\\s*(INSERT|COPY)\\b", Pattern.MULTILINE);
    private static final Pattern DOLLAR_BODY = Pattern.compile("\\$\\$.*?\\$\\$", Pattern.DOTALL);

    record Violation(String file, String rule) {
    }

    @Test
    @DisplayName("AC-2: наши миграции (V1xx и db/dwh) соответствуют регламенту; файлы каркаса не проверяются")
    void realCatalogsAreClean() throws IOException {
        List<Violation> violations = new ArrayList<>();
        violations.addAll(check("classpath*:" + FndPref.OLTP_MIGRATIONS + "/V*.sql"));
        // Каталог pg-dwh целиком наш: там нумерация начинается с V001 и правила действуют для всех файлов
        violations.addAll(check("classpath*:" + FndPref.DWH_MIGRATIONS + "/V*.sql", true));
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

    @ParameterizedTest
    @ValueSource(strings = {"drop table t;", "drop function f();", "drop trigger t on x;", "drop type t;", "drop view v;",
            "drop index i;", "drop schema s;", "delete from t where id = 1;", "update t set a = 1;", "truncate t;",
            "alter table t drop column c;"})
    @DisplayName("AC-2/M-6: каждое деструктивное слово — красный")
    void destructiveWordsAreRed(String sql) {
        assertThat(destructive("set lock_timeout = '2s';\nset statement_timeout = '60s';\n" + sql)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "create or replace function f() returns void language sql as $$ select 1 $$;",
            "create or replace function f() returns trigger language plpgsql as $$\nbegin\n"
                    + "  delete from t; execute 'drop trigger x on y'; update t set a = 1;\nend $$;",
            "insert into t (a) values (1) on conflict (a) do update set b = excluded.b;",
            "create trigger trg before update or delete on t for each row execute function f();"})
    @DisplayName("AC-2/M-6: create or replace function, do update, тела функций и триггеры — не деструктивны")
    void nonDestructiveIsGreen(String sql) {
        assertThat(destructive(sql)).isFalse();
    }

    static List<Violation> check(String pattern) throws IOException {
        return check(pattern, false);
    }

    /** {@code allOurs} — каталог, где нет файлов каркаса: проверяются все файлы, а не только V1xx. */
    static List<Violation> check(String pattern, boolean allOurs) throws IOException {
        Resource[] files = new PathMatchingResourcePatternResolver().getResources(pattern);
        assertThat(files).as("каталог %s не пуст", pattern).isNotEmpty();
        List<Violation> out = new ArrayList<>();
        for (Resource file : files) {
            String name = file.getFilename();
            String text = file.getContentAsString(StandardCharsets.UTF_8);
            // Файлы каркаса (V0xx) — зона upstream: их регламент мы не проверяем и не правим (AC-2)
            if (name == null || !(allOurs || OURS.matcher(name).matches())) {
                continue;
            }
            {
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
            if (destructive(text) && !approved(text)) {
                out.add(new Violation(name, "destructive_not_approved"));
            }
        }
        return out;
    }

    /** Деструктивна ли миграция: смотрим только верхний уровень — тела функций ($$…$$) вырезаны (M-6). */
    static boolean destructive(String text) {
        String topLevel = DOLLAR_BODY.matcher(text).replaceAll("\\$\\$body\\$\\$");
        return DESTRUCTIVE_DDL.matcher(topLevel).find() || DESTRUCTIVE_DML.matcher(topLevel).find();
    }

    private static boolean approved(String text) {
        return text.contains("-- destructive: approved")
                && Pattern.compile("^-- reason: \\S", Pattern.MULTILINE).matcher(text).find()
                && Pattern.compile("^-- approved_by: \\S", Pattern.MULTILINE).matcher(text).find();
    }
}
