package com.greenwhite.dwh.instance.fnd.dwh;

import java.util.Map;

/**
 * Строка файла, как она прочитана (11 п.6–7; AC-33): адрес в источнике (лист и номер строки) плюс
 * поля без типизации. Ядро не знает состава полей — это данные экземпляра.
 *
 * @param rowNo       номер строки в пределах загрузки (порядок записи)
 * @param sheet       лист источника, если он был
 * @param sourceRowNo номер строки в самом файле
 * @param fields      поля строки как есть
 */
public record FndRawRow(long rowNo, String sheet, Integer sourceRowNo, Map<String, Object> fields) {
}
