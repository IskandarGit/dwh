package com.greenwhite.dwh.instance.upl.upload;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.core.pagination.CursorUtils;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.parse.UplParseResult;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.ErrorsView;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.NewPackage;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Пакеты загрузки: запись принятого файла, итог разбора и чтение списка с ошибками (контракт И5).
 * Кнопки «Применить» здесь нет — это следующий инкремент.
 */
@Service
public class UplPackageService {

    public static final String UPL_PKG_NOT_FOUND = "UPL_PKG_NOT_FOUND";

    private static final int MAX_LIMIT = 200;

    private final UplPackageRepository repo;
    private final FndActors actors;

    public UplPackageService(UplPackageRepository repo, FndActors actors) {
        this.repo = repo;
        this.actors = actors;
    }

    /**
     * Записывает принятый файл пакетом в статусе «получен». Присоединяется к транзакции вызывающего:
     * пакет и задание на его разбор появляются вместе или не появляются вовсе.
     */
    @Transactional
    public PackageRow register(NewPackage p) {
        FndActor actor = actors.user(p.uploadedById());
        actors.apply(actor);
        long id = repo.insert(p, actor.name());
        return repo.findById(id)
                .orElseThrow(() -> new IllegalStateException("Пакет " + id + " не найден сразу после записи"));
    }

    /** Пакет по идентификатору из API; строка не uuid или пакета нет — 404. */
    @Transactional(readOnly = true)
    public PackageRow get(String publicId) {
        return find(toUuid(publicId))
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, UPL_PKG_NOT_FOUND));
    }

    @Transactional(readOnly = true)
    public Optional<PackageRow> find(UUID publicId) {
        return repo.findByPublicId(publicId);
    }

    /** Ошибки пакета: сколько найдено всего и сохранённые записи по порядку. */
    @Transactional(readOnly = true)
    public ErrorsView errors(String publicId) {
        PackageRow row = get(publicId);
        int total = row.errorsTotal() == null ? 0 : row.errorsTotal();
        return new ErrorsView(total, repo.findErrors(row.id()));
    }

    /** Список пакетов от новых к старым; курсор несёт последний показанный id и общее число. */
    @Transactional(readOnly = true)
    public KeysetPage<PackageRow> list(int limit, String cursor) {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw invalidField("limit", UplSourceService.INVALID_LIMIT);
        }
        PageCursor decoded = decodeCursor(cursor);
        List<PackageRow> rows = repo.list(decoded == null ? null : decoded.lastId(), limit + 1);
        boolean hasMore = rows.size() > limit;
        List<PackageRow> page = rows.subList(0, Math.min(rows.size(), limit));
        long total = decoded == null ? repo.count() : decoded.total();
        String next = hasMore && !page.isEmpty()
                ? CursorUtils.encode(page.getLast().id() + "|" + total)
                : null;
        return KeysetPage.of(List.copyOf(page), next, hasMore, total);
    }

    /** Записывает итог разбора: статус, счётчики и первые сохранённые ошибки. */
    @Transactional
    public void saveParseResult(long id, UplParseResult result) {
        actors.apply(actors.system());
        int updated = result.outcome() == UplParseResult.Outcome.VERIFIED
                ? repo.markVerified(id, result.rowsTotal(), result.rowsAccepted(), result.rowsRejected(),
                        result.errorsTotal())
                : repo.markRejected(id, result.rejectCode(), result.rejectParams(), result.errorsTotal());
        if (updated == 0) {
            throw new IllegalStateException("Пакет " + id + " уже не в статусе «получен»");
        }
        repo.insertErrors(id, numbered(result.errors()));
    }

    /**
     * Отклоняет пакет в отдельной транзакции: вызывается из упавшего задания, чья транзакция будет откачена.
     * Пакет уже закрыт — не ошибка.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void rejectInNewTransaction(long id, String rejectCode) {
        actors.apply(actors.system());
        repo.markRejected(id, rejectCode, Map.of(), null);
    }

    private static List<ErrorRow> numbered(List<UplParseResult.ErrorRecord> errors) {
        List<ErrorRow> rows = new ArrayList<>(errors.size());
        int ordinal = 1;
        for (UplParseResult.ErrorRecord error : errors) {
            rows.add(new ErrorRow(ordinal, error.sheet(), error.rowNo(), error.columnName(), error.cellValue(),
                    error.code(), error.params()));
            ordinal++;
        }
        return rows;
    }

    private static UUID toUuid(String publicId) {
        if (publicId == null || publicId.isBlank()) {
            throw ApiException.notFound(ErrorCode.NOT_FOUND, UPL_PKG_NOT_FOUND);
        }
        try {
            return UUID.fromString(publicId);
        } catch (IllegalArgumentException notUuid) {
            throw ApiException.notFound(ErrorCode.NOT_FOUND, UPL_PKG_NOT_FOUND);
        }
    }

    private record PageCursor(long lastId, long total) {
    }

    private static PageCursor decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        String raw = CursorUtils.decode(cursor);
        int bar = raw == null ? -1 : raw.lastIndexOf('|');
        if (bar <= 0) {
            throw invalidField("cursor", UplSourceService.INVALID_CURSOR);
        }
        try {
            return new PageCursor(Long.parseLong(raw.substring(0, bar)), Long.parseLong(raw.substring(bar + 1)));
        } catch (NumberFormatException notNumber) {
            throw invalidField("cursor", UplSourceService.INVALID_CURSOR);
        }
    }

    private static ApiException invalidField(String field, String code) {
        return ApiException.validation(code, List.of(new FieldErrorItem(field, code, code)));
    }
}
