package com.greenwhite.dwh.instance.fnd.units;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Результат пересчёта (13 инв.3): значение, единица и ссылка на коэффициент с датой, по которой он выбран.
 * Ссылка пуста только у тождества {@code convert(v, u, u, d)} — там коэффициент не нужен (доп.5).
 */
public record FndConversion(BigDecimal value, String unit, FndCoefficientRef coefficient, LocalDate date) {

    /** Ссылка на использованную версию коэффициента: её обязан сохранить вызывающий модуль. */
    public record FndCoefficientRef(long coefficientId, int version) {
    }
}
