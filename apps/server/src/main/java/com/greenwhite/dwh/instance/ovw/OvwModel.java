package com.greenwhite.dwh.instance.ovw;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Записи запросов и ответов обзора данных (контракт И14, раздел 2.1); имена полей JSON = имена компонент. */
public final class OvwModel {

    private OvwModel() {
    }

    public record SourceItem(long id, String code, String name) { }

    public record SheetItem(int ordinal, String name) { }

    /** Колонка анкеты; {@code type} — тип анкеты строчными: text|integer|number|date|object_key|ref_code. */
    public record ColumnItem(String field, String label, String type, boolean summable) { }

    public record PackageItem(String fileName, LocalDate periodFrom, LocalDate periodTo) { }

    public record Layout(long sourceId, List<SheetItem> sheets, Integer sheet, Integer formatVersion,
                         List<ColumnItem> columns, List<PackageItem> packages, long rowsTotal) { }

    /** Фильтр: {@code op} contains|eq — {@code value}, between — {@code from}/{@code to}. */
    public record FilterItem(String field, String op, String value, String from, String to) { }

    public record SortItem(String field, String dir) { }

    public record RowsQuery(Integer sheet, List<FilterItem> filters, SortItem sort, Integer offset) { }

    public record RowItem(String file, String sheet, Integer excelRow, Map<String, String> values) { }

    public record RowsPage(long total, int offset, int limit, List<RowItem> items) { }

    public record GroupsQuery(Integer sheet, List<FilterItem> filters, String groupBy) { }

    /** Группа; суммы — {@code BigDecimal.toPlainString()}. */
    public record GroupItem(String value, long count, Map<String, String> sums) { }

    public record TotalItem(long count, Map<String, String> sums) { }

    public record GroupsResult(int groupsTotal, int groupsShown, List<GroupItem> groups, TotalItem total) { }
}
