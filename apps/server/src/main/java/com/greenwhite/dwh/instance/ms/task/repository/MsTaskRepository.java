package com.greenwhite.dwh.instance.ms.task.repository;

import com.greenwhite.dwh.instance.common.security.ScopeFilter;
import com.greenwhite.dwh.instance.ms.task.MsTaskPatch;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class MsTaskRepository {

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public MsTaskRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public TaskRecord create(TaskCreateData data, Long createdBy) {
        String attrsJson = toJson(data.attributes());

        return jdbcClient.sql("""
                insert into ms_tasks (project_id, parent_task_id, title, description_markdown,
                                     status_id, priority, reporter_id, attributes, begin_time,
                                     end_time, created_at, modified_at, created_by, modified_by)
                values (:projectId, :parentTaskId, :title, :descriptionMarkdown,
                        :statusId, :priority, :reporterId, cast(:attributes as jsonb), :beginTime,
                        :endTime, now(), now(), :createdBy, :createdBy)
                returning id, project_id, parent_task_id, title, description_markdown, status_id,
                          priority, reporter_id, attributes::text as attributes_str, begin_time,
                          end_time, resolved_time, created_at, modified_at, created_by, modified_by
                """)
                .param("projectId", data.projectId())
                .param("parentTaskId", data.parentTaskId())
                .param("title", data.title().trim())
                .param("descriptionMarkdown", data.descriptionMarkdown() != null ? data.descriptionMarkdown() : "")
                .param("statusId", data.statusId())
                .param("priority", data.priority() != null ? data.priority() : "medium")
                .param("reporterId", data.reporterId())
                .param("attributes", attrsJson)
                .param("beginTime", data.beginTime() != null ? java.sql.Timestamp.from(data.beginTime()) : null)
                .param("endTime", data.endTime() != null ? java.sql.Timestamp.from(data.endTime()) : null)
                .param("createdBy", createdBy)
                .query(this::mapRecord)
                .single();
    }

    public Optional<TaskRecord> findById(Long id) {
        return findById(id, ScopeFilter.unrestricted());
    }

    public Optional<TaskRecord> findById(Long id, ScopeFilter scope) {
        String sql = """
                select t.id, t.project_id, t.parent_task_id, t.title, t.description_markdown, t.status_id,
                       t.priority, t.reporter_id, t.attributes::text as attributes_str, t.begin_time,
                       t.end_time, t.resolved_time, t.created_at, t.modified_at, t.created_by, t.modified_by
                from ms_tasks t
                where t.id = :id
                """ + scope.sql();
        var query = jdbcClient.sql(sql).param("id", id);
        if (scope.bindsUserId()) query = query.param("scopeUserId", scope.userId());
        return query.query(this::mapRecord).optional();
    }

    public List<TaskRecord> listTasks(int limit, Long afterId, Long projectId, Long statusId,
                                      String priority, String search, Boolean hideTerminal) {
        return listTasks(limit, afterId, projectId, statusId, priority, search, hideTerminal,
                null, null, null, ScopeFilter.unrestricted());
    }

    public List<TaskRecord> listTasks(int limit, Long afterId, Long projectId, Long statusId,
                                      String priority, String search, Boolean hideTerminal, ScopeFilter scope) {
        return listTasks(limit, afterId, projectId, statusId, priority, search, hideTerminal,
                null, null, null, scope);
    }

    public List<TaskRecord> listTasks(int limit, Long afterId, Long projectId, Long statusId,
                                      String priority, String search, Boolean hideTerminal,
                                      Long assignedUserId, Long reporterId, Boolean overdue, ScopeFilter scope) {
        StringBuilder sql = new StringBuilder("""
                select t.id, t.project_id, t.parent_task_id, t.title, t.description_markdown, t.status_id,
                       t.priority, t.reporter_id, t.attributes::text as attributes_str, t.begin_time,
                       t.end_time, t.resolved_time, t.created_at, t.modified_at, t.created_by, t.modified_by
                from ms_tasks t
                where 1=1
                """);

        sql.append(scope.sql());

        if (afterId != null) {
            sql.append(" and t.id > :afterId");
        }
        if (projectId != null) {
            sql.append(" and t.project_id = :projectId");
        }
        if (statusId != null) {
            sql.append(" and t.status_id = :statusId");
        } else if (Boolean.TRUE.equals(hideTerminal)) {
            sql.append(" and t.status_id not in (select id from ms_task_statuses where is_terminal = true)");
        }
        if (priority != null && !priority.isBlank()) {
            sql.append(" and t.priority = :priority");
        }
        if (search != null && !search.isBlank()) {
            sql.append(" and (t.title ilike :search or t.description_markdown ilike :search)");
        }
        if (assignedUserId != null) {
            sql.append(" and exists (select 1 from ms_task_members m where m.task_id = t.id and m.user_id = :assignedUserId and m.involve_kind in ('R', 'E'))");
        }
        if (reporterId != null) {
            sql.append(" and (t.reporter_id = :reporterId or t.created_by = :reporterId)");
        }
        if (Boolean.TRUE.equals(overdue)) {
            sql.append(" and t.end_time is not null and t.end_time < now() and t.status_id not in (select id from ms_task_statuses where is_terminal = true)");
        }

        sql.append(" order by t.id asc limit :limit");

        var query = jdbcClient.sql(sql.toString()).param("limit", limit);

        if (scope.bindsUserId()) query = query.param("scopeUserId", scope.userId());
        if (afterId != null) query.param("afterId", afterId);
        if (projectId != null) query.param("projectId", projectId);
        if (statusId != null) query.param("statusId", statusId);
        if (priority != null && !priority.isBlank()) query.param("priority", priority);
        if (search != null && !search.isBlank()) query.param("search", "%" + search.trim() + "%");
        if (assignedUserId != null) query.param("assignedUserId", assignedUserId);
        if (reporterId != null) query.param("reporterId", reporterId);

        return query.query(this::mapRecord).list();
    }


    public void update(Long id, TaskUpdateData data, Long modifiedBy) {
        String attrsJson = data.attributes() != null ? toJson(data.attributes()) : null;

        jdbcClient.sql("""
                update ms_tasks
                set title = coalesce(:title, title),
                    description_markdown = coalesce(:descriptionMarkdown, description_markdown),
                    status_id = coalesce(:statusId, status_id),
                    priority = coalesce(:priority, priority),
                    project_id = coalesce(:projectId, project_id),
                    parent_task_id = coalesce(:parentTaskId, parent_task_id),
                    begin_time = coalesce(:beginTime, begin_time),
                    end_time = coalesce(:endTime, end_time),
                    resolved_time = coalesce(:resolvedTime, resolved_time),
                    attributes = case when cast(:attributes as text) is not null then cast(:attributes as jsonb) else attributes end,
                    modified_at = now(),
                    modified_by = :modifiedBy
                where id = :id
                """)
                .param("id", id)
                .param("title", data.title())
                .param("descriptionMarkdown", data.descriptionMarkdown())
                .param("statusId", data.statusId())
                .param("priority", data.priority())
                .param("projectId", data.projectId())
                .param("parentTaskId", data.parentTaskId())
                .param("beginTime", data.beginTime() != null ? java.sql.Timestamp.from(data.beginTime()) : null)
                .param("endTime", data.endTime() != null ? java.sql.Timestamp.from(data.endTime()) : null)
                .param("resolvedTime", data.resolvedTime() != null ? java.sql.Timestamp.from(data.resolvedTime()) : null)
                .param("attributes", attrsJson)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public void patch(Long id, MsTaskPatch patch, Long modifiedBy) {
        String attrsJson = patch.attributes() != null ? toJson(patch.attributes()) : null;

        jdbcClient.sql("""
                update ms_tasks
                set title = case when :titlePresent then :title else title end,
                    description_markdown = case when :descriptionPresent then :descriptionMarkdown else description_markdown end,
                    priority = case when :priorityPresent then :priority else priority end,
                    project_id = case when :projectPresent then :projectId else project_id end,
                    parent_task_id = case when :parentPresent then :parentTaskId else parent_task_id end,
                    begin_time = case when :beginPresent then :beginTime else begin_time end,
                    end_time = case when :endPresent then :endTime else end_time end,
                    attributes = case when :attributesPresent then cast(:attributes as jsonb) else attributes end,
                    modified_at = now(),
                    modified_by = :modifiedBy
                where id = :id
                """)
                .param("id", id)
                .param("titlePresent", patch.titlePresent())
                .param("title", patch.title())
                .param("descriptionPresent", patch.descriptionMarkdownPresent())
                .param("descriptionMarkdown", patch.descriptionMarkdown())
                .param("priorityPresent", patch.priorityPresent())
                .param("priority", patch.priority())
                .param("projectPresent", patch.projectIdPresent())
                .param("projectId", patch.projectId())
                .param("parentPresent", patch.parentTaskIdPresent())
                .param("parentTaskId", patch.parentTaskId())
                .param("beginPresent", patch.beginTimePresent())
                .param("beginTime", patch.beginTime() != null ? java.sql.Timestamp.from(patch.beginTime()) : null)
                .param("endPresent", patch.endTimePresent())
                .param("endTime", patch.endTime() != null ? java.sql.Timestamp.from(patch.endTime()) : null)
                .param("attributesPresent", patch.attributesPresent())
                .param("attributes", attrsJson)
                .param("modifiedBy", modifiedBy)
                .update();
    }


    public void updateStatus(Long taskId, Long statusId, Instant resolvedTime, Long modifiedBy) {
        jdbcClient.sql("""
                update ms_tasks
                set status_id = :statusId,
                    resolved_time = :resolvedTime,
                    modified_at = now(),
                    modified_by = :modifiedBy
                where id = :taskId
                """)
                .param("taskId", taskId)
                .param("statusId", statusId)
                .param("resolvedTime", resolvedTime != null ? java.sql.Timestamp.from(resolvedTime) : null)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public List<TaskRecord> findSubtasks(Long parentTaskId) {
        return findSubtasks(parentTaskId, ScopeFilter.unrestricted());
    }

    public List<TaskRecord> findSubtasks(Long parentTaskId, ScopeFilter scope) {
        String sql = """
                select t.id, t.project_id, t.parent_task_id, t.title, t.description_markdown, t.status_id,
                       t.priority, t.reporter_id, t.attributes::text as attributes_str, t.begin_time,
                       t.end_time, t.resolved_time, t.created_at, t.modified_at, t.created_by, t.modified_by
                from ms_tasks t
                where t.parent_task_id = :parentTaskId
                """ + scope.sql() + " order by t.id asc";
        var query = jdbcClient.sql(sql).param("parentTaskId", parentTaskId);
        if (scope.bindsUserId()) query = query.param("scopeUserId", scope.userId());
        return query.query(this::mapRecord).list();
    }

    public List<TaskRecord> findAncestorChain(Long taskId) {
        return findAncestorChain(taskId, ScopeFilter.unrestricted());
    }

    public List<TaskRecord> findAncestorChain(Long taskId, ScopeFilter scope) {
        String sql = """
                with recursive ancestors(id, depth) as (
                    select root.parent_task_id, 1
                    from ms_tasks root
                    where root.id = :taskId and root.parent_task_id is not null
                    union all
                    select parent.parent_task_id, a.depth + 1
                    from ms_tasks parent
                    join ancestors a on a.id = parent.id
                    where parent.parent_task_id is not null
                )
                select t.id, t.project_id, t.parent_task_id, t.title, t.description_markdown, t.status_id,
                       t.priority, t.reporter_id, t.attributes::text as attributes_str, t.begin_time,
                       t.end_time, t.resolved_time, t.created_at, t.modified_at, t.created_by, t.modified_by
                from ancestors a
                join ms_tasks t on t.id = a.id
                where 1=1
                """ + scope.sql() + " order by a.depth desc";
        var query = jdbcClient.sql(sql).param("taskId", taskId);
        if (scope.bindsUserId()) query = query.param("scopeUserId", scope.userId());
        return query.query(this::mapRecord).list();
    }

    public boolean isDescendantOf(Long potentialDescendantId, Long ancestorId) {
        // Recursive CTE to check parent tree cycle
        return jdbcClient.sql("""
                with recursive task_tree as (
                    select id, parent_task_id from ms_tasks where id = :potentialDescendantId
                    union all
                    select t.id, t.parent_task_id from ms_tasks t
                    join task_tree tt on tt.parent_task_id = t.id
                )
                select count(*) from task_tree where id = :ancestorId
                """)
                .param("potentialDescendantId", potentialDescendantId)
                .param("ancestorId", ancestorId)
                .query(Integer.class)
                .single() > 0;
    }

    public List<ProjectTaskStats> getProjectTaskStats() {
        return getProjectTaskStats(ScopeFilter.unrestricted());
    }

    public List<ProjectTaskStats> getProjectTaskStats(ScopeFilter scope) {
        String sql = """
                select p.id as project_id,
                       count(t.id) as total_tasks,
                       count(t.id) filter (where s.is_terminal = false) as active_tasks,
                       count(t.id) filter (where s.is_terminal = true) as done_tasks
                from ms_task_projects p
                left join ms_tasks t on t.project_id = p.id
                """ + scope.sql() + """
                left join ms_task_statuses s on s.id = t.status_id
                group by p.id
                """;
        var query = jdbcClient.sql(sql);
        if (scope.bindsUserId()) query = query.param("scopeUserId", scope.userId());
        return query.query((rs, rowNum) -> new ProjectTaskStats(
                        rs.getLong("project_id"),
                        rs.getInt("total_tasks"),
                        rs.getInt("active_tasks"),
                        rs.getInt("done_tasks")
                )).list();
    }

    public record ProjectTaskStats(
            Long projectId,
            int totalTasks,
            int activeTasks,
            int doneTasks
    ) {}


    private TaskRecord mapRecord(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new TaskRecord(
                rs.getLong("id"),
                rs.getObject("project_id") != null ? rs.getLong("project_id") : null,
                rs.getObject("parent_task_id") != null ? rs.getLong("parent_task_id") : null,
                rs.getString("title"),
                rs.getString("description_markdown"),
                rs.getLong("status_id"),
                rs.getString("priority"),
                rs.getLong("reporter_id"),
                parseJson(rs.getString("attributes_str")),
                rs.getTimestamp("begin_time") != null ? rs.getTimestamp("begin_time").toInstant() : null,
                rs.getTimestamp("end_time") != null ? rs.getTimestamp("end_time").toInstant() : null,
                rs.getTimestamp("resolved_time") != null ? rs.getTimestamp("resolved_time").toInstant() : null,
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("modified_at").toInstant(),
                rs.getLong("created_by"),
                rs.getLong("modified_by")
        );
    }

    private String toJson(Map<String, Object> map) {
        if (map == null) return "{}";
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JacksonException e) {
            return "{}";
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    public void attachFile(Long taskId, java.util.UUID fileId) {
        jdbcClient.sql("""
                insert into ms_task_files (task_id, file_id, created_at)
                values (:taskId, :fileId, now())
                on conflict (task_id, file_id) do nothing
                """)
                .param("taskId", taskId)
                .param("fileId", fileId)
                .update();
    }

    public void detachFile(Long taskId, java.util.UUID fileId) {
        jdbcClient.sql("""
                delete from ms_task_files
                where task_id = :taskId and file_id = :fileId
                """)
                .param("taskId", taskId)
                .param("fileId", fileId)
                .update();
    }

    public List<TaskFileRecord> listTaskFiles(Long taskId) {
        return jdbcClient.sql("""
                select tf.file_id, f.original_name, f.size_bytes, f.mime_type, tf.created_at
                from ms_task_files tf
                join mf_files f on f.id = tf.file_id
                where tf.task_id = :taskId
                order by tf.created_at asc
                """)
                .param("taskId", taskId)
                .query((rs, rowNum) -> new TaskFileRecord(
                        java.util.UUID.fromString(rs.getString("file_id")),
                        rs.getString("original_name"),
                        rs.getLong("size_bytes"),
                        rs.getString("mime_type"),
                        rs.getTimestamp("created_at").toInstant()
                ))
                .list();
    }

    public record TaskFileRecord(
            java.util.UUID fileId,
            String fileName,
            long sizeBytes,
            String mimeType,
            Instant createdAt
    ) {}


    public record TaskRecord(
            Long id,
            Long projectId,
            Long parentTaskId,
            String title,
            String descriptionMarkdown,
            Long statusId,
            String priority,
            Long reporterId,
            Map<String, Object> attributes,
            Instant beginTime,
            Instant endTime,
            Instant resolvedTime,
            Instant createdAt,
            Instant modifiedAt,
            Long createdBy,
            Long modifiedBy
    ) {}

    public record TaskCreateData(
            Long projectId,
            Long parentTaskId,
            String title,
            String descriptionMarkdown,
            Long statusId,
            String priority,
            Long reporterId,
            Map<String, Object> attributes,
            Instant beginTime,
            Instant endTime
    ) {}

    public record TaskDeadlineCandidate(long taskId, String title, long userId) {}

    public List<TaskDeadlineCandidate> findUpcomingDeadlines(java.time.Duration window) {
        return jdbcClient.sql("""
                select distinct t.id as task_id, t.title, tm.user_id
                from ms_tasks t
                join ms_task_statuses s on s.id = t.status_id and s.is_terminal = false
                join ms_task_members tm on tm.task_id = t.id
                where t.end_time is not null
                  and t.end_time > now()
                  and t.end_time <= now() + cast(:windowSeconds || ' seconds' as interval)
                """)
                .param("windowSeconds", window.toSeconds())
                .query((rs, rowNum) -> new TaskDeadlineCandidate(
                        rs.getLong("task_id"),
                        rs.getString("title"),
                        rs.getLong("user_id")
                ))
                .list();
    }

    public record TaskUpdateData(
            Long projectId,
            String title,
            String descriptionMarkdown,
            Long statusId,
            String priority,
            Long parentTaskId,
            Map<String, Object> attributes,
            Instant beginTime,
            Instant endTime,
            Instant resolvedTime
    ) {}
}

