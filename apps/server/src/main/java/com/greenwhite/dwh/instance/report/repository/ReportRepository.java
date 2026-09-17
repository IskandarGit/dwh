package com.greenwhite.dwh.instance.report.repository;

import com.greenwhite.dwh.instance.common.security.ScopeFilter;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.function.Consumer;

@Repository
public class ReportRepository {

    private final JdbcClient jdbcClient;

    public ReportRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public record TaskExportRow(
            long id,
            String title,
            String projectName,
            String priority,
            String statusName,
            Instant endTime,
            Instant createdAt,
            String reporterName
    ) {}

    public static final int DEFAULT_MAX_EXPORT_ROWS = 50_000;

    public void streamScopedTasks(ScopeFilter scope, Consumer<TaskExportRow> consumer) {
        streamScopedTasks(scope, DEFAULT_MAX_EXPORT_ROWS, consumer);
    }

    public void streamScopedTasks(ScopeFilter scope, int maxRows, Consumer<TaskExportRow> consumer) {
        int effectiveLimit = maxRows > 0 ? maxRows : DEFAULT_MAX_EXPORT_ROWS;
        var query = jdbcClient.sql("""
                select
                    t.id,
                    t.title,
                    coalesce(p.name, '—') as project_name,
                    t.priority,
                    coalesce(s.name, 'Новая') as status_name,
                    t.end_time,
                    t.created_at,
                    coalesce(u.name, '—') as reporter_name
                from ms_tasks t
                left join ms_task_projects p on p.id = t.project_id
                left join ms_task_statuses s on s.id = t.status_id
                left join md_users u on u.id = t.reporter_id
                where 1=1
                """ + scope.sql() + " order by t.id desc limit :maxExportRows");

        if (scope.bindsUserId()) {
            query = query.param("scopeUserId", scope.userId());
        }
        query = query.param("maxExportRows", effectiveLimit);

        query.query(rs -> {
            var endTime = rs.getTimestamp("end_time");
            var createdAt = rs.getTimestamp("created_at");
            consumer.accept(new TaskExportRow(
                    rs.getLong("id"),
                    rs.getString("title"),
                    rs.getString("project_name"),
                    rs.getString("priority"),
                    rs.getString("status_name"),
                    endTime != null ? endTime.toInstant() : null,
                    createdAt != null ? createdAt.toInstant() : null,
                    rs.getString("reporter_name")
            ));
        });
    }
}
