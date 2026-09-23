package com.greenwhite.dwh.instance.fnd.dwh;

import com.greenwhite.dwh.instance.fnd.FndPref;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Чтение строк {@code raw.rows} по типизированной спецификации (обзор данных):
 * только чтение, лимит времени запроса, имена полей и значения — связанными параметрами.
 * Произвольного SQL фасад не принимает.
 */
@Component
public class FndRawReader {

    private static final String QUERY_CANCELED = "57014";

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final String timeout;

    @Autowired
    public FndRawReader(@Qualifier(FndPref.DWH) DataSource dwh) {
        this(dwh, Duration.ofSeconds(10));
    }

    FndRawReader(DataSource dwh, Duration timeout) {
        this.jdbc = JdbcClient.create(dwh);
        this.tx = new TransactionTemplate(new DataSourceTransactionManager(dwh));
        this.tx.setReadOnly(true);
        this.timeout = timeout.toMillis() + "ms";
    }

    /** Число строк под фильтрами. */
    public long count(FndRawSpec spec, List<FndRawSpec.Filter> filters) {
        if (spec.loadIds().isEmpty()) {
            return 0;
        }
        Sql sql = new Sql(spec, filters);
        String query = "select count(*) from raw.rows where " + sql.where;
        return read(j -> j.sql(query).params(sql.params).query(Long.class).single());
    }

    /** Страница строк; {@code sort == null} — порядок загрузки. */
    public List<FndRawSpec.Row> page(FndRawSpec spec, List<FndRawSpec.Filter> filters, FndRawSpec.Sort sort,
                                     int offset, int limit) {
        if (spec.loadIds().isEmpty()) {
            return List.of();
        }
        Sql sql = new Sql(spec, filters);
        List<String> names = new ArrayList<>(spec.columns().keySet());
        StringBuilder query = new StringBuilder("select load_id, sheet, source_row_no");
        for (int i = 0; i < names.size(); i++) {
            String name = names.get(i);
            query.append(", ").append(FndRawValueSql.canonical(spec.type(name), sql.field(name))).append(" as c").append(i);
        }
        query.append(" from raw.rows where ").append(sql.where).append(" order by ");
        if (sort == null) {
            query.append("load_id, row_no");
        } else {
            query.append(FndRawValueSql.converted(spec.type(sort.field()), sql.field(sort.field())))
                    .append(sort.descending() ? " desc" : " asc").append(" nulls last, load_id, row_no");
        }
        query.append(" limit :limit offset :offset");
        sql.params.put("limit", limit);
        sql.params.put("offset", offset);
        String text = query.toString();
        return read(j -> j.sql(text).params(sql.params).query((rs, rowNum) -> row(rs, names)).list());
    }

    /** Группы по полю с суммами NUMBER-полей; {@code groupsTotal} — число групп до предела. */
    public FndRawSpec.Groups groups(FndRawSpec spec, List<FndRawSpec.Filter> filters, String groupBy, int limit) {
        if (spec.loadIds().isEmpty()) {
            return new FndRawSpec.Groups(0, List.of());
        }
        Sql sql = new Sql(spec, filters);
        List<String> sums = numberFields(spec);
        // Выражение группы — одно место в подзапросе: повтор связанного параметра дал бы разные $n и отказ group by
        StringBuilder inner = new StringBuilder("select ")
                .append(FndRawValueSql.converted(spec.type(groupBy), sql.field(groupBy))).append(" as g");
        appendSumSources(inner, spec, sql, sums);
        inner.append(" from raw.rows where ").append(sql.where);
        StringBuilder query = new StringBuilder("select g::text as g_value, count(*) as g_count");
        appendSums(query, sums);
        query.append(", count(*) over () as g_total from (").append(inner)
                .append(") t group by g order by g asc nulls last limit :limit");
        sql.params.put("limit", limit);
        String text = query.toString();
        List<GroupRow> rows = read(j -> j.sql(text).params(sql.params)
                .query((rs, rowNum) -> new GroupRow(group(rs, rs.getString("g_value"), sums), rs.getLong("g_total")))
                .list());
        int total = rows.isEmpty() ? 0 : Math.toIntExact(rows.getFirst().total());
        return new FndRawSpec.Groups(total, rows.stream().map(GroupRow::group).toList());
    }

    /** Итог под фильтрами: число строк и суммы NUMBER-полей ({@code value = null}). */
    public FndRawSpec.Group totals(FndRawSpec spec, List<FndRawSpec.Filter> filters) {
        List<String> sums = numberFields(spec);
        if (spec.loadIds().isEmpty()) {
            Map<String, BigDecimal> zeros = new LinkedHashMap<>();
            sums.forEach(name -> zeros.put(name, BigDecimal.ZERO));
            return new FndRawSpec.Group(null, 0, zeros);
        }
        Sql sql = new Sql(spec, filters);
        StringBuilder inner = new StringBuilder("select 1 as one");
        appendSumSources(inner, spec, sql, sums);
        inner.append(" from raw.rows where ").append(sql.where);
        StringBuilder query = new StringBuilder("select count(*) as g_count");
        appendSums(query, sums);
        query.append(" from (").append(inner).append(") t");
        String text = query.toString();
        return read(j -> j.sql(text).params(sql.params).query((rs, rowNum) -> group(rs, null, sums)).single());
    }

    /**
     * Сводная за год (контракт отчёта 4.5): ячейки уровней по месяцам, подытоги и общий итог считает база
     * одним запросом {@code grouping sets}; год {@code null} — последний из {@code years}.
     */
    public FndPivotSpec.Pivot pivot(FndPivotSpec spec) {
        if (spec.data().loadIds().isEmpty()) {
            return new FndPivotSpec.Pivot(List.of(), List.of(), 0, BigDecimal.ZERO, 0);
        }
        PivotSql sql = new PivotSql(spec, false);
        return read(j -> {
            List<Integer> years = j.sql(sql.withData()
                            + " select distinct extract(year from dt)::int as y from d where dt is not null order by 1")
                    .params(sql.params).query(Integer.class).list();
            List<FndPivotSpec.Cell> cells = years.isEmpty()
                    ? List.of()
                    : pivotCells(j, sql, spec.year() != null ? spec.year() : years.getLast());
            CellTotal undated = j.sql(sql.withData() + " select count(*) as cnt, " + sql.value + " as val from d where dt is null")
                    .params(sql.params).query((rs, rowNum) -> cellTotal(rs)).single();
            return new FndPivotSpec.Pivot(years, cells, undated.count(), undated.value(), refDuplicateKeys(j, sql));
        });
    }

    /** Строки одной ячейки сводной страницей в порядке загрузки, плюс число строк и мера всей ячейки. */
    public FndPivotSpec.CellRows pivotRows(FndPivotSpec spec, FndPivotSpec.CellQuery cell, int offset, int limit) {
        requireCell(spec, cell);
        if (spec.data().loadIds().isEmpty()) {
            return new FndPivotSpec.CellRows(0, BigDecimal.ZERO, List.of());
        }
        PivotSql sql = new PivotSql(spec, true);
        String where = sql.cellCondition(cell);
        sql.params.put("limit", limit);
        sql.params.put("offset", offset);
        String totalQuery = sql.withAll() + " select count(*) as cnt, " + sql.value + " as val from j where " + where;
        String pageQuery = sql.withAll() + " select load_id, sheet, source_row_no, dt_text, m_text, n1, n2 from j where "
                + where + " order by load_id, row_no limit :limit offset :offset";
        return read(j -> {
            CellTotal total = j.sql(totalQuery).params(sql.params).query((rs, rowNum) -> cellTotal(rs)).single();
            List<FndPivotSpec.CellRow> rows = j.sql(pageQuery).params(sql.params)
                    .query((rs, rowNum) -> cellRow(rs)).list();
            return new FndPivotSpec.CellRows(total.count(), total.value(), rows);
        });
    }

    private static List<FndPivotSpec.Cell> pivotCells(JdbcClient j, PivotSql sql, int year) {
        Map<String, Object> params = new HashMap<>(sql.params);
        params.put("year", year);
        return j.sql(sql.cellsQuery()).params(params).query((rs, rowNum) -> cell(rs)).list();
    }

    private static int refDuplicateKeys(JdbcClient j, PivotSql sql) {
        if (sql.refKeys == null) {
            return 0;
        }
        String query = "with " + sql.refKeys
                + " select count(*) from (select 1 from rk group by k1, k2 having count(*) > 1) x";
        return Math.toIntExact(j.sql(query).params(sql.params).query(Long.class).single());
    }

    private static void requireCell(FndPivotSpec spec, FndPivotSpec.CellQuery cell) {
        if (cell.kind() == null) {
            throw new IllegalArgumentException("Не задан период ячейки");
        }
        if (cell.kind() != FndPivotSpec.PeriodKind.UNDATED && spec.year() == null) {
            throw new IllegalArgumentException("Для месяца или года ячейки нужен год");
        }
        if (cell.kind() == FndPivotSpec.PeriodKind.MONTH && cell.month() == null) {
            throw new IllegalArgumentException("Для ячейки месяца нужен месяц");
        }
        if (cell.path().size() > (spec.level2() == null ? 1 : 2)) {
            throw new IllegalArgumentException("Путь ячейки глубже уровней");
        }
    }

    private static FndPivotSpec.Cell cell(ResultSet rs) throws SQLException {
        int depth = rs.getInt("x1") == 1 ? 0 : rs.getInt("x2") == 1 ? 1 : 2;
        Integer month = rs.getInt("xm") == 1 ? null : rs.getObject("mon", Integer.class);
        return new FndPivotSpec.Cell(depth,
                depth >= 1 ? rs.getString("g1") : null,
                depth == 2 ? rs.getString("g2") : null,
                month, rs.getLong("cnt"), rs.getBigDecimal("val"),
                depth >= 1 ? rs.getString("name1") : null,
                depth == 2 ? rs.getString("name2") : null);
    }

    private static CellTotal cellTotal(ResultSet rs) throws SQLException {
        return new CellTotal(rs.getLong("cnt"), rs.getBigDecimal("val"));
    }

    private static FndPivotSpec.CellRow cellRow(ResultSet rs) throws SQLException {
        return new FndPivotSpec.CellRow(rs.getLong("load_id"), rs.getString("sheet"),
                rs.getObject("source_row_no", Integer.class), rs.getString("dt_text"), rs.getString("m_text"),
                rs.getString("n1"), rs.getString("n2"));
    }

    <T> T read(Function<JdbcClient, T> query) {
        try {
            return tx.execute(status -> {
                jdbc.sql("set local statement_timeout = '" + timeout + "'").update();
                return query.apply(jdbc);
            });
        } catch (DataAccessException failure) {
            if (isCanceled(failure)) {
                throw new DwhQueryTimeoutException(failure);
            }
            throw failure;
        }
    }

    private static boolean isCanceled(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sqlFailure && QUERY_CANCELED.equals(sqlFailure.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static List<String> numberFields(FndRawSpec spec) {
        return spec.columns().entrySet().stream()
                .filter(entry -> entry.getValue() == FndRawSpec.Type.NUMBER)
                .map(Map.Entry::getKey)
                .toList();
    }

    private static void appendSumSources(StringBuilder inner, FndRawSpec spec, Sql sql, List<String> sums) {
        for (int i = 0; i < sums.size(); i++) {
            inner.append(", ").append(FndRawValueSql.converted(spec.type(sums.get(i)), sql.field(sums.get(i))))
                    .append(" as s").append(i);
        }
    }

    private static void appendSums(StringBuilder query, List<String> sums) {
        for (int i = 0; i < sums.size(); i++) {
            query.append(", coalesce(sum(s").append(i).append("), 0) as s").append(i);
        }
    }

    private static FndRawSpec.Group group(ResultSet rs, String value, List<String> sums) throws SQLException {
        Map<String, BigDecimal> values = new LinkedHashMap<>();
        for (int i = 0; i < sums.size(); i++) {
            values.put(sums.get(i), rs.getBigDecimal("s" + i));
        }
        return new FndRawSpec.Group(value, rs.getLong("g_count"), values);
    }

    private static FndRawSpec.Row row(ResultSet rs, List<String> names) throws SQLException {
        Map<String, String> values = new LinkedHashMap<>();
        for (int i = 0; i < names.size(); i++) {
            values.put(names.get(i), rs.getString("c" + i));
        }
        return new FndRawSpec.Row(rs.getLong("load_id"), rs.getString("sheet"),
                rs.getObject("source_row_no", Integer.class), values);
    }

    private record GroupRow(FndRawSpec.Group group, long total) {
    }

    /** Условие и связанные параметры одного запроса. */
    private static final class Sql {

        private final FndRawSpec spec;
        private final StringBuilder where = new StringBuilder("load_id in (:loadIds) and sheet = :sheet");
        private final Map<String, Object> params = new HashMap<>();
        private int counter;

        Sql(FndRawSpec spec, List<FndRawSpec.Filter> filters) {
            this.spec = spec;
            params.put("loadIds", spec.loadIds());
            params.put("sheet", spec.sheet());
            if (filters != null) {
                filters.forEach(this::filter);
            }
        }

        String field(String name) {
            String key = "f" + counter++;
            params.put(key, name);
            return "fields ->> :" + key;
        }

        String bind(Object value) {
            String key = "p" + counter++;
            params.put(key, value);
            return ":" + key;
        }

        private void filter(FndRawSpec.Filter filter) {
            FndRawSpec.Type type = spec.type(filter.field());
            switch (filter) {
                case FndRawSpec.Contains contains -> {
                    if (type != FndRawSpec.Type.TEXT) {
                        throw new IllegalArgumentException("«Содержит» — только для текстового поля");
                    }
                    and(field(contains.field()) + " ilike " + bind(FndRawValueSql.likePattern(contains.text()))
                            + " escape '\\'");
                }
                case FndRawSpec.Between between -> {
                    if (type == FndRawSpec.Type.TEXT) {
                        throw new IllegalArgumentException("«Между» — только для числа или даты");
                    }
                    if (between.from() != null) {
                        and(FndRawValueSql.converted(type, field(between.field())) + " >= " + bind(between.from()));
                    }
                    if (between.to() != null) {
                        and(FndRawValueSql.converted(type, field(between.field())) + " <= " + bind(between.to()));
                    }
                }
                case FndRawSpec.Eq eq -> {
                    String converted = FndRawValueSql.converted(type, field(eq.field()));
                    and(eq.value() == null ? converted + " is null" : converted + " = " + bind(eq.value()));
                }
            }
        }

        private void and(String condition) {
            where.append(" and ").append(condition);
        }
    }

    private record CellTotal(long count, BigDecimal value) {
    }

    /**
     * Части запроса сводной и их связанные параметры: {@code d} — строки источника, {@code rk} — строки справочника
     * с ключом, {@code r} — одна строка справочника на ключ (последняя загрузка, в ней первая строка),
     * {@code j} — строка источника с её строкой справочника, группами и названиями уровней.
     * Поля источника — параметры {@code df*}, справочника — {@code rf*}, значения ячейки — {@code p*}.
     */
    private static final class PivotSql {

        private final FndPivotSpec spec;
        private final Map<String, Object> params = new HashMap<>();
        private final String value;
        private final String data;
        private final String refKeys;
        private final String joined;
        private int counter;

        PivotSql(FndPivotSpec spec, boolean withText) {
            this.spec = spec;
            this.value = spec.measureField() == null ? "count(*)::numeric" : "coalesce(sum(m), 0)";
            this.data = dataCte(withText);
            this.refKeys = spec.ref() == null ? null : refKeysCte();
            this.joined = joinedCte();
        }

        String withData() {
            return "with " + data;
        }

        String withAll() {
            String ref = refKeys == null ? ""
                    : ", " + refKeys + ", r as (select distinct on (k1, k2) * from rk order by k1, k2, rl desc, rr)";
            return "with " + data + ref + ", " + joined;
        }

        String cellsQuery() {
            boolean two = spec.level2() != null;
            String sets = two ? "(g1, g2, mon), (g1, g2), (g1, mon), (g1), (mon), ()" : "(g1, mon), (g1), (mon), ()";
            return withAll() + " select grouping(g1) as x1, " + (two ? "grouping(g2)" : "1") + " as x2, grouping(mon) as xm,"
                    + " g1, " + (two ? "g2" : "null::text") + " as g2, mon, count(*) as cnt, " + value + " as val,"
                    + " (array_agg(n1 order by " + nameOrder(spec.level1()) + "))[1] as name1, "
                    + (two ? "(array_agg(n2 order by " + nameOrder(spec.level2()) + "))[1]" : "null::text") + " as name2"
                    + " from j where extract(year from dt) = :year group by grouping sets (" + sets + ")"
                    + " order by x1 desc, g1 asc nulls last, x2 desc, g2 asc nulls last, xm desc, mon";
        }

        String cellCondition(FndPivotSpec.CellQuery cell) {
            List<String> conditions = new ArrayList<>();
            switch (cell.kind()) {
                case MONTH -> {
                    conditions.add("extract(year from dt) = " + bind(spec.year()));
                    conditions.add("extract(month from dt) = " + bind(cell.month()));
                }
                case YEAR -> conditions.add("extract(year from dt) = " + bind(spec.year()));
                case UNDATED -> conditions.add("dt is null");
            }
            for (int i = 0; i < cell.path().size(); i++) {
                conditions.add("g" + (i + 1) + " is not distinct from cast(" + bind(cell.path().get(i)) + " as text)");
            }
            return String.join(" and ", conditions);
        }

        private String dataCte(boolean withText) {
            params.put("dataLoadIds", spec.data().loadIds());
            params.put("dataSheet", spec.data().sheet());
            String measure = spec.measureField();
            StringBuilder cte = new StringBuilder("d as (select load_id, row_no, sheet, source_row_no, ")
                    .append(FndRawValueSql.converted(FndRawSpec.Type.DATE, dataField(spec.dateField()))).append(" as dt, ")
                    .append(measure == null ? "null::numeric"
                            : FndRawValueSql.converted(FndRawSpec.Type.NUMBER, dataField(measure))).append(" as m");
            for (int i = 0; i < 2; i++) {
                String key = i < spec.keys().size() ? FndRawValueSql.key(dataField(spec.keys().get(i).field())) : "''";
                cte.append(", ").append(key).append(" as k").append(i + 1);
            }
            appendLevel(cte, spec.level1(), 1, FndPivotSpec.Origin.DATA);
            appendLevel(cte, spec.level2(), 2, FndPivotSpec.Origin.DATA);
            if (withText) {
                cte.append(", ").append(FndRawValueSql.canonical(FndRawSpec.Type.DATE, dataField(spec.dateField())))
                        .append(" as dt_text, ")
                        .append(measure == null ? "null::text"
                                : FndRawValueSql.canonical(FndRawSpec.Type.NUMBER, dataField(measure))).append(" as m_text");
            }
            return cte.append(" from raw.rows where load_id in (:dataLoadIds) and sheet = :dataSheet)").toString();
        }

        private String refKeysCte() {
            StringBuilder cte = new StringBuilder("rk as (select load_id as rl, row_no as rr");
            for (int i = 0; i < 2; i++) {
                String key = i < spec.keys().size() ? FndRawValueSql.key(refField(spec.keys().get(i).refField())) : "''";
                cte.append(", ").append(key).append(" as k").append(i + 1);
            }
            appendLevel(cte, spec.level1(), 1, FndPivotSpec.Origin.REF);
            appendLevel(cte, spec.level2(), 2, FndPivotSpec.Origin.REF);
            cte.append(" from raw.rows where ");
            if (spec.ref().loadIds().isEmpty()) {
                cte.append("false");
            } else {
                params.put("refLoadIds", spec.ref().loadIds());
                params.put("refSheet", spec.ref().sheet());
                cte.append("load_id in (:refLoadIds) and sheet = :refSheet");
            }
            return cte.append(")").toString();
        }

        private String joinedCte() {
            StringBuilder cte = new StringBuilder("j as (select d.*, ");
            appendGroup(cte, spec.level1(), 1);
            cte.append(", ");
            if (spec.level2() == null) {
                cte.append("null::text as g2, null::text as n2");
            } else {
                appendGroup(cte, spec.level2(), 2);
            }
            if (refKeys != null) {
                cte.append(", r.rl, r.rr");
            }
            cte.append(", extract(month from d.dt)::int as mon from d");
            if (refKeys != null) {
                cte.append(" left join r on r.k1 = d.k1 and r.k2 = d.k2");
            }
            return cte.append(")").toString();
        }

        private void appendLevel(StringBuilder cte, FndPivotSpec.Level level, int index, FndPivotSpec.Origin origin) {
            if (level == null || level.origin() != origin) {
                return;
            }
            String text = origin == FndPivotSpec.Origin.DATA ? dataField(level.field()) : refField(level.field());
            FndRawSpec part = origin == FndPivotSpec.Origin.DATA ? spec.data() : spec.ref();
            cte.append(", ").append(FndRawValueSql.canonical(part.type(level.field()), text)).append(" as v").append(index);
        }

        private static void appendGroup(StringBuilder cte, FndPivotSpec.Level level, int index) {
            String text = (level.origin() == FndPivotSpec.Origin.DATA ? "d.v" : "r.v") + index;
            cte.append(FndRawValueSql.groupKey(text)).append(" as g").append(index).append(", ")
                    .append(FndRawValueSql.trimmed(text)).append(" as n").append(index);
        }

        private static String nameOrder(FndPivotSpec.Level level) {
            return level.origin() == FndPivotSpec.Origin.DATA ? "load_id, row_no" : "rl desc, rr";
        }

        private String dataField(String name) {
            return field("df", name);
        }

        private String refField(String name) {
            return field("rf", name);
        }

        private String field(String prefix, String name) {
            String key = prefix + counter++;
            params.put(key, name);
            return "fields ->> :" + key;
        }

        private String bind(Object value) {
            String key = "p" + counter++;
            params.put(key, value);
            return ":" + key;
        }
    }
}
