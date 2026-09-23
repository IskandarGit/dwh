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
}
