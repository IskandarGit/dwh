package com.greenwhite.dwh.instance.ovw;

/** Пределы обзора данных (контракт И14): размер страницы, число групп и фильтров, время запроса. */
public final class OvwLimits {

    /** Строк на странице. */
    public static final int PAGE_SIZE = 200;
    /** Групп в ответе, больше — отрезаются. */
    public static final int MAX_GROUPS = 1000;
    /** Фильтров в одном запросе. */
    public static final int MAX_FILTERS = 20;
    /** Длина текста фильтра в символах. */
    public static final int MAX_FILTER_VALUE_LENGTH = 200;
    /** Цифр до и после точки в числовой границе фильтра. */
    public static final int MAX_NUMBER_DIGITS = 30;
    /**
     * Цифр до и после точки у числа группы: число ячейки (≤ 1000 цифр, экспонента ≤ 999) в едином виде
     * даёт не больше 2000; предел базы — 16 383 цифр дроби.
     */
    public static final int MAX_EQ_NUMBER_DIGITS = 2000;
    /** Лимит времени запроса ко второй базе, секунды. */
    public static final int QUERY_TIMEOUT_SECONDS = 10;

    private OvwLimits() {
    }
}
