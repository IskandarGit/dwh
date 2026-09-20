package com.greenwhite.dwh.instance.ms.note.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class MsNoteRepository {

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public MsNoteRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public record NoteRecord(
            Long id,
            String title,
            String contentMd,
            String color,
            boolean isPinned,
            Map<String, Object> attributes,
            Long createdBy,
            Long modifiedBy,
            Instant createdAt,
            Instant modifiedAt
    ) {}

    public NoteRecord create(String title, String contentMd, String color, boolean isPinned,
                             Map<String, Object> attributes, Long userId) {
        String attrsJson = toJson(attributes);
        return jdbcClient.sql("""
                insert into ms_notes(title, content_md, color, is_pinned, attributes, created_by, modified_by, created_at, modified_at)
                values(:title, :contentMd, :color, :isPinned, cast(:attributes as jsonb), :userId, :userId, clock_timestamp(), clock_timestamp())
                returning id, title, content_md, color, is_pinned, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                """)
                .param("title", title)
                .param("contentMd", contentMd != null ? contentMd : "")
                .param("color", color != null ? color : "default")
                .param("isPinned", isPinned)
                .param("attributes", attrsJson)
                .param("userId", userId)
                .query(this::mapNote)
                .single();
    }

    public Optional<NoteRecord> findById(Long id) {
        return jdbcClient.sql("""
                select id, title, content_md, color, is_pinned, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                from ms_notes
                where id = :id
                """)
                .param("id", id)
                .query(this::mapNote)
                .optional();
    }

    public List<NoteRecord> findByOwner(Long userId, String search) {
        if (search != null && !search.isBlank()) {
            String pattern = "%" + search.trim().toLowerCase() + "%";
            return jdbcClient.sql("""
                    select id, title, content_md, color, is_pinned, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                    from ms_notes
                    where created_by = :userId and (lower(title) like :pattern or lower(content_md) like :pattern)
                    order by is_pinned desc, modified_at desc, id desc
                    """)
                    .param("userId", userId)
                    .param("pattern", pattern)
                    .query(this::mapNote)
                    .list();
        }

        return jdbcClient.sql("""
                select id, title, content_md, color, is_pinned, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                from ms_notes
                where created_by = :userId
                order by is_pinned desc, modified_at desc, id desc
                """)
                .param("userId", userId)
                .query(this::mapNote)
                .list();
    }

    public NoteRecord update(Long id, String title, String contentMd, String color, Boolean isPinned,
                             Map<String, Object> attributes, Long userId) {
        String attrsJson = toJson(attributes);
        return jdbcClient.sql("""
                update ms_notes
                set title = coalesce(:title, title),
                    content_md = coalesce(:contentMd, content_md),
                    color = coalesce(:color, color),
                    is_pinned = coalesce(:isPinned, is_pinned),
                    attributes = coalesce(cast(:attributes as jsonb), attributes),
                    modified_by = :userId,
                    modified_at = clock_timestamp()
                where id = :id
                returning id, title, content_md, color, is_pinned, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                """)
                .param("id", id)
                .param("title", title)
                .param("contentMd", contentMd)
                .param("color", color)
                .param("isPinned", isPinned)
                .param("attributes", attrsJson)
                .param("userId", userId)
                .query(this::mapNote)
                .single();
    }

    public boolean delete(Long id) {
        return jdbcClient.sql("delete from ms_notes where id = :id")
                .param("id", id)
                .update() > 0;
    }

    private NoteRecord mapNote(ResultSet rs, int rowNum) throws SQLException {
        return new NoteRecord(
                rs.getLong("id"),
                rs.getString("title"),
                rs.getString("content_md"),
                rs.getString("color"),
                rs.getBoolean("is_pinned"),
                parseJson(rs.getString("attributes_str")),
                rs.getLong("created_by"),
                rs.getLong("modified_by"),
                rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null,
                rs.getTimestamp("modified_at") != null ? rs.getTimestamp("modified_at").toInstant() : null
        );
    }

    private String toJson(Map<String, Object> map) {
        if (map == null || map.isEmpty()) return "{}";
        try {
            return objectMapper.writeValueAsString(map);
        } catch (Exception e) {
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
}
