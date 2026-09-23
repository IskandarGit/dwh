package com.greenwhite.dwh.instance.upl.parse;

import java.util.List;
import java.util.Map;

/**
 * Итог разбора файла пакета, целиком в памяти: либо «проверен» со счётчиками строк,
 * либо «отклонён системой» с причиной. Записей об ошибках столько, сколько разрешено хранить,
 * а {@code errorsTotal} считает все найденные.
 */
public record UplParseResult(Outcome outcome, String rejectCode, Map<String, Object> rejectParams,
                             Integer rowsTotal, Integer rowsAccepted, Integer rowsRejected,
                             int errorsTotal, List<ErrorRecord> errors) {

    /** Исход разбора: файл проверен или отклонён системой. */
    public enum Outcome { VERIFIED, REJECTED }

    /** Запись об ошибке: {@code rowNo == null} — расхождение с анкетой, иначе ошибка ячейки. */
    public record ErrorRecord(String sheet, Integer rowNo, String columnName, String cellValue,
                              String code, Map<String, Object> params) {
    }

    /** Файл проверен: «принято» = всего − строк с ошибками. */
    public static UplParseResult verified(int total, int rejected, int errorsTotal, List<ErrorRecord> errors) {
        return new UplParseResult(Outcome.VERIFIED, null, null, total, total - rejected, rejected,
                errorsTotal, List.copyOf(errors));
    }

    /** Файл отклонён системой: счётчики строк не заполняются. */
    public static UplParseResult rejected(String code, Map<String, Object> params, int errorsTotal,
                                          List<ErrorRecord> errors) {
        return new UplParseResult(Outcome.REJECTED, code, Map.copyOf(params), null, null, null,
                errorsTotal, List.copyOf(errors));
    }
}
