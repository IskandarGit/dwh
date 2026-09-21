package com.greenwhite.dwh.instance.upl.parse;

import com.greenwhite.dwh.instance.fnd.jobs.FndJobHandler;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.upl.UplPref;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import com.greenwhite.dwh.spi.storage.FileDownloadStream;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import java.util.UUID;

/**
 * Задание «разобрать файл пакета»: берёт файл из хранилища каркаса, разбирает его по анкете,
 * действовавшей на начало периода, и записывает итог. Сбой самого разбора закрывает пакет
 * причиной {@link #UPL_PKG_INTERNAL} в отдельной транзакции — иначе откат задания вернул бы
 * пакет в «получен» и он висел бы вечно.
 */
@Component
public class UplParseJob implements FndJobHandler {

    /** Пакет отклонён: разбор упал по внутренней ошибке. */
    public static final String UPL_PKG_INTERNAL = "UPL_PKG_INTERNAL";

    private static final String ARG_PACKAGE_ID = "packageId";

    private final UplPackageService packages;
    private final UplSourceService sources;
    private final MfFileService files;
    private final UplXlsxParser parser;

    public UplParseJob(UplPackageService packages, UplSourceService sources, MfFileService files,
                       UplXlsxParser parser) {
        this.packages = packages;
        this.sources = sources;
        this.files = files;
        this.parser = parser;
    }

    @Override
    public String code() {
        return UplPref.JOB_PARSE;
    }

    @Override
    public void run(Map<String, Object> args) {
        UUID publicId = packageId(args);
        PackageRow row = packages.find(publicId)
                .orElseThrow(() -> new IllegalStateException("Пакет " + publicId + " не найден"));
        if (!UplPackageModel.RECEIVED.equals(row.status())) {
            return;
        }
        UplParseResult result = parse(row);
        packages.saveParseResult(row.id(), result);
    }

    /**
     * Читает анкету и разбирает файл пакета; любой сбой чтения анкеты, файла или разбора
     * закрывает пакет внутренней ошибкой.
     */
    private UplParseResult parse(PackageRow row) {
        try (FileDownloadStream file = files.downloadFile(row.fileId())) {
            FormatVersion format = sources.getVersion(row.sourceId(), row.formatVersion());
            return parser.parse(file.inputStream(), format);
        } catch (IOException failure) {
            packages.rejectInNewTransaction(row.id(), UPL_PKG_INTERNAL);
            throw new UncheckedIOException("Файл пакета " + row.publicId() + " не читается из хранилища", failure);
        } catch (RuntimeException failure) {
            packages.rejectInNewTransaction(row.id(), UPL_PKG_INTERNAL);
            throw failure;
        }
    }

    private static UUID packageId(Map<String, Object> args) {
        Object raw = args == null ? null : args.get(ARG_PACKAGE_ID);
        if (raw == null) {
            throw new IllegalStateException("В задании " + UplPref.JOB_PARSE + " нет аргумента " + ARG_PACKAGE_ID);
        }
        try {
            return UUID.fromString(raw.toString());
        } catch (IllegalArgumentException notUuid) {
            throw new IllegalStateException("Аргумент " + ARG_PACKAGE_ID + " задания " + UplPref.JOB_PARSE
                    + " не является идентификатором пакета", notUuid);
        }
    }
}
