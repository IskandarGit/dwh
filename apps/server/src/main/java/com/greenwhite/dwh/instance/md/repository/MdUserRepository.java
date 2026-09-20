package com.greenwhite.dwh.instance.md.repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class MdUserRepository {

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public MdUserRepository(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public UserRecord create(UserCreateData data, Long createdBy) {
        String attributesJson = toJson(data.attributes());

        return jdbcClient.sql("""
                insert into md_users (name, login, email, phone, password_hash, state, manager_id,
                                     language, timezone, avatar_file_id, attributes, is_2fa_enabled,
                                     force_password_change, created_at, modified_at, created_by, modified_by)
                values (:name, :login, :email, :phone, :passwordHash, :state, :managerId,
                        :language, :timezone, :avatarFileId, cast(:attributes as jsonb), :is2faEnabled,
                        :forcePasswordChange, now(), now(), :createdBy, :createdBy)
                returning id, name, login, email, phone, password_hash, state, manager_id, language, timezone,
                          avatar_file_id, attributes::text as attributes_str, is_2fa_enabled, force_password_change,
                          password_changed_at, created_at, modified_at, created_by, modified_by, auth_version
                """)
                .param("name", data.name())
                .param("login", data.login().toLowerCase().trim())
                .param("email", data.email().toLowerCase().trim())
                .param("phone", data.phone())
                .param("passwordHash", data.passwordHash())
                .param("state", data.state() != null ? data.state() : "A")
                .param("managerId", data.managerId())
                .param("language", data.language() != null ? data.language() : "ru")
                .param("timezone", data.timezone() != null ? data.timezone() : "UTC")
                .param("avatarFileId", data.avatarFileId())
                .param("attributes", attributesJson)
                .param("is2faEnabled", data.is2faEnabled())
                .param("forcePasswordChange", data.forcePasswordChange())
                .param("createdBy", createdBy)
                .query(this::mapUser)
                .single();
    }

    public Optional<UserRecord> findById(Long id) {
        return jdbcClient.sql("""
                select id, name, login, email, phone, password_hash, state, manager_id, language, timezone,
                       avatar_file_id, attributes::text as attributes_str, is_2fa_enabled, force_password_change,
                       password_changed_at, created_at, modified_at, created_by, modified_by, auth_version
                from md_users
                where id = :id
                """)
                .param("id", id)
                .query(this::mapUser)
                .optional();
    }

    public Optional<UserRecord> findByLoginOrEmail(String identifier) {
        String clean = identifier.toLowerCase().trim();
        return jdbcClient.sql("""
                select id, name, login, email, phone, password_hash, state, manager_id, language, timezone,
                       avatar_file_id, attributes::text as attributes_str, is_2fa_enabled, force_password_change,
                       password_changed_at, created_at, modified_at, created_by, modified_by, auth_version
                from md_users
                where login = :ident or email = :ident
                """)
                .param("ident", clean)
                .query(this::mapUser)
                .optional();
    }

    public Optional<UserRecord> findByLogin(String login) {
        return findByLoginOrEmail(login);
    }

    public Optional<UserRecord> findByEmail(String email) {
        return jdbcClient.sql("""
                select id, name, login, email, phone, password_hash, state, manager_id, language, timezone,
                       avatar_file_id, attributes::text as attributes_str, is_2fa_enabled, force_password_change,
                       password_changed_at, created_at, modified_at, created_by, modified_by, auth_version
                from md_users
                where email = :email
                """)
                .param("email", email.toLowerCase().trim())
                .query(this::mapUser)
                .optional();
    }

    public boolean existsByLogin(String login) {
        return jdbcClient.sql("select count(*) from md_users where login = :login")
                .param("login", login.toLowerCase().trim())
                .query(Integer.class)
                .single() > 0;
    }

    public boolean existsByEmail(String email) {
        return jdbcClient.sql("select count(*) from md_users where email = :email")
                .param("email", email.toLowerCase().trim())
                .query(Integer.class)
                .single() > 0;
    }

    public boolean existsByPhone(String phone) {
        if (phone == null || phone.isBlank()) return false;
        return jdbcClient.sql("select count(*) from md_users where phone = :phone and state = 'A'")
                .param("phone", phone.trim())
                .query(Integer.class)
                .single() > 0;
    }

    public void anonymizeUser(Long userId, Long modifiedBy) {
        jdbcClient.sql("""
                update md_users
                set name = 'Deleted User ' || :userId,
                    login = 'deleted_' || :userId,
                    email = 'deleted_' || :userId || '@anonymized.local',
                    phone = null,
                    password_hash = 'ANONYMIZED',
                    avatar_file_id = null,
                    attributes = '{}'::jsonb,
                    state = 'P',
                    modified_at = now(),
                    modified_by = :modifiedBy
                where id = :userId
                """)
                .param("userId", userId)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public List<UserRecord> listUsers(int limit, Long afterId, String search, String state, Long roleId, Long managerId, Boolean is2faEnabled) {
        return listUsers(limit, afterId, search, state, roleId, managerId, is2faEnabled,
                com.greenwhite.dwh.instance.common.security.ScopeFilter.unrestricted());
    }

    /**
     * Тот же список, но ограниченный скоупом данных (ADR-0013).
     * Предикат уходит в SQL, а не фильтрует результат: иначе страница в 50
     * строк после фильтра становится короче, и keyset-пагинация врёт.
     */
    public List<UserRecord> listUsers(int limit, Long afterId, String search, String state, Long roleId,
                                      Long managerId, Boolean is2faEnabled,
                                      com.greenwhite.dwh.instance.common.security.ScopeFilter scope) {
        StringBuilder sql = new StringBuilder("""
                select id, name, login, email, phone, password_hash, state, manager_id, language, timezone,
                       avatar_file_id, attributes::text as attributes_str, is_2fa_enabled, force_password_change,
                       password_changed_at, created_at, modified_at, created_by, modified_by, auth_version
                from md_users
                where 1=1
                """);

        if (afterId != null) {
            sql.append(" and id > :afterId");
        }
        if (state != null && !state.isBlank()) {
            sql.append(" and state = :state");
        }
        if (roleId != null) {
            sql.append(" and exists (select 1 from md_user_roles ur where ur.user_id = md_users.id and ur.role_id = :roleId)");
        }
        if (managerId != null) {
            sql.append(" and manager_id = :managerId");
        }
        if (is2faEnabled != null) {
            sql.append(" and is_2fa_enabled = :is2faEnabled");
        }
        if (search != null && !search.isBlank()) {
            sql.append(" and (name ilike :search or login ilike :search or email ilike :search or phone ilike :search)");
        }

        if (!scope.isUnrestricted()) {
            sql.append(scope.sql());
        }

        sql.append(" order by id asc limit :limit");

        var query = jdbcClient.sql(sql.toString())
                .param("limit", limit);

        if (afterId != null) {
            query.param("afterId", afterId);
        }
        if (state != null && !state.isBlank()) {
            query.param("state", state);
        }
        if (roleId != null) {
            query.param("roleId", roleId);
        }
        if (managerId != null) {
            query.param("managerId", managerId);
        }
        if (is2faEnabled != null) {
            query.param("is2faEnabled", is2faEnabled);
        }
        if (search != null && !search.isBlank()) {
            query.param("search", "%" + search.trim() + "%");
        }
        if (scope.bindsUserId()) {
            query.param("scopeUserId", scope.userId());
        }

        return query.query(this::mapUser).list();
    }

    public List<UserRecord> listUsers(int limit, Long afterId, String search, String state) {
        return listUsers(limit, afterId, search, state, null, null, null);
    }


    public boolean compareAndSetPassword(Long userId, long expectedAuthVersion,
                                         String expectedPasswordHash, String newPasswordHash) {
        return jdbcClient.sql("""
                update md_users
                set password_hash = :newPasswordHash, password_changed_at = now(),
                    force_password_change = false, modified_at = now()
                where id = :userId and state = 'A' and auth_version = :expectedAuthVersion
                  and password_hash is not distinct from :expectedPasswordHash
                """)
                .param("userId", userId)
                .param("expectedAuthVersion", expectedAuthVersion)
                .param("expectedPasswordHash", expectedPasswordHash)
                .param("newPasswordHash", newPasswordHash)
                .update() == 1;
    }

    /** The global access invalidator owns the sole increment; overflow must fail the transaction. */
    public void incrementAuthenticationVersion(Long userId) {
        int changed = jdbcClient.sql("update md_users set auth_version = auth_version + 1 where id = :userId")
                .param("userId", userId).update();
        if (changed != 1) throw com.greenwhite.dwh.instance.common.error.ApiException.invalidCredentials();
    }

    public void updatePassword(Long userId, String newPasswordHash) {
        jdbcClient.sql("""
                update md_users
                set password_hash = :passwordHash, password_changed_at = now(),
                    force_password_change = false, modified_at = now()
                where id = :userId
                """)
                .param("userId", userId)
                .param("passwordHash", newPasswordHash)
                .update();
    }

    public void setState(Long userId, String state, Long modifiedBy) {
        jdbcClient.sql("""
                update md_users
                set state = :state, modified_at = now(), modified_by = :modifiedBy
                where id = :userId
                """)
                .param("userId", userId)
                .param("state", state)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public void updateLanguage(Long userId, String language, Long modifiedBy) {
        jdbcClient.sql("""
                update md_users
                set language = :language, modified_at = now(), modified_by = :modifiedBy
                where id = :userId
                """)
                .param("userId", userId)
                .param("language", language)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public void setForcePasswordChange(Long userId, boolean force, Long modifiedBy) {
        jdbcClient.sql("""
                update md_users
                set force_password_change = :force, modified_at = now(), modified_by = :modifiedBy
                where id = :userId
                """)
                .param("userId", userId)
                .param("force", force)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public void set2faEnabled(Long userId, boolean enabled, Long modifiedBy) {
        jdbcClient.sql("""
                update md_users
                set is_2fa_enabled = :enabled, modified_at = now(), modified_by = :modifiedBy
                where id = :userId
                """)
                .param("userId", userId)
                .param("enabled", enabled)
                .param("modifiedBy", modifiedBy)
                .update();
    }

    public void update(Long userId, UserUpdateData data, Long modifiedBy) {
        String attributesJson = data.attributes() != null ? toJson(data.attributes()) : null;

        jdbcClient.sql("""
                update md_users
                set name = coalesce(:name, name),
                    phone = coalesce(:phone, phone),
                    manager_id = coalesce(cast(:managerId as bigint), manager_id),
                    language = coalesce(:language, language),
                    timezone = coalesce(:timezone, timezone),
                    avatar_file_id = coalesce(cast(:avatarFileId as uuid), avatar_file_id),
                    attributes = coalesce(cast(:attributes as jsonb), attributes),
                    is_2fa_enabled = coalesce(cast(:is2faEnabled as boolean), is_2fa_enabled),
                    modified_at = now(),
                    modified_by = :modifiedBy
                where id = :userId


                """)
                .param("userId", userId)
                .param("name", data.name())
                .param("phone", data.phone())
                .param("managerId", data.managerId())
                .param("language", data.language())
                .param("timezone", data.timezone())
                .param("avatarFileId", data.avatarFileId())
                .param("attributes", attributesJson)
                .param("is2faEnabled", data.is2faEnabled())
                .param("modifiedBy", modifiedBy)
                .update();
    }

    private UserRecord mapUser(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        Map<String, Object> attrs = parseJson(rs.getString("attributes_str"));
        return new UserRecord(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("login"),
                rs.getString("email"),
                rs.getString("phone"),
                rs.getString("password_hash"),
                rs.getString("state"),
                rs.getObject("manager_id") != null ? rs.getLong("manager_id") : null,
                rs.getString("language"),
                rs.getString("timezone"),
                rs.getObject("avatar_file_id") != null ? UUID.fromString(rs.getString("avatar_file_id")) : null,
                attrs,
                rs.getBoolean("is_2fa_enabled"),
                rs.getBoolean("force_password_change"),
                rs.getTimestamp("password_changed_at") != null ? rs.getTimestamp("password_changed_at").toInstant() : null,
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("modified_at").toInstant(),
                rs.getObject("created_by") != null ? rs.getLong("created_by") : null,
                rs.getObject("modified_by") != null ? rs.getLong("modified_by") : null,
                rs.getLong("auth_version")
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

    /** Сколько АКТИВНЫХ пользователей имеют указанную роль (защита последнего админа). */
    public int countUsersWithRole(Long roleId) {
        return jdbcClient.sql("""
                        select count(*) from md_user_roles ur
                        join md_users u on u.id = ur.user_id and u.state = 'A'
                        where ur.role_id = :roleId
                        """)
                .param("roleId", roleId)
                .query(Integer.class)
                .single();
    }

    public record UserRecord(
            Long id,
            String name,
            String login,
            String email,
            String phone,
            String passwordHash,
            String state,
            Long managerId,
            String language,
            String timezone,
            UUID avatarFileId,
            Map<String, Object> attributes,
            boolean is2faEnabled,
            boolean forcePasswordChange,
            Instant passwordChangedAt,
            Instant createdAt,
            Instant modifiedAt,
            Long createdBy,
            Long modifiedBy,
            @com.fasterxml.jackson.annotation.JsonIgnore long authenticationVersion
    ) {}

    public record UserCreateData(
            String name,
            String login,
            String email,
            String phone,
            String passwordHash,
            String state,
            Long managerId,
            String language,
            String timezone,
            UUID avatarFileId,
            Map<String, Object> attributes,
            boolean is2faEnabled,
            boolean forcePasswordChange
    ) {}

    public record UserUpdateData(
            String name,
            String phone,
            Long managerId,
            String language,
            String timezone,
            UUID avatarFileId,
            Map<String, Object> attributes,
            Boolean is2faEnabled
    ) {}
}
