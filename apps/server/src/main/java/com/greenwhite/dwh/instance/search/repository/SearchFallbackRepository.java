package com.greenwhite.dwh.instance.search.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Bounded PostgreSQL fallback; all user values remain bound parameters. */
@Repository
public class SearchFallbackRepository {
    private static final int MAX_DESCRIPTION_CODE_POINTS = 240;
    private final JdbcClient jdbcClient;

    public SearchFallbackRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @Transactional(readOnly = true, timeout = 2)
    public FallbackSearch search(String query, String entityType, int limit) {
        return search(query, List.of(query), entityType, limit);
    }

    @Transactional(readOnly = true, timeout = 2)
    public FallbackSearch search(String query, List<String> variants, String entityType, int limit) {
        List<String> activeVariants = (variants == null || variants.isEmpty()) ? List.of(query) : variants;
        String[] patterns = activeVariants.stream()
                .map(v -> "%" + v.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%")
                .toArray(String[]::new);
        String primaryPattern = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";

        List<FallbackGroup> groups = new ArrayList<>();
        for (String type : requestedTypes(entityType)) {
            List<FallbackHit> candidates = switch (type) {
                case "TASK" -> searchTasks(patterns, primaryPattern, limit + 1);
                case "PROJECT" -> searchProjects(patterns, primaryPattern, limit + 1);
                case "USER" -> searchUsers(patterns, primaryPattern, limit + 1);
                case "NOTE" -> searchNotes(patterns, primaryPattern, limit + 1);
                default -> throw new IllegalArgumentException("Unsupported search entity");
            };
            boolean hasMore = candidates.size() > limit;
            groups.add(new FallbackGroup(type, hasMore ? candidates.subList(0, limit) : candidates, hasMore));
        }
        return new FallbackSearch(groups);
    }

    @Transactional(readOnly = true, timeout = 2)
    public FallbackSearch searchExact(long id, String entityType) {
        List<FallbackGroup> groups = new ArrayList<>();
        for (String type : requestedTypes(entityType)) {
            List<FallbackHit> hits = switch (type) {
                case "TASK" -> exactTask(id);
                case "PROJECT" -> exactProject(id);
                case "USER" -> exactUser(id);
                case "NOTE" -> exactNote(id);
                default -> throw new IllegalArgumentException("Unsupported search entity");
            };
            groups.add(new FallbackGroup(type, hits, false));
        }
        return new FallbackSearch(groups);
    }

    private List<FallbackHit> searchTasks(String[] patterns, String primaryPattern, int limit) {
        return jdbcClient.sql("""
                select t.id, t.title, t.priority, s.name as status_name, p.name as project_name
                from ms_tasks t
                left join ms_task_statuses s on s.id = t.status_id
                left join ms_task_projects p on p.id = t.project_id
                where t.title ilike any(:patterns)
                   or t.description_markdown ilike any(:patterns)
                   or s.name ilike any(:patterns)
                   or p.name ilike any(:patterns)
                order by (t.title ilike :primary) desc, t.id
                limit :limit
                """).param("patterns", patterns).param("primary", primaryPattern).param("limit", limit)
                .query((rs, rowNum) -> taskHit(rs.getLong("id"), rs.getString("title"), rs.getString("priority"),
                        rs.getString("status_name"), rs.getString("project_name"))).list();
    }

    private List<FallbackHit> searchProjects(String[] patterns, String primaryPattern, int limit) {
        return jdbcClient.sql("""
                select id, name, description
                from ms_task_projects
                where state = 'A'
                  and (name ilike any(:patterns) or description ilike any(:patterns))
                order by (name ilike :primary) desc, id
                limit :limit
                """).param("patterns", patterns).param("primary", primaryPattern).param("limit", limit)
                .query((rs, rowNum) -> new FallbackHit("PROJECT", Long.toString(rs.getLong("id")), rs.getString("name"),
                        bounded(rs.getString("description")), "/tasks/projects/" + rs.getLong("id"))).list();
    }

    private List<FallbackHit> searchUsers(String[] patterns, String primaryPattern, int limit) {
        return jdbcClient.sql("""
                select id, name, login, email
                from md_users
                where state = 'A'
                  and (name ilike any(:patterns)
                    or login ilike any(:patterns)
                    or email ilike any(:patterns)
                    or phone ilike any(:patterns))
                order by (name ilike :primary or login ilike :primary) desc, id
                limit :limit
                """).param("patterns", patterns).param("primary", primaryPattern).param("limit", limit)
                .query((rs, rowNum) -> userHit(rs.getLong("id"), rs.getString("name"),
                        rs.getString("login"), rs.getString("email"))).list();
    }

    private List<FallbackHit> searchNotes(String[] patterns, String primaryPattern, int limit) {
        return jdbcClient.sql("""
                select id, title, content_md
                from ms_notes
                where title ilike any(:patterns)
                   or content_md ilike any(:patterns)
                order by (title ilike :primary) desc, is_pinned desc, id desc
                limit :limit
                """).param("patterns", patterns).param("primary", primaryPattern).param("limit", limit)
                .query((rs, rowNum) -> new FallbackHit("NOTE", Long.toString(rs.getLong("id")), rs.getString("title"),
                        bounded(rs.getString("content_md")), "/notes?id=" + rs.getLong("id"))).list();
    }

    private List<FallbackHit> exactTask(long id) {
        return jdbcClient.sql("""
                select t.id, t.title, t.priority, s.name as status_name, p.name as project_name
                from ms_tasks t
                left join ms_task_statuses s on s.id = t.status_id
                left join ms_task_projects p on p.id = t.project_id
                where t.id = :id
                order by t.id
                """).param("id", id)
                .query((rs, rowNum) -> taskHit(rs.getLong("id"), rs.getString("title"), rs.getString("priority"),
                        rs.getString("status_name"), rs.getString("project_name"))).list();
    }

    private List<FallbackHit> exactProject(long id) {
        return jdbcClient.sql("""
                select id, name, description from ms_task_projects
                where id = :id and state = 'A' order by id
                """).param("id", id)
                .query((rs, rowNum) -> new FallbackHit("PROJECT", Long.toString(rs.getLong("id")), rs.getString("name"),
                        bounded(rs.getString("description")), "/tasks/projects/" + rs.getLong("id"))).list();
    }

    private List<FallbackHit> exactUser(long id) {
        return jdbcClient.sql("""
                select id, name, login, email from md_users
                where id = :id and state = 'A' order by id
                """).param("id", id)
                .query((rs, rowNum) -> userHit(rs.getLong("id"), rs.getString("name"),
                        rs.getString("login"), rs.getString("email"))).list();
    }

    private List<FallbackHit> exactNote(long id) {
        return jdbcClient.sql("""
                select id, title, content_md from ms_notes
                where id = :id order by id
                """).param("id", id)
                .query((rs, rowNum) -> new FallbackHit("NOTE", Long.toString(rs.getLong("id")), rs.getString("title"),
                        bounded(rs.getString("content_md")), "/notes?id=" + rs.getLong("id"))).list();
    }

    private static FallbackHit taskHit(long id, String title, String priority, String status, String project) {
        StringBuilder description = new StringBuilder("Статус: ")
                .append(status == null || status.isBlank() ? "Новая" : status)
                .append(" | Приоритет: ").append(priority == null ? "medium" : priority);
        if (project != null && !project.isBlank()) description.append(" | Проект: ").append(project);
        return new FallbackHit("TASK", Long.toString(id), title, bounded(description.toString()), "/tasks/items/" + id);
    }

    private static FallbackHit userHit(long id, String name, String login, String email) {
        return new FallbackHit("USER", Long.toString(id), name,
                bounded(email + " (@" + login + ")"), "/iam/users/" + id);
    }

    private static List<String> requestedTypes(String entityType) {
        String normalized = entityType.toUpperCase(Locale.ROOT);
        return normalized.equals("ALL") ? List.of("TASK", "PROJECT", "USER", "NOTE") : List.of(normalized);
    }

    private static String bounded(String value) {
        if (value == null) return "";
        int count = value.codePointCount(0, value.length());
        return count <= MAX_DESCRIPTION_CODE_POINTS ? value
                : value.substring(0, value.offsetByCodePoints(0, MAX_DESCRIPTION_CODE_POINTS));
    }

    public record FallbackHit(String entityType, String id, String title, String description, String targetUrl) {}
    public record FallbackGroup(String entityType, List<FallbackHit> hits, boolean hasMore) {
        public FallbackGroup { hits = List.copyOf(hits); }
    }
    public record FallbackSearch(List<FallbackGroup> groups) {
        public FallbackSearch { groups = List.copyOf(groups); }
    }
}
