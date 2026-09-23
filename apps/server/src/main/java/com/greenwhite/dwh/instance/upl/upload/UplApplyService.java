package com.greenwhite.dwh.instance.upl.upload;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawRow;
import com.greenwhite.dwh.instance.fnd.dwh.FndRawWriter;
import com.greenwhite.dwh.instance.fnd.load.FndLoadService;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult;
import com.greenwhite.dwh.instance.upl.parse.UplXlsxParser;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.spi.storage.FileDownloadStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Применение пакета «проверен» (контракт И6, раздел 6): три шага, потому что raw лежит во второй базе —
 * сбой её записи должен стать причиной пакета, а не ответом 500.
 */
@Service
public class UplApplyService {

    /** Применить можно только пакет «проверен», ещё не получивший номер загрузки. */
    public static final String UPL_PKG_NOT_VERIFIED = "UPL_PKG_NOT_VERIFIED";
    /** В пакете «проверен» нет ни одной принятой строки — применять нечего. */
    public static final String UPL_PKG_NOTHING_TO_APPLY = "UPL_PKG_NOTHING_TO_APPLY";
    /** Строк в raw не столько, сколько в пакете, или счётчики пакета не сходятся. */
    public static final String UPL_PKG_RECONCILIATION = "UPL_PKG_RECONCILIATION";
    /** Строки пакета не записаны в raw. */
    public static final String UPL_PKG_RAW_WRITE_FAILED = "UPL_PKG_RAW_WRITE_FAILED";

    private static final Logger log = LoggerFactory.getLogger(UplApplyService.class);

    private final UplPackageService packages;
    private final UplPackageRepository repo;
    private final UplSourceService sources;
    private final MfFileService files;
    private final UplXlsxParser parser;
    private final FndLoadService loads;
    private final FndRawWriter raw;
    private final FndActors actors;
    private final TransactionTemplate tx;

    public UplApplyService(UplPackageService packages, UplPackageRepository repo, UplSourceService sources,
                           MfFileService files, UplXlsxParser parser, FndLoadService loads, FndRawWriter raw,
                           FndActors actors, TransactionTemplate tx) {
        this.packages = packages;
        this.repo = repo;
        this.sources = sources;
        this.files = files;
        this.parser = parser;
        this.loads = loads;
        this.raw = raw;
        this.actors = actors;
        this.tx = tx;
    }

    /**
     * Применяет пакет: открывает загрузку основы, пишет строки файла в raw и по сверке закрывает пакет
     * «применён» или «отклонён системой». Не «проверен» — 409, нет принятых строк — 409, нет пакета — 404.
     */
    public PackageRow apply(String publicId, long userId) {
        UUID id = packages.get(publicId).publicId();
        FndActor actor = actors.user(userId);
        Started started = tx.execute(status -> begin(id, actor));
        Integer rawRows = writeRaw(started);
        tx.executeWithoutResult(status -> finish(started, rawRows, actor));
        return repo.findById(started.row().id())
                .orElseThrow(() -> new IllegalStateException("Пакет " + id + " пропал во время применения"));
    }

    private record Started(PackageRow row, long loadId) {
    }

    private Started begin(UUID id, FndActor actor) {
        PackageRow row = repo.lockByPublicId(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, UplPackageService.UPL_PKG_NOT_FOUND));
        if (!UplPackageModel.VERIFIED.equals(row.status()) || row.loadId() != null) {
            throw ApiException.conflict(ErrorCode.CONFLICT, UPL_PKG_NOT_VERIFIED);
        }
        if (row.rowsAccepted() == null || row.rowsAccepted() == 0) {
            throw ApiException.conflict(ErrorCode.CONFLICT, UPL_PKG_NOTHING_TO_APPLY);
        }
        long loadId = loads.begin(row.sourceCode(), row.publicId(), row.periodFrom(), row.periodTo(),
                String.valueOf(row.formatVersion()), actor);
        actors.apply(actor);
        requireOne(repo.setLoadId(row.id(), loadId), row);
        return new Started(row, loadId);
    }

    /** Пишет строки файла в raw; {@code null} — запись упала, причина уйдёт в пакет. */
    private Integer writeRaw(Started started) {
        try {
            raw.write(started.loadId(), started.row().fileId(), readRows(started.row()));
            return raw.read(started.loadId()).size();
        } catch (IOException | RuntimeException failure) {
            log.error("Пакет {}: строки не записаны в raw ({})", started.row().publicId(),
                    failure.getClass().getName());
            return null;
        }
    }

    private List<FndRawRow> readRows(PackageRow row) throws IOException {
        try (FileDownloadStream file = files.downloadFile(row.fileId())) {
            FormatVersion format = sources.getVersion(row.sourceId(), row.formatVersion());
            List<FndRawRow> rows = new ArrayList<>();
            UplParseResult result = parser.parse(file.inputStream(), format,
                    data -> rows.add(new FndRawRow(rows.size() + 1, data.sheet(), data.sourceRowNo(), data.fields())));
            if (result.outcome() != UplParseResult.Outcome.VERIFIED) {
                throw new IllegalStateException("Повторный разбор файла пакета " + row.publicId()
                        + " не дал «проверен»");
            }
            return rows;
        }
    }

    private void finish(Started started, Integer rawRows, FndActor actor) {
        PackageRow row = started.row();
        actors.apply(actor);
        boolean reconciled = rawRows != null && rawRows.intValue() == row.rowsTotal()
                && row.rowsTotal() == row.rowsAccepted() + row.rowsRejected();
        if (reconciled) {
            loads.apply(started.loadId(), row.rowsTotal(), row.rowsAccepted(), row.rowsRejected(), actor);
            requireOne(repo.markApplied(row.id(), rawRows), row);
            loads.log(row.publicId(), "applied", UplPackageModel.VERIFIED, UplPackageModel.APPLIED, actor, null,
                    row.fileSha256());
        } else if (rawRows == null) {
            loads.fail(started.loadId(), UPL_PKG_RAW_WRITE_FAILED, actor);
            requireOne(repo.markApplyRejected(row.id(), UPL_PKG_RAW_WRITE_FAILED, Map.of(), null), row);
        } else {
            loads.fail(started.loadId(), UPL_PKG_RECONCILIATION + ": в файле " + row.rowsTotal() + ", в raw " + rawRows,
                    actor);
            requireOne(repo.markApplyRejected(row.id(), UPL_PKG_RECONCILIATION,
                    Map.of("fileRows", row.rowsTotal(), "rawRows", rawRows), rawRows), row);
        }
    }

    private static void requireOne(int updated, PackageRow row) {
        if (updated != 1) {
            throw new IllegalStateException("Пакет " + row.publicId() + " уже не в статусе «проверен»");
        }
    }
}
