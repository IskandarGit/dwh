package com.greenwhite.dwh.instance.md.repository;

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
public class ModuleRegistryRepository {

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public ModuleRegistryRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public record InstalledModuleRecord(
            String code,
            String name,
            String description,
            String version,
            String icon,
            String route,
            boolean isSystem,
            String status,
            int sortOrder,
            Map<String, Object> attributes,
            Instant createdAt,
            Instant modifiedAt
    ) {}

    public List<InstalledModuleRecord> findAll() {
        return jdbcClient.sql("""
                select code, name, description, version, icon, route, is_system, status, sort_order,
                       attributes::text as attributes_str, created_at, modified_at
                from md_installed_modules
                order by sort_order asc, code asc
                """)
                .query(this::mapModule)
                .list();
    }

    public List<InstalledModuleRecord> findActive() {
        return jdbcClient.sql("""
                select code, name, description, version, icon, route, is_system, status, sort_order,
                       attributes::text as attributes_str, created_at, modified_at
                from md_installed_modules
                where status = 'ACTIVE'
                order by sort_order asc, code asc
                """)
                .query(this::mapModule)
                .list();
    }

    public Optional<InstalledModuleRecord> findByCode(String code) {
        return jdbcClient.sql("""
                select code, name, description, version, icon, route, is_system, status, sort_order,
                       attributes::text as attributes_str, created_at, modified_at
                from md_installed_modules
                where code = :code
                """)
                .param("code", code)
                .query(this::mapModule)
                .optional();
    }

    public int updateStatus(String code, String status) {
        return jdbcClient.sql("""
                update md_installed_modules
                set status = :status, modified_at = clock_timestamp()
                where code = :code
                """)
                .param("code", code)
                .param("status", status)
                .update();
    }

    public void upsertModule(InstalledModuleRecord module) {
        String attrsJson = toJson(module.attributes());
        jdbcClient.sql("""
                insert into md_installed_modules(code, name, description, version, icon, route, is_system, status, sort_order, attributes, created_at, modified_at)
                values(:code, :name, :description, :version, :icon, :route, :isSystem, :status, :sortOrder, cast(:attributes as jsonb), clock_timestamp(), clock_timestamp())
                on conflict (code) do update
                set name = excluded.name,
                    description = excluded.description,
                    version = excluded.version,
                    icon = excluded.icon,
                    route = excluded.route,
                    sort_order = excluded.sort_order,
                    attributes = excluded.attributes,
                    modified_at = clock_timestamp()
                """)
                .param("code", module.code())
                .param("name", module.name())
                .param("description", module.description())
                .param("version", module.version())
                .param("icon", module.icon())
                .param("route", module.route())
                .param("isSystem", module.isSystem())
                .param("status", module.status())
                .param("sortOrder", module.sortOrder())
                .param("attributes", attrsJson)
                .update();
    }

    private InstalledModuleRecord mapModule(ResultSet rs, int rowNum) throws SQLException {
        Map<String, Object> attributes = parseJson(rs.getString("attributes_str"));
        return new InstalledModuleRecord(
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("version"),
                rs.getString("icon"),
                rs.getString("route"),
                rs.getBoolean("is_system"),
                rs.getString("status"),
                rs.getInt("sort_order"),
                attributes,
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
