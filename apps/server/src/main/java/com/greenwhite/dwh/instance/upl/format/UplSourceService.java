package com.greenwhite.dwh.instance.upl.format;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.core.pagination.CursorUtils;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.FndSqlErrors;
import com.greenwhite.dwh.instance.fnd.error.StaleVersionException;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersion;
import com.greenwhite.dwh.instance.fnd.versioning.FndVersioning;
import com.greenwhite.dwh.instance.upl.UplPref;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FormatVersion;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Source;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceSummary;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Strictness;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Анкета файла: источник, черновик, публикация с проверками, чтение версий (контракт И3). */
@Service
public class UplSourceService {

    public static final String UPL_SOURCE_NOT_FOUND = "UPL_SOURCE_NOT_FOUND";
    public static final String UPL_SOURCE_CODE_TAKEN = "UPL_SOURCE_CODE_TAKEN";
    public static final String UPL_SOURCE_CODE_IMMUTABLE = "UPL_SOURCE_CODE_IMMUTABLE";
    public static final String UPL_FORMAT_NOT_DRAFT = "UPL_FORMAT_NOT_DRAFT";
    public static final String UPL_FORMAT_INVALID = "UPL_FORMAT_INVALID";
    public static final String STALE_VERSION = "STALE_VERSION";
    public static final String FND_VERSION_UNKNOWN = "FND_VERSION_UNKNOWN";
    public static final String FND_VERSION_DRAFT_EXISTS = "FND_VERSION_DRAFT_EXISTS";
    public static final String FND_VERSION_NOT_AFTER_PREVIOUS = "FND_VERSION_NOT_AFTER_PREVIOUS";
    public static final String INVALID_LIMIT = "INVALID_LIMIT";
    public static final String INVALID_CURSOR = "INVALID_CURSOR";
    public static final String VALID_FROM_REQUIRED = "VALID_FROM_REQUIRED";

    private static final String TABLE = UplPref.TABLE_FORMAT_VERSIONS;
    private static final String CODE_UNIQUE_INDEX = "upl_sources_code_uidx";
    private static final String NOT_DRAFT_DB_ERROR = "upl_format_not_draft";
    private static final int MAX_LIMIT = 200;

    private final UplFormatRepository repo;
    private final UplFormatValidator validator;
    private final FndVersioning versioning;
    private final FndActors actors;

    public UplSourceService(UplFormatRepository repo, UplFormatValidator validator,
                            FndVersioning versioning, FndActors actors) {
        this.repo = repo;
        this.validator = validator;
        this.versioning = versioning;
        this.actors = actors;
    }

    public record SourceView(Source source, Integer lastPublishedVersion, boolean hasDraft) {
    }

    public record DraftData(FileKind fileKind, String encoding, String delimiter, MatchBy matchColumnsBy,
                            List<Sheet> sheets) {
    }

    @Transactional
    public SourceView createSource(SourceData d, long userId) {
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        SourceData data = new SourceData(d.code(), d.name(), d.ownerOrg(), d.ownerContact(), d.periodicity(),
                d.slaDays(), d.sourceType() == null ? SourceType.FILE : d.sourceType(),
                d.strictness() == null ? Strictness.ERROR : d.strictness());
        long id;
        try {
            id = repo.insertSource(data, actor.name());
        } catch (DataIntegrityViolationException e) {
            if (chainContains(e, CODE_UNIQUE_INDEX)) {
                throw ApiException.badRequest(ErrorCode.CODE_ALREADY_EXISTS, UPL_SOURCE_CODE_TAKEN);
            }
            throw toApi(e);
        }
        return view(id);
    }

    @Transactional
    public SourceView updateSource(long id, int lockVersion, SourceData d, long userId) {
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        Source current = requireSource(id);
        if (d.code() != null && !d.code().equals(current.code())) {
            throw ApiException.validation(UPL_SOURCE_CODE_IMMUTABLE, List.of(
                    new FieldErrorItem("code", UPL_SOURCE_CODE_IMMUTABLE, UPL_SOURCE_CODE_IMMUTABLE)));
        }
        SourceData data = new SourceData(current.code(), d.name(), d.ownerOrg(), d.ownerContact(),
                d.periodicity(), d.slaDays(),
                d.sourceType() == null ? current.sourceType() : d.sourceType(),
                d.strictness() == null ? current.strictness() : d.strictness());
        int updated;
        try {
            updated = repo.updateSource(id, lockVersion, data, actor.name());
        } catch (DataAccessException e) {
            throw toApi(e);
        }
        if (updated == 0) {
            throw ApiException.conflict(ErrorCode.CONFLICT, STALE_VERSION);
        }
        return view(id);
    }

    @Transactional(readOnly = true)
    public SourceView getSource(long id) {
        return view(id);
    }

    @Transactional(readOnly = true)
    public KeysetPage<SourceSummary> listSources(int limit, String cursor) {
        if (limit < 1 || limit > MAX_LIMIT) {
            throw invalidField("limit", INVALID_LIMIT);
        }
        PageCursor decoded = decodeCursor(cursor);
        List<SourceSummary> rows = repo.listSources(decoded == null ? null : decoded.lastCode(), limit + 1);
        boolean hasMore = rows.size() > limit;
        List<SourceSummary> page = rows.subList(0, Math.min(rows.size(), limit));
        long total = decoded == null ? repo.countSources() : decoded.total();
        String next = hasMore && !page.isEmpty()
                ? CursorUtils.encode(page.getLast().code() + "|" + total)
                : null;
        return KeysetPage.of(List.copyOf(page), next, hasMore, total);
    }

    @Transactional(readOnly = true)
    public List<FormatVersion> listVersions(long sourceId) {
        requireSource(sourceId);
        return repo.listVersions(sourceId);
    }

    @Transactional(readOnly = true)
    public FormatVersion getVersion(long sourceId, int version) {
        return repo.findVersion(sourceId, version)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, FND_VERSION_UNKNOWN));
    }

    @Transactional(readOnly = true)
    public FormatVersion versionAt(long sourceId, LocalDate at) {
        int version = versioning.versionAt(TABLE, sourceId, at)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, FND_VERSION_UNKNOWN));
        return getVersion(sourceId, version);
    }

    @Transactional
    public FormatVersion createDraft(long sourceId, Integer copyFrom, long userId) {
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        requireSource(sourceId);
        FormatVersion copy = copyFrom == null ? null : getVersion(sourceId, copyFrom);
        int version;
        try {
            version = FndSqlErrors.translatingVersions(TABLE, () -> versioning.createDraft(TABLE, sourceId, actor));
            if (copy != null) {
                int lock = getVersion(sourceId, version).lockVersion();
                versioning.updateDraft(TABLE, sourceId, version, lock, fileColumns(copy.fileKind(),
                        copy.encoding(), copy.delimiter(), copy.matchColumnsBy()), actor);
                repo.replaceSheets(sourceId, version, copy.sheets());
            }
        } catch (ConstraintViolationException | DataAccessException e) {
            throw toApi(e);
        }
        return getVersion(sourceId, version);
    }

    @Transactional
    public FormatVersion replaceDraft(long sourceId, int version, int lockVersion, DraftData d, long userId) {
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        requireDraft(getVersion(sourceId, version));
        FileKind kind = d.fileKind() == null ? FileKind.XLSX : d.fileKind();
        MatchBy match = d.matchColumnsBy() == null ? MatchBy.HEADER : d.matchColumnsBy();
        try {
            versioning.updateDraft(TABLE, sourceId, version, lockVersion,
                    fileColumns(kind, d.encoding(), d.delimiter(), match), actor);
            repo.replaceSheets(sourceId, version, d.sheets() == null ? List.of() : d.sheets());
        } catch (ConstraintViolationException | DataAccessException e) {
            throw toApi(e);
        }
        return getVersion(sourceId, version);
    }

    @Transactional
    public void publish(long sourceId, int version, LocalDate validFrom, long userId) {
        FndActor actor = actors.user(userId);
        actors.apply(actor);
        if (validFrom == null) {
            throw invalidField("validFrom", VALID_FROM_REQUIRED);
        }
        FormatVersion draft = getVersion(sourceId, version);
        requireDraft(draft);
        List<FieldErrorItem> errors = validator.validate(draft);
        if (!errors.isEmpty()) {
            throw ApiException.validation(UPL_FORMAT_INVALID, errors);
        }
        try {
            versioning.publish(TABLE, sourceId, version, validFrom, null, actor);
        } catch (ConstraintViolationException | DataAccessException e) {
            throw toApi(e);
        }
    }

    private SourceView view(long id) {
        Source source = requireSource(id);
        SourceSummary summary = repo.findSummary(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, UPL_SOURCE_NOT_FOUND));
        return new SourceView(source, summary.lastPublishedVersion(), summary.hasDraft());
    }

    private Source requireSource(long id) {
        return repo.findSource(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, UPL_SOURCE_NOT_FOUND));
    }

    private static void requireDraft(FormatVersion v) {
        if (!FndVersion.DRAFT.equals(v.status())) {
            throw ApiException.conflict(ErrorCode.CONFLICT, UPL_FORMAT_NOT_DRAFT);
        }
    }

    private static Map<String, Object> fileColumns(FileKind kind, String encoding, String delimiter, MatchBy match) {
        Map<String, Object> columns = new HashMap<>();
        columns.put("file_kind", kind.db());
        columns.put("encoding", encoding);
        columns.put("delimiter", delimiter);
        columns.put("match_columns_by", match.db());
        return columns;
    }

    private record PageCursor(String lastCode, long total) {
    }

    private static PageCursor decodeCursor(String cursor) {
        if (cursor == null) {
            return null;
        }
        String raw = CursorUtils.decode(cursor);
        int bar = raw == null ? -1 : raw.lastIndexOf('|');
        if (bar <= 0) {
            throw invalidField("cursor", INVALID_CURSOR);
        }
        try {
            return new PageCursor(raw.substring(0, bar), Long.parseLong(raw.substring(bar + 1)));
        } catch (NumberFormatException e) {
            throw invalidField("cursor", INVALID_CURSOR);
        }
    }

    private static ApiException invalidField(String field, String code) {
        return ApiException.validation(code, List.of(new FieldErrorItem(field, code, code)));
    }

    /** Перевод ошибок основы и БД в ответ API по таблице «Ошибки» контракта; незнакомое — как есть. */
    private static RuntimeException toApi(RuntimeException e) {
        if (e instanceof StaleVersionException) {
            return ApiException.conflict(ErrorCode.CONFLICT, STALE_VERSION);
        }
        if (e instanceof ConstraintViolationException cve) {
            ConstraintErrorCode code = cve.code();
            if (code == ConstraintErrorCode.FND_VERSION_DRAFT_EXISTS) {
                return ApiException.conflict(ErrorCode.CONFLICT, FND_VERSION_DRAFT_EXISTS);
            }
            if (code == ConstraintErrorCode.FND_VERSION_NOT_AFTER_PREVIOUS) {
                return ApiException.conflict(ErrorCode.CONFLICT, FND_VERSION_NOT_AFTER_PREVIOUS);
            }
            if (code == ConstraintErrorCode.FND_VERSION_UNKNOWN) {
                return ApiException.notFound(ErrorCode.NOT_FOUND, FND_VERSION_UNKNOWN);
            }
            return e;
        }
        if (e instanceof DataAccessException && chainContains(e, NOT_DRAFT_DB_ERROR)) {
            return ApiException.conflict(ErrorCode.CONFLICT, UPL_FORMAT_NOT_DRAFT);
        }
        return e;
    }

    private static boolean chainContains(Throwable e, String text) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(text)) {
                return true;
            }
        }
        return false;
    }
}
