package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Source;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceSummary;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Strictness;
import com.greenwhite.dwh.instance.upl.format.UplFormatRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Репозиторий анкеты файла (И3 шаг 3.4): запись и чтение источника, версии, листов и колонок. */
class UplFormatRepositoryTest extends EmbeddedPostgresTest {

    private static final String PREFIX = "test.repo.";

    @Autowired
    private UplFormatRepository repo;
    @Autowired
    private FndVersioning versioning;
    @Autowired
    private FndActors actors;
    @Autowired
    private TransactionTemplate tx;
    @Autowired
    private JdbcClient jdbc;

    @Test
    @DisplayName("источник: вставка, чтение, правка с оптимистической блокировкой")
    void insertFindUpdateSource() {
        inRolledBackTx(() -> {
            String actor = actors.system().name();
            long id = repo.insertSource(data("test.repo.1", "TEST source"), actor);

            Source found = repo.findSource(id).orElseThrow();
            assertThat(found.code()).isEqualTo("test.repo.1");
            assertThat(found.name()).isEqualTo("TEST source");
            assertThat(found.ownerOrg()).isEqualTo("TEST org");
            assertThat(found.ownerContact()).isEqualTo("TEST contact");
            assertThat(found.periodicity()).isEqualTo(Periodicity.MONTH);
            assertThat(found.slaDays()).isEqualTo(5);
            assertThat(found.sourceType()).isEqualTo(SourceType.FILE);
            assertThat(found.strictness()).isEqualTo(Strictness.ERROR);
            assertThat(found.lockVersion()).isZero();
            assertThat(found.createdBy()).isEqualTo(actor);
            assertThat(found.modifiedBy()).isEqualTo(actor);
            assertThat(found.createdAt()).isNotNull();
            assertThat(found.modifiedAt()).isNotNull();

            SourceData changed = new SourceData("test.repo.1", "TEST source 2", "TEST org 2", null,
                    Periodicity.QUARTER, 10, SourceType.FILE, Strictness.WARNING);
            assertThat(repo.updateSource(id, 0, changed, actor)).isEqualTo(1);
            Source updated = repo.findSource(id).orElseThrow();
            assertThat(updated.lockVersion()).isEqualTo(1);
            assertThat(updated.name()).isEqualTo("TEST source 2");
            assertThat(updated.ownerContact()).isNull();
            assertThat(updated.periodicity()).isEqualTo(Periodicity.QUARTER);
            assertThat(updated.strictness()).isEqualTo(Strictness.WARNING);

            assertThat(repo.updateSource(id, 0, changed, actor)).isZero();
        });
    }

    @Test
    @DisplayName("список источников: keyset по code, признаки версий у источника без версий")
    void listSourcesKeyset() {
        inRolledBackTx(() -> {
            String actor = actors.system().name();
            String p = PREFIX + UUID.randomUUID().toString().substring(0, 6);
            repo.insertSource(data(p + ".c", "TEST c"), actor);
            repo.insertSource(data(p + ".a", "TEST a"), actor);
            repo.insertSource(data(p + ".b", "TEST b"), actor);
            assertThat(repo.countSources()).isGreaterThanOrEqualTo(3);

            List<SourceSummary> first = repo.listSources(p, 2);
            assertThat(first).extracting(SourceSummary::code).containsExactly(p + ".a", p + ".b");
            List<SourceSummary> next = repo.listSources(p + ".b", 2);
            assertThat(next).first().extracting(SourceSummary::code).isEqualTo(p + ".c");

            SourceSummary a = first.get(0);
            assertThat(a.lastPublishedVersion()).isNull();
            assertThat(a.hasDraft()).isFalse();
            assertThat(a.periodicity()).isEqualTo(Periodicity.MONTH);
        });
    }

    @Test
    @DisplayName("AC-15: таблицы upl под аудитом основы, вставка источника пишет audit_log с актором")
    void uplTablesAreAudited() {
        List<String> registered = jdbc.sql("""
                        select table_name from fnd_audit_tables
                         where enabled and table_name like 'upl\\_%' order by 1
                        """).query(String.class).list();
        assertThat(registered).containsExactlyInAnyOrder(
                "upl_sources", "upl_format_versions", "upl_format_sheets", "upl_format_columns",
                "upl_packages", "upl_package_errors");

        inRolledBackTx(() -> {
            long id = repo.insertSource(data(PREFIX + "audit", "TEST audit"), actors.system().name());
            List<Map<String, Object>> rows = jdbc.sql("""
                            select event, changed_by from audit_log
                             where table_name = 'upl_sources' and row_pk = :pk
                            """).param("pk", String.valueOf(id)).query().listOfRows();
            assertThat(rows).singleElement().satisfies(row -> {
                assertThat(row).containsEntry("event", "I");
                assertThat(row.get("changed_by")).isNotNull();
            });
        });
    }

    @Test
    @DisplayName("листы и колонки черновика: замена целиком и чтение по порядку")
    void replaceAndReadSheets() {
        inRolledBackTx(() -> {
            long id = repo.insertSource(data("test.repo.s", "TEST sheets"), actors.system().name());
            int version = versioning.createDraft(UplPref.TABLE_FORMAT_VERSIONS, id, actors.system());
            assertThat(repo.latestVersion(id)).contains(version);

            Column key = new Column(null, 0, 1, "TEST key", "object_key", DataType.OBJECT_KEY, true,
                    null, null, "^[0-9]{9}$", 9, 1, null);
            Column amount = new Column(null, 0, null, "TEST amount", "amount", DataType.NUMBER, false,
                    "unit.test", "unit.test", null, null, null, null);
            Column code = new Column(null, 0, null, "TEST code", "ref_value", DataType.REF_CODE, false,
                    null, null, null, null, null, "test.book");
            repo.replaceSheets(id, version, List.of(
                    new Sheet(null, 0, "TEST sheet 1", 2, "TEST total", List.of(key, amount)),
                    new Sheet(null, 0, "TEST sheet 2", 1, null, List.of(code))));

            FormatVersion read = repo.findVersion(id, version).orElseThrow();
            assertThat(read.status()).isEqualTo("draft");
            assertThat(read.sheets()).hasSize(2);
            Sheet s1 = read.sheets().get(0);
            assertThat(s1.id()).isNotNull();
            assertThat(s1.ordinal()).isEqualTo(1);
            assertThat(s1.sheetName()).isEqualTo("TEST sheet 1");
            assertThat(s1.headerRow()).isEqualTo(2);
            assertThat(s1.totalRowMarker()).isEqualTo("TEST total");
            assertThat(s1.columns()).hasSize(2);
            Column c1 = s1.columns().get(0);
            assertThat(c1.id()).isNotNull();
            assertThat(c1).usingRecursiveComparison().ignoringFields("id", "ordinal").isEqualTo(key);
            assertThat(c1.ordinal()).isEqualTo(1);
            Column c2 = s1.columns().get(1);
            assertThat(c2).usingRecursiveComparison().ignoringFields("id", "ordinal").isEqualTo(amount);
            assertThat(c2.ordinal()).isEqualTo(2);
            Sheet s2 = read.sheets().get(1);
            assertThat(s2.ordinal()).isEqualTo(2);
            assertThat(s2.totalRowMarker()).isNull();
            assertThat(s2.columns()).singleElement().satisfies(c -> {
                assertThat(c.ordinal()).isEqualTo(1);
                assertThat(c).usingRecursiveComparison().ignoringFields("id", "ordinal").isEqualTo(code);
            });

            repo.replaceSheets(id, version, List.of(new Sheet(null, 0, "TEST only", 1, null, List.of(code))));
            FormatVersion replaced = repo.findVersion(id, version).orElseThrow();
            assertThat(replaced.sheets()).singleElement()
                    .satisfies(s -> assertThat(s.sheetName()).isEqualTo("TEST only"));

            assertThat(repo.listVersions(id)).singleElement().satisfies(v -> {
                assertThat(v.status()).isEqualTo("draft");
                assertThat(v.sheets()).isEmpty();
            });
            SourceSummary summary = ours(repo.listSources(null, 1000)).stream()
                    .filter(s -> s.id() == id).findFirst().orElseThrow();
            assertThat(summary.hasDraft()).isTrue();
            assertThat(summary.lastPublishedVersion()).isNull();
        });
    }

    @Test
    @DisplayName("листы опубликованной версии неизменны: upl_format_not_draft")
    void publishedChildrenAreGuarded() {
        inRolledBackTx(() -> {
            long id = repo.insertSource(data("test.repo.p", "TEST published"), actors.system().name());
            int version = versioning.createDraft(UplPref.TABLE_FORMAT_VERSIONS, id, actors.system());
            List<Sheet> sheets = List.of(new Sheet(null, 0, "TEST sheet", 1, null, List.of(
                    new Column(null, 0, null, "TEST text", "label", DataType.TEXT, false,
                            null, null, null, null, null, null))));
            repo.replaceSheets(id, version, sheets);
            versioning.publish(UplPref.TABLE_FORMAT_VERSIONS, id, version, LocalDate.of(2026, 1, 1), null, actors.system());

            assertThatThrownBy(() -> repo.replaceSheets(id, version, sheets))
                    .hasStackTraceContaining("upl_format_not_draft");
        });
    }

    @Test
    @DisplayName("С-2, AC-12: прямые insert/update/delete листа и колонки опубликованной версии запрещены")
    void publishedChildrenGuardedForEveryOperation() {
        Long created = tx.execute(st -> {
            actors.apply(actors.system());
            return publishedWithDraft(PREFIX + "guard." + UUID.randomUUID().toString().substring(0, 8));
        });
        long id = java.util.Objects.requireNonNull(created);
        long publishedSheet = sheetId(id, 1);
        long draftSheet = sheetId(id, 2);
        long publishedColumn = columnId(publishedSheet);
        long draftColumn = columnId(draftSheet);
        Map<String, Object> ids = Map.of("src", id, "ps", publishedSheet, "ds", draftSheet,
                "pc", publishedColumn, "dc", draftColumn);

        List<String> forbidden = List.of(
                "insert into upl_format_sheets (source_id, version, ordinal, sheet_name, header_row)"
                        + " values (:src, 1, 99, 'TEST extra', 1)",
                "update upl_format_sheets set sheet_name = 'TEST renamed' where id = :ps",
                "update upl_format_sheets set version = 2 where id = :ps",
                "update upl_format_sheets set version = 1 where id = :ds",
                "delete from upl_format_sheets where id = :ps",
                "insert into upl_format_columns (sheet_id, ordinal, name_in_file, target_field, data_type)"
                        + " values (:ps, 99, 'TEST extra', 'extra', 'text')",
                "update upl_format_columns set name_in_file = 'TEST renamed' where id = :pc",
                "update upl_format_columns set sheet_id = :ds where id = :pc",
                "update upl_format_columns set sheet_id = :ps where id = :dc",
                "delete from upl_format_columns where id = :pc");
        for (String sql : forbidden) {
            inRolledBackTx(() -> assertThatThrownBy(() -> jdbc.sql(sql).params(ids).update())
                    .as(sql)
                    .hasStackTraceContaining("upl_format_not_draft"));
        }

        inRolledBackTx(() -> {
            assertThat(jdbc.sql("update upl_format_columns set name_in_file = 'TEST renamed' where id = :dc")
                    .params(ids).update()).isEqualTo(1);
            assertThat(jdbc.sql("update upl_format_sheets set sheet_name = 'TEST renamed' where id = :ds")
                    .params(ids).update()).isEqualTo(1);
            assertThat(jdbc.sql("delete from upl_format_columns where id = :dc").params(ids).update())
                    .isEqualTo(1);
            assertThat(jdbc.sql("delete from upl_format_sheets where id = :ds").params(ids).update())
                    .isEqualTo(1);
        });
    }

    /** Источник с опубликованной версией 1 и черновиком 2; у каждой — один лист с одной колонкой. */
    private long publishedWithDraft(String code) {
        long id = repo.insertSource(data(code, "TEST guard"), actors.system().name());
        List<Sheet> sheets = List.of(new Sheet(null, 0, "TEST sheet", 1, null, List.of(
                new Column(null, 0, null, "TEST text", "label", DataType.TEXT, false,
                        null, null, null, null, null, null))));
        int first = versioning.createDraft(UplPref.TABLE_FORMAT_VERSIONS, id, actors.system());
        repo.replaceSheets(id, first, sheets);
        versioning.publish(UplPref.TABLE_FORMAT_VERSIONS, id, first, LocalDate.of(2026, 1, 1), null, actors.system());
        int second = versioning.createDraft(UplPref.TABLE_FORMAT_VERSIONS, id, actors.system());
        repo.replaceSheets(id, second, sheets);
        assertThat(List.of(first, second)).containsExactly(1, 2);
        return id;
    }

    private long sheetId(long sourceId, int version) {
        return jdbc.sql("select id from upl_format_sheets where source_id = :src and version = :v")
                .param("src", sourceId).param("v", version).query(Long.class).single();
    }

    private long columnId(long sheetId) {
        return jdbc.sql("select id from upl_format_columns where sheet_id = :s")
                .param("s", sheetId).query(Long.class).single();
    }

    private void inRolledBackTx(Runnable body) {
        tx.executeWithoutResult(st -> {
            st.setRollbackOnly();
            actors.apply(actors.system());
            body.run();
        });
    }

    private static SourceData data(String code, String name) {
        return new SourceData(code, name, "TEST org", "TEST contact", Periodicity.MONTH, 5,
                SourceType.FILE, Strictness.ERROR);
    }

    private static List<SourceSummary> ours(List<SourceSummary> all) {
        return all.stream().filter(s -> s.code().startsWith(PREFIX)).toList();
    }
}
