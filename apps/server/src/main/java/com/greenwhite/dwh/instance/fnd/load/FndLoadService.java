package com.greenwhite.dwh.instance.fnd.load;

import com.greenwhite.dwh.instance.fnd.FndActor;
import com.greenwhite.dwh.instance.fnd.FndActors;
import com.greenwhite.dwh.instance.fnd.error.ConstraintErrorCode;
import com.greenwhite.dwh.instance.fnd.error.ConstraintViolationException;
import com.greenwhite.dwh.instance.fnd.error.FndSqlErrors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Версии загрузок и журнал пакета (11 п.6, п.8; 18 п.14; AC-25…AC-32).
 *
 * <p>Протокол применения: {@link #begin} создаёт версию в {@code pending} → строки пишутся фасадом
 * {@code FndRawWriter} в pg-dwh под этим {@code load_id} → {@link #apply} переводит версию в
 * {@code applied} и снимает предыдущую загрузку того же источника за тот же период. Сбой —
 * {@link #fail}: строки остаются, их удаляет задание обслуживания {@code fnd.load_cleanup}.
 * Допустимые переходы: {@code pending→applied}, {@code pending→failed}, {@code applied→superseded}.
 */
@Service
public class FndLoadService {

    private final JdbcClient jdbc;
    private final FndActors actors;

    public FndLoadService(JdbcClient jdbc, FndActors actors) {
        this.jdbc = jdbc;
        this.actors = actors;
    }

    /** Открывает версию загрузки. Повторный {@code package_ref} — отказ {@code fnd_loads_uk_package_ref}. */
    @Transactional
    public long begin(String sourceCode, UUID packageRef, LocalDate periodFrom, LocalDate periodTo,
                      String formatVersion, FndActor actor) {
        actors.apply(actor);
        return FndSqlErrors.translating(() -> jdbc.sql("""
                        insert into fnd_loads (source_code, package_ref, period_from, period_to,
                                               format_version, status)
                        values (:source, :package, :from, :to, :format, 'pending')
                        returning id
                        """)
                .param("source", sourceCode).param("package", packageRef)
                .param("from", periodFrom).param("to", periodTo)
                .param("format", formatVersion)
                .query(Long.class).single());
    }

    /**
     * Применяет загрузку: счётчики строк должны сходиться ({@code accepted + rejected = total}),
     * иначе отказ ограничения {@code fnd_loads_ck_rows}. Предыдущая применённая загрузка того же
     * источника за тот же период получает {@code superseded} и ссылку {@code superseded_by} (AC-28, доп.7).
     */
    @Transactional
    public void apply(long loadId, int rowsTotal, int rowsAccepted, int rowsRejected, FndActor actor) {
        FndLoad load = lockPending(loadId);
        actors.apply(actor);
        int updated = FndSqlErrors.translating(() -> jdbc.sql("""
                        update fnd_loads
                           set status = 'applied', applied_at = now(), applied_by = :actor,
                               rows_total = :total, rows_accepted = :accepted, rows_rejected = :rejected
                         where id = :id and status = 'pending'
                        """)
                .param("actor", actor.name()).param("total", rowsTotal)
                .param("accepted", rowsAccepted).param("rejected", rowsRejected)
                .param("id", loadId).update());
        requireUpdated(updated);
        FndSqlErrors.translating(() -> jdbc.sql("""
                        update fnd_loads
                           set status = 'superseded', superseded_by = :id
                         where id <> :id and status = 'applied'
                           and source_code = :source and period_from = :from and period_to = :to
                        """)
                .param("id", loadId).param("source", load.sourceCode())
                .param("from", load.periodFrom()).param("to", load.periodTo()).update());
    }

    /** Отмечает загрузку неудачной и пишет причину в журнал; без причины — отказ (AC-26). */
    @Transactional
    public void fail(long loadId, String reason, FndActor actor) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("Причина сбоя не задана: загрузка без причины не отмечается");
        }
        FndLoad load = lockPending(loadId);
        actors.apply(actor);
        int updated = FndSqlErrors.translating(() -> jdbc.sql("update fnd_loads set status = 'failed'"
                        + " where id = :id and status = 'pending'")
                .param("id", loadId).update());
        requireUpdated(updated);
        log(load.packageRef(), "failed", FndLoad.PENDING, FndLoad.FAILED, actor, reason, null);
    }

    /**
     * Строка журнала пакета (AC-29). {@code load_id} проставляется, когда версия загрузки уже
     * применена; до этого события журнал ведётся по {@code package_ref}. Правка и удаление строк
     * запрещены триггером {@code fnd_load_log_append_only()}.
     */
    @Transactional
    public void log(UUID packageRef, String event, String fromStatus, String toStatus,
                    FndActor actor, String note, String fileSha) {
        if (actor == null) {
            throw new ConstraintViolationException(ConstraintErrorCode.AUDIT_ACTOR_MISSING);
        }
        actors.apply(actor);
        Long loadId = jdbc.sql("select id from fnd_loads where package_ref = :package"
                        + " and status in ('applied', 'superseded')")
                .param("package", packageRef).query(Long.class).optional().orElse(null);
        FndSqlErrors.translating(() -> jdbc.sql("""
                        insert into fnd_load_log (package_ref, load_id, event, from_status, to_status,
                                                  actor, note, file_sha)
                        values (:package, :load, :event, :from, :to, :actor, :note, :sha)
                        """)
                .param("package", packageRef).param("load", loadId).param("event", event)
                .param("from", fromStatus).param("to", toStatus)
                .param("actor", actor.name())
                .param("note", note).param("sha", fileSha).update());
    }

    /** Действующие версии данных источника: только применённые загрузки (11 п.10). */
    @Transactional(readOnly = true)
    public List<Long> appliedLoadIds(String sourceCode) {
        return jdbc.sql("select id from fnd_loads where source_code = :source and status = 'applied' order by id")
                .param("source", sourceCode).query(Long.class).list();
    }

    @Transactional(readOnly = true)
    public Optional<FndLoad> find(long loadId) {
        return jdbc.sql("select id, source_code, package_ref, period_from, period_to, format_version,"
                        + " applied_at, applied_by, rows_total, rows_accepted, rows_rejected, status, superseded_by"
                        + " from fnd_loads where id = :id")
                .param("id", loadId).query(FndLoadService::mapLoad).optional();
    }

    /**
     * Читает загрузку под блокировкой строки ({@code for update}) и требует статус {@code pending}.
     * Параллельный {@code apply}/{@code fail} той же загрузки ждёт коммита и видит уже новый статус;
     * незавершённая запись строк ({@code FndRawWriter.write} держит {@code for share}) тоже дожидается конца.
     */
    private FndLoad lockPending(long loadId) {
        FndLoad load = jdbc.sql("select id, source_code, package_ref, period_from, period_to, format_version,"
                        + " applied_at, applied_by, rows_total, rows_accepted, rows_rejected, status, superseded_by"
                        + " from fnd_loads where id = :id for update")
                .param("id", loadId).query(FndLoadService::mapLoad).optional()
                .orElseThrow(() -> new ConstraintViolationException(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION));
        if (!FndLoad.PENDING.equals(load.status())) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);
        }
        return load;
    }

    /** Переход статуса выполняется одним UPDATE с условием на текущий статус: 0 строк — состояние уже ушло. */
    private static void requireUpdated(int updated) {
        if (updated != 1) {
            throw new ConstraintViolationException(ConstraintErrorCode.FND_LOAD_STATUS_TRANSITION);
        }
    }

    private static FndLoad mapLoad(ResultSet rs, int rowNum) throws SQLException {
        Timestamp appliedAt = rs.getTimestamp("applied_at");
        Number supersededBy = (Number) rs.getObject("superseded_by");
        return new FndLoad(rs.getLong("id"), rs.getString("source_code"),
                rs.getObject("package_ref", UUID.class),
                rs.getDate("period_from").toLocalDate(), rs.getDate("period_to").toLocalDate(),
                rs.getString("format_version"), appliedAt == null ? null : appliedAt.toInstant(),
                rs.getString("applied_by"), integer(rs, "rows_total"), integer(rs, "rows_accepted"),
                integer(rs, "rows_rejected"), rs.getString("status"),
                supersededBy == null ? null : supersededBy.longValue());
    }

    private static Integer integer(ResultSet rs, String column) throws SQLException {
        Number value = (Number) rs.getObject(column);
        return value == null ? null : value.intValue();
    }
}
