package com.greenwhite.dwh.instance.fnd.units;

import java.time.LocalDate;

/**
 * Коэффициента на дату нет (13 инв.3; AC-21): пересчёт не выполняется и значение не возвращается
 * ни в каком виде — «значение по памяти» запрещено. Обратный коэффициент и цепочки не выводятся (доп.5).
 */
public class FndCoefficientMissingException extends RuntimeException {

    private final String fromUnit;
    private final String toUnit;
    private final LocalDate date;

    public FndCoefficientMissingException(String fromUnit, String toUnit, LocalDate date) {
        super("fnd_coefficient_missing: " + fromUnit + " -> " + toUnit + " на " + date);
        this.fromUnit = fromUnit;
        this.toUnit = toUnit;
        this.date = date;
    }

    public String fromUnit() {
        return fromUnit;
    }

    public String toUnit() {
        return toUnit;
    }

    public LocalDate date() {
        return date;
    }
}
