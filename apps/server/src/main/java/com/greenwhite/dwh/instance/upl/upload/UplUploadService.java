package com.greenwhite.dwh.instance.upl.upload;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.jobs.FndJobRunner;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository.FileRecord;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.upl.UplLimits;
import com.greenwhite.dwh.instance.upl.UplPref;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import org.springframework.core.io.InputStreamSource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Приём файла: проверка полей, поиск анкеты на начало периода, укладка файла в хранилище каркаса
 * и запись пакета вместе с заданием на разбор (контракт И5, раздел 3 «Порядок приёма»).
 * Разбора в запросе нет: он идёт заданием очереди.
 */
@Service
public class UplUploadService {

    /** Сообщение ответа 422, когда поля запроса не прошли проверку. */
    public static final String UPL_PACKAGE_INVALID = "UPL_PACKAGE_INVALID";
    /** У источника нет опубликованной анкеты на дату начала периода. */
    public static final String UPL_PKG_NO_FORMAT_AT_DATE = "UPL_PKG_NO_FORMAT_AT_DATE";
    /** Файл больше предела приёма. */
    public static final String UPL_PKG_FILE_TOO_LARGE = "UPL_PKG_FILE_TOO_LARGE";

    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private final UplSourceService sources;
    private final FndVersioning versioning;
    private final MfFileService files;
    private final UplPackageService packages;
    private final FndJobRunner jobs;
    private final TransactionTemplate tx;

    public UplUploadService(UplSourceService sources, FndVersioning versioning, MfFileService files,
                            UplPackageService packages, FndJobRunner jobs, TransactionTemplate tx) {
        this.sources = sources;
        this.versioning = versioning;
        this.files = files;
        this.packages = packages;
        this.jobs = jobs;
        this.tx = tx;
    }

    /** Части запроса приёма как они пришли с формы; {@code content} — тело файла. */
    public record Upload(String sourceId, String periodFrom, String periodTo, boolean filePresent,
                         String fileName, String mimeType, long sizeBytes, InputStreamSource content) {
    }

    /**
     * Принимает файл и ставит его в очередь на разбор. Транзакции на весь приём нет намеренно:
     * файл кладётся в хранилище каркаса снаружи, а пакет и задание появляются одной транзакцией.
     */
    public PackageRow receive(Upload upload, long userId) {
        List<FieldErrorItem> errors = UplUploadValidator.validate(upload.sourceId(), upload.periodFrom(),
                upload.periodTo(), upload.filePresent(), upload.fileName(), upload.sizeBytes());
        if (!errors.isEmpty()) {
            throw ApiException.validation(UPL_PACKAGE_INVALID, errors);
        }
        long sourceId = Long.parseLong(upload.sourceId().strip());
        LocalDate periodFrom = LocalDate.parse(upload.periodFrom().strip());
        LocalDate periodTo = LocalDate.parse(upload.periodTo().strip());

        sources.getSource(sourceId);
        int formatVersion = versioning.versionAt(UplPref.TABLE_FORMAT_VERSIONS, sourceId, periodFrom)
                .orElseThrow(() -> ApiException.conflict(ErrorCode.CONFLICT, UPL_PKG_NO_FORMAT_AT_DATE));
        if (upload.sizeBytes() > UplLimits.MAX_FILE_BYTES) {
            throw ApiException.badRequest(ErrorCode.FILE_SIZE_EXCEEDED, UPL_PKG_FILE_TOO_LARGE);
        }

        FileRecord file = store(upload, userId);
        return tx.execute(status -> registerWithParseJob(sourceId, formatVersion, periodFrom, periodTo, file,
                userId));
    }

    /** Кладёт файл в хранилище каркаса; отказы хранилища уходят наверх как есть. */
    private FileRecord store(Upload upload, long userId) {
        String mimeType = upload.mimeType() == null || upload.mimeType().isBlank()
                ? XLSX_MIME
                : upload.mimeType();
        try (InputStream content = upload.content().getInputStream()) {
            return files.uploadFile(upload.fileName(), mimeType, content, upload.sizeBytes(), userId);
        } catch (IOException failure) {
            throw new UncheckedIOException("Тело загружаемого файла не читается", failure);
        }
    }

    /** Пакет и задание на его разбор появляются вместе или не появляются вовсе. */
    private PackageRow registerWithParseJob(long sourceId, int formatVersion, LocalDate periodFrom,
                                            LocalDate periodTo, FileRecord file, long userId) {
        PackageRow row = packages.register(new NewPackage(sourceId, formatVersion, periodFrom, periodTo,
                file.id(), file.originalName(), file.sha256(), file.sizeBytes(), userId));
        jobs.enqueueOnce(UplPref.JOB_PARSE, Map.of("packageId", row.publicId().toString()));
        return row;
    }
}
