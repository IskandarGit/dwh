package com.greenwhite.dwh.instance.fnd.dwh;

import java.util.List;
import java.util.UUID;

/**
 * Единственный вход в слой {@code raw} второй базы (11 п.6–7; 18 п.14; AC-33, AC-34).
 * Методов правки и удаления у фасада нет: {@code raw} неизменяем, новая версия данных — новая
 * загрузка (13 инв.4). Удаление строк неудачной загрузки — дело задания {@code fnd.load_cleanup}.
 */
public interface FndRawWriter {

    /**
     * Пишет строки одной загрузки одной транзакцией: либо все, либо ни одной (AC-34).
     *
     * @param loadId       версия загрузки в статусе {@code pending}; иначе отказ
     * @param sourceFileId файл каркаса ({@code mf_files.id}), из которого прочитаны строки
     * @param rows         строки как прочитаны; исключение источника доходит до вызывающего
     */
    void write(long loadId, UUID sourceFileId, Iterable<FndRawRow> rows);

    /** Строки загрузки как записаны — без типизации и изменений (AC-33). */
    List<FndRawRow> read(long loadId);
}
