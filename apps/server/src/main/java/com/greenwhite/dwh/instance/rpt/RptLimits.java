package com.greenwhite.dwh.instance.rpt;

import java.util.Set;

/** Пределы сводного отчёта (контракт И15а, раздел 5): строк в отчёте, строк на странице, длина названия, пары ключа. */
public final class RptLimits {

    /** Строк уровня 1 и уровня 2 вместе; больше — отчёт не показывается. */
    public static final int MAX_LINES = 2000;
    /** Строк ячейки на странице. */
    public static final int PAGE_SIZE = 200;
    /** Длина названия отчёта в символах. */
    public static final int MAX_NAME_LENGTH = 200;
    /** Пар колонок связи со справочником. */
    public static final int MAX_KEYS = 2;
    /** Допустимые делители отображения: единицы, тысячи, миллионы. */
    public static final Set<Integer> DIVISORS = Set.of(1, 1000, 1000000);
    /** Наибольшее число знаков после запятой на экране. */
    public static final int MAX_DECIMALS = 3;

    private RptLimits() {
    }
}
