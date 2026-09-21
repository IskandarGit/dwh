package com.greenwhite.dwh.instance.upl.upload;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Пакет загрузки и его ошибки, как они лежат в таблицах {@code upl_packages} и {@code upl_package_errors} (V114). */
public final class UplPackageModel {

    /** Файл принят и ждёт разбора заданием. */
    public static final String RECEIVED = "received";
    /** Файл отклонён системой: разбор не дал строк, причина — в {@code rejectCode}. */
    public static final String REJECTED = "rejected";
    /** Файл разобран: счётчики строк заполнены, ошибки ячеек сохранены. */
    public static final String VERIFIED = "verified";
    /** Проверенный пакет применён загрузкой основы (следующий инкремент). */
    public static final String APPLIED = "applied";

    private UplPackageModel() {
    }

    /** Строка пакета вместе с кодом и названием источника. */
    public record PackageRow(long id, UUID publicId, long sourceId, String sourceCode, String sourceName,
                             int formatVersion, LocalDate periodFrom, LocalDate periodTo, UUID fileId,
                             String fileName, String fileSha256, long fileSizeBytes, String status,
                             Integer rowsTotal, Integer rowsAccepted, Integer rowsRejected, Integer errorsTotal,
                             String rejectCode, Map<String, Object> rejectParams, Long loadId, Integer rawRows,
                             Instant uploadedAt, String uploadedBy) {
    }

    /** Данные нового пакета: всё, что известно в момент приёма файла. */
    public record NewPackage(long sourceId, int formatVersion, LocalDate periodFrom, LocalDate periodTo,
                             UUID fileId, String fileName, String fileSha256, long fileSizeBytes, long uploadedById) {
    }

    /** Запись об ошибке пакета: {@code rowNo == null} — расхождение с анкетой, иначе ошибка ячейки. */
    public record ErrorRow(int ordinal, String sheet, Integer rowNo, String columnName, String cellValue,
                           String code, Map<String, Object> params) {
    }

    /** Ошибки пакета: сколько найдено всего и что сохранено. */
    public record ErrorsView(int total, List<ErrorRow> items) {
    }
}
