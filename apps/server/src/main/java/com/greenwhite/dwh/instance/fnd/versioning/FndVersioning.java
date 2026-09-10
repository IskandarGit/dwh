package com.greenwhite.dwh.instance.fnd.versioning;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.FndSqlErrors;
import com.greenwhite.dwh.instance.fnd.error.StaleVersionException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Единственный механизм версий с датой действия для всех модулей DW (02 п.17; 18 п.14; AC-10…AC-17).
 * Модуль объявляет свою таблицу версий в миграции вызовом {@code fnd_versioning_enable}, а данные версии
 * (например {@code factor}) пишет своими колонками через {@link #updateDraft}.
 *
 * <p>Жизненный цикл: {@link #createDraft} (номер = max+1, один черновик на заголовок, доп.14) →
 * правки черновика → {@link #publish} (закрывает предыдущую версию) → при ошибке {@link #supersede}.
 * Опубликованную строку защищает триггер {@code deny_update_published()}.
 */
@Service
public class FndVersioning {

    /** Имя таблицы/колонки в динамическом SQL: только то, что мы сами создаём миграциями. */
    private static final Pattern IDENTIFIER = Pattern.compile("^[a-z][a-z0-9_]{0,62}$");

    private final JdbcClient jdbc;
    private final FndActors actors;
    /** table -&gt; колонка заголовка; реестр fnd_versioned_tables меняется только миграциями. */
    private final Map<String, String> headerColumns = new ConcurrentHashMap<>();

    public FndVersioning(JdbcClient jdbc, FndActors actors) {
        this.jdbc = jdbc;
        this.actors = actors;
    }

    /**
     * Создаёт черновик со следующим номером. {@code valid_from} черновика — заглушка (текущая дата):
     * колонка объявлена {@code not null}, а действующие даты задаёт публикация [допущение архитектора].
     *
     * @throws ConstraintViolationException {@code fnd_version_draft_exists} — черновик уже есть (доп.14)
     */
    @Transactional
    public int createDraft(String versionsTable, long headerId, FndActor actor) {
        String header = headerColumn(versionsTable);
        actors.apply(actor);
        Integer existing = jdbc.sql("select version from " + versionsTable
                        + " where " + header + " = :h and status = 'draft'")
                .param("h", headerId).query(Integer.class).optional().orElse(null);
        if (existing != null) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_DRAFT_EXISTS);
        }
        return FndSqlErrors.translating(() -> jdbc.sql("insert into " + versionsTable
                        + " (" + header + ", valid_from, status) values (:h, current_date, 'draft') returning version")
                .param("h", headerId).query(Integer.class).single());
    }

    /**
     * Публикует черновик: закрывает открытый конец предыдущей версии днём до {@code validFrom}
     * и переводит черновик в {@code published} (доп.2, доп.3).
     *
     * @throws ConstraintViolationException {@code fnd_version_unknown} — черновика с таким номером нет;
     *                                      {@code fnd_version_not_after_previous} — дата не позже предыдущей версии
     */
    @Transactional
    public void publish(String versionsTable, long headerId, int version,
                        LocalDate validFrom, LocalDate validTo, FndActor actor) {
        String header = headerColumn(versionsTable);
        actors.apply(actor);
        // Строка черновика берётся под блокировку: параллельный publish той же версии ждёт коммита
        // и видит уже published — отказ, а не «успех» с нулём обновлённых строк
        String status = jdbc.sql("select status from " + versionsTable
                        + " where " + header + " = :h and version = :v for update")
                .param("h", headerId).param("v", version).query(String.class).optional().orElse(null);
        if (!FndVersion.DRAFT.equals(status)) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_UNKNOWN);
        }
        // Порядок версий проверяет сервис, а не ограничение БД: при отказе предыдущая версия остаётся
        // нетронутой, а черновик — черновиком, потому что до этой точки не было ни одной записи (AC-12).
        Optional<FndVersion> previous = jdbc.sql("select " + header + " as header_id, version, valid_from, valid_to,"
                        + " status, published_at, published_by, lock_version from " + versionsTable
                        + " where " + header + " = :h and status = 'published' order by valid_from desc limit 1")
                .param("h", headerId).query(FndVersioning::mapVersion).optional();
        if (previous.isPresent() && !validFrom.isAfter(previous.get().validFrom())) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_NOT_AFTER_PREVIOUS);
        }
        int published = FndSqlErrors.translating(() -> {
            if (previous.isPresent() && previous.get().validTo() == null) {
                jdbc.sql("update " + versionsTable + " set valid_to = :to where " + header + " = :h and version = :v")
                        .param("to", validFrom.minusDays(1))
                        .param("h", headerId).param("v", previous.get().version()).update();
            }
            return jdbc.sql("update " + versionsTable + " set status = 'published', valid_from = :from,"
                            + " valid_to = :to, published_at = now(), published_by = :by"
                            + " where " + header + " = :h and version = :v and status = 'draft'")
                    .param("from", validFrom).param("to", validTo).param("by", actor.name())
                    .param("h", headerId).param("v", version).update();
        });
        if (published != 1) {
            // Черновик исчез между проверкой и обновлением: транзакция откатывается вместе с закрытием предыдущей
            throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_UNKNOWN);
        }
    }

    /** Снимает ошибочно опубликованную версию: интервал освобождается, строка остаётся историей (AC-17). */
    @Transactional
    public void supersede(String versionsTable, long headerId, int version, FndActor actor) {
        String header = headerColumn(versionsTable);
        actors.apply(actor);
        int updated = FndSqlErrors.translating(() -> jdbc.sql("update " + versionsTable
                        + " set status = 'superseded' where " + header + " = :h and version = :v"
                        + " and status = 'published'")
                .param("h", headerId).param("v", version).update());
        if (updated == 0) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_UNKNOWN);
        }
    }

    /**
     * Правит колонки черновика с оптимистической блокировкой (02 п.12; AC-16): {@code lock_version}
     * увеличивает триггер, поэтому клиент со старым значением получает {@link StaleVersionException}.
     */
    @Transactional
    public void updateDraft(String versionsTable, long headerId, int version, int expectedLockVersion,
                            Map<String, Object> columns, FndActor actor) {
        String header = headerColumn(versionsTable);
        if (columns.isEmpty()) {
            throw new IllegalArgumentException("Нечего обновлять: список колонок пуст");
        }
        Map<String, Object> checked = new LinkedHashMap<>();
        columns.forEach((column, value) -> {
            if (!IDENTIFIER.matcher(column).matches()) {
                throw new IllegalArgumentException("Недопустимое имя колонки: " + column);
            }
            checked.put(column, value);
        });
        actors.apply(actor);
        String assignments = String.join(", ", checked.keySet().stream().map(c -> c + " = :" + c).toList());
        JdbcClient.StatementSpec statement = jdbc.sql("update " + versionsTable + " set " + assignments
                        + " where " + header + " = :fnd_header and version = :fnd_version"
                        + " and lock_version = :fnd_lock and status = 'draft'")
                .param("fnd_header", headerId).param("fnd_version", version).param("fnd_lock", expectedLockVersion);
        for (Map.Entry<String, Object> column : checked.entrySet()) {
            statement = statement.param(column.getKey(), column.getValue());
        }
        JdbcClient.StatementSpec update = statement;
        int updated = FndSqlErrors.translating(update::update);
        if (updated == 0) {
            if (find(versionsTable, headerId, version).isEmpty()) {
                throw new ConstraintViolationException(ConstraintErrorCode.FND_VERSION_UNKNOWN);
            }
            throw new StaleVersionException();
        }
    }

    /** Номер версии, действующей на дату; черновики и снятые версии не участвуют (AC-11). */
    @Transactional(readOnly = true)
    public Optional<Integer> versionAt(String versionsTable, long headerId, LocalDate date) {
        headerColumn(versionsTable);
        return jdbc.sql("select fnd_version_at(cast(:t as regclass), :h, :d)")
                .param("t", versionsTable).param("h", headerId).param("d", date)
                .query(Integer.class).optional();
    }

    /** Строка версии как есть — для модулей и проверок. */
    @Transactional(readOnly = true)
    public Optional<FndVersion> find(String versionsTable, long headerId, int version) {
        String header = headerColumn(versionsTable);
        return jdbc.sql("select " + header + " as header_id, version, valid_from, valid_to, status,"
                        + " published_at, published_by, lock_version from " + versionsTable
                        + " where " + header + " = :h and version = :v")
                .param("h", headerId).param("v", version).query(FndVersioning::mapVersion).optional();
    }

    /** Колонка заголовка из реестра; заодно проверяет, что таблица объявлена стандартом (AC-10). */
    private String headerColumn(String versionsTable) {
        if (!IDENTIFIER.matcher(versionsTable).matches()) {
            throw new IllegalArgumentException("Недопустимое имя таблицы версий: " + versionsTable);
        }
        return headerColumns.computeIfAbsent(versionsTable, table -> jdbc
                .sql("select header_column from fnd_versioned_tables where table_name = :t")
                .param("t", table).query(String.class).optional()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Таблица " + table + " не объявлена через fnd_versioning_enable")));
    }

    private static FndVersion mapVersion(ResultSet rs, int rowNum) throws SQLException {
        Timestamp publishedAt = rs.getTimestamp("published_at");
        java.sql.Date validTo = rs.getDate("valid_to");
        return new FndVersion(rs.getLong("header_id"), rs.getInt("version"),
                rs.getDate("valid_from").toLocalDate(), validTo == null ? null : validTo.toLocalDate(),
                rs.getString("status"), publishedAt == null ? null : publishedAt.toInstant(),
                rs.getString("published_by"), rs.getInt("lock_version"));
    }
}
