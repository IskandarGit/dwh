package com.greenwhite.dwh.instance.md.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class NavigationItemRepository {

    private final JdbcClient jdbcClient;

    public NavigationItemRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public record NavigationItemRecord(
            Long id,
            String code,
            String title,
            String titleKey,
            String sectionId,
            Long parentId,
            String icon,
            String targetType,
            String url,
            boolean openInIframe,
            String requiredPermission,
            int sortOrder,
            String state,
            Long createdBy,
            Long modifiedBy,
            Instant createdAt,
            Instant modifiedAt
    ) {}

    public List<NavigationItemRecord> findAll() {
        return jdbcClient.sql("""
                select id, code, title, title_key, section_id, parent_id, icon, target_type,
                       url, open_in_iframe, required_permission, sort_order, state,
                       created_by, modified_by, created_at, modified_at
                from md_navigation_items
                order by section_id asc, sort_order asc, id asc
                """)
                .query(this::mapRecord)
                .list();
    }

    public List<NavigationItemRecord> findActive() {
        return jdbcClient.sql("""
                select id, code, title, title_key, section_id, parent_id, icon, target_type,
                       url, open_in_iframe, required_permission, sort_order, state,
                       created_by, modified_by, created_at, modified_at
                from md_navigation_items
                where state = 'A'
                order by section_id asc, sort_order asc, id asc
                """)
                .query(this::mapRecord)
                .list();
    }

    public Optional<NavigationItemRecord> findById(Long id) {
        return jdbcClient.sql("""
                select id, code, title, title_key, section_id, parent_id, icon, target_type,
                       url, open_in_iframe, required_permission, sort_order, state,
                       created_by, modified_by, created_at, modified_at
                from md_navigation_items
                where id = :id
                """)
                .param("id", id)
                .query(this::mapRecord)
                .optional();
    }

    public Optional<NavigationItemRecord> findByCode(String code) {
        return jdbcClient.sql("""
                select id, code, title, title_key, section_id, parent_id, icon, target_type,
                       url, open_in_iframe, required_permission, sort_order, state,
                       created_by, modified_by, created_at, modified_at
                from md_navigation_items
                where code = :code
                """)
                .param("code", code)
                .query(this::mapRecord)
                .optional();
    }

    public Long insert(NavigationItemRecord item) {
        return jdbcClient.sql("""
                insert into md_navigation_items (
                    code, title, title_key, section_id, parent_id, icon, target_type,
                    url, open_in_iframe, required_permission, sort_order, state,
                    created_by, modified_by, created_at, modified_at
                ) values (
                    :code, :title, :titleKey, :sectionId, :parentId, :icon, :targetType,
                    :url, :openInIframe, :requiredPermission, :sortOrder, :state,
                    :createdBy, :modifiedBy, clock_timestamp(), clock_timestamp()
                )
                returning id
                """)
                .param("code", item.code())
                .param("title", item.title())
                .param("titleKey", item.titleKey())
                .param("sectionId", item.sectionId() != null ? item.sectionId() : "custom")
                .param("parentId", item.parentId())
                .param("icon", item.icon() != null ? item.icon() : "bar_chart")
                .param("targetType", item.targetType() != null ? item.targetType() : "EMBEDDED_IFRAME")
                .param("url", item.url())
                .param("openInIframe", item.openInIframe())
                .param("requiredPermission", item.requiredPermission())
                .param("sortOrder", item.sortOrder())
                .param("state", item.state() != null ? item.state() : "A")
                .param("createdBy", item.createdBy())
                .param("modifiedBy", item.modifiedBy())
                .query(Long.class)
                .single();
    }

    public int update(Long id, NavigationItemRecord item) {
        return jdbcClient.sql("""
                update md_navigation_items
                set code = :code,
                    title = :title,
                    title_key = :titleKey,
                    section_id = :sectionId,
                    parent_id = :parentId,
                    icon = :icon,
                    target_type = :targetType,
                    url = :url,
                    open_in_iframe = :openInIframe,
                    required_permission = :requiredPermission,
                    sort_order = :sortOrder,
                    state = :state,
                    modified_by = :modifiedBy,
                    modified_at = clock_timestamp()
                where id = :id
                """)
                .param("id", id)
                .param("code", item.code())
                .param("title", item.title())
                .param("titleKey", item.titleKey())
                .param("sectionId", item.sectionId() != null ? item.sectionId() : "custom")
                .param("parentId", item.parentId())
                .param("icon", item.icon() != null ? item.icon() : "bar_chart")
                .param("targetType", item.targetType() != null ? item.targetType() : "EMBEDDED_IFRAME")
                .param("url", item.url())
                .param("openInIframe", item.openInIframe())
                .param("requiredPermission", item.requiredPermission())
                .param("sortOrder", item.sortOrder())
                .param("state", item.state() != null ? item.state() : "A")
                .param("modifiedBy", item.modifiedBy())
                .update();
    }

    public int updateState(Long id, String state, Long modifiedBy) {
        return jdbcClient.sql("""
                update md_navigation_items
                set state = :state,
                    modified_by = :modifiedBy,
                    modified_at = clock_timestamp()
                where id = :id
                """)
                .param("id", id)
                .param("state", state)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public int delete(Long id) {
        return jdbcClient.sql("""
                delete from md_navigation_items
                where id = :id
                """)
                .param("id", id)
                .update();
    }

    private NavigationItemRecord mapRecord(ResultSet rs, int rowNum) throws SQLException {
        return new NavigationItemRecord(
                rs.getLong("id"),
                rs.getString("code"),
                rs.getString("title"),
                rs.getString("title_key"),
                rs.getString("section_id"),
                rs.getObject("parent_id") != null ? rs.getLong("parent_id") : null,
                rs.getString("icon"),
                rs.getString("target_type"),
                rs.getString("url"),
                rs.getBoolean("open_in_iframe"),
                rs.getString("required_permission"),
                rs.getInt("sort_order"),
                rs.getString("state"),
                rs.getObject("created_by") != null ? rs.getLong("created_by") : null,
                rs.getObject("modified_by") != null ? rs.getLong("modified_by") : null,
                rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null,
                rs.getTimestamp("modified_at") != null ? rs.getTimestamp("modified_at").toInstant() : null
        );
    }
}
