package com.greenwhite.dwh.instance.md.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Repository
public class MdRoleRepository {

    private final JdbcClient jdbcClient;

    public MdRoleRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public RoleRecord create(String name, String pcode, String state, int orderNo) {
        return jdbcClient.sql("""
                insert into md_roles (name, pcode, state, order_no, created_at, modified_at)
                values (:name, :pcode, :state, :orderNo, now(), now())
                returning id, name, pcode, state, order_no, created_at, modified_at
                """)
                .param("name", name)
                .param("pcode", pcode)
                .param("state", state != null ? state : "A")
                .param("orderNo", orderNo)
                .query((rs, rowNum) -> new RoleRecord(
                        rs.getLong("id"),
                        rs.getString("name"),
                        rs.getString("pcode"),
                        rs.getString("state"),
                        rs.getInt("order_no"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("modified_at").toInstant()
                ))
                .single();
    }

    public Optional<RoleRecord> findById(Long id) {
        return jdbcClient.sql("""
                select id, name, pcode, state, order_no, created_at, modified_at
                from md_roles
                where id = :id
                """)
                .param("id", id)
                .query((rs, rowNum) -> new RoleRecord(
                        rs.getLong("id"),
                        rs.getString("name"),
                        rs.getString("pcode"),
                        rs.getString("state"),
                        rs.getInt("order_no"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("modified_at").toInstant()
                ))
                .optional();
    }

    public Optional<RoleRecord> findByPcode(String pcode) {
        return jdbcClient.sql("""
                select id, name, pcode, state, order_no, created_at, modified_at
                from md_roles
                where pcode = :pcode
                """)
                .param("pcode", pcode)
                .query((rs, rowNum) -> new RoleRecord(
                        rs.getLong("id"),
                        rs.getString("name"),
                        rs.getString("pcode"),
                        rs.getString("state"),
                        rs.getInt("order_no"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("modified_at").toInstant()
                ))
                .optional();
    }

    public List<RoleRecord> listRoles() {
        return jdbcClient.sql("""
                select id, name, pcode, state, order_no, created_at, modified_at
                from md_roles
                order by order_no asc, id asc
                """)
                .query((rs, rowNum) -> new RoleRecord(
                        rs.getLong("id"),
                        rs.getString("name"),
                        rs.getString("pcode"),
                        rs.getString("state"),
                        rs.getInt("order_no"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("modified_at").toInstant()
                ))
                .list();
    }

    public void update(Long id, String name, String state, int orderNo) {
        jdbcClient.sql("""
                update md_roles
                set name = :name, state = :state, order_no = :orderNo, modified_at = now()
                where id = :id
                """)
                .param("id", id)
                .param("name", name)
                .param("state", state)
                .param("orderNo", orderNo)
                .update();
    }

    public void delete(Long id) {
        jdbcClient.sql("delete from md_roles where id = :id").param("id", id).update();
    }

    public Set<String> getRolePermissions(Long roleId) {
        return jdbcClient.sql("""
                select form_code || '.' || action as perm
                from md_role_permissions
                where role_id = :roleId
                """)
                .param("roleId", roleId)
                .query(String.class)
                .set();
    }

    public void replaceRolePermissions(Long roleId, List<PermissionPair> permissions) {
        jdbcClient.sql("delete from md_role_permissions where role_id = :roleId")
                .param("roleId", roleId)
                .update();

        for (PermissionPair perm : permissions) {
            jdbcClient.sql("""
                    insert into md_role_permissions (role_id, form_code, action)
                    values (:roleId, :formCode, :action)
                    """)
                    .param("roleId", roleId)
                    .param("formCode", perm.formCode())
                    .param("action", perm.action())
                    .update();
        }
    }

    public List<Long> getUserRoleIds(Long userId) {
        return jdbcClient.sql("select role_id from md_user_roles where user_id = :userId")
                .param("userId", userId)
                .query(Long.class)
                .list();
    }

    public List<Long> getUserIdsByRole(Long roleId) {
        return jdbcClient.sql("select user_id from md_user_roles where role_id = :roleId")
                .param("roleId", roleId)
                .query(Long.class)
                .list();
    }


    public java.util.Map<Long, List<Long>> getUsersRoleIds(List<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) return java.util.Map.of();
        java.util.Map<Long, List<Long>> map = new java.util.HashMap<>();
        for (Long id : userIds) {
            map.put(id, new java.util.ArrayList<>());
        }
        String inSql = String.join(",", java.util.Collections.nCopies(userIds.size(), "?"));
        jdbcClient.sql("select user_id, role_id from md_user_roles where user_id in (" + inSql + ")")
                .params(userIds.toArray())
                .query((rs, rowNum) -> {
                    Long uid = rs.getLong("user_id");
                    Long rid = rs.getLong("role_id");
                    map.computeIfAbsent(uid, k -> new java.util.ArrayList<>()).add(rid);
                    return null;
                });
        return map;
    }

    public void assignRolesToUser(Long userId, List<Long> roleIds) {
        jdbcClient.sql("delete from md_user_roles where user_id = :userId")
                .param("userId", userId)
                .update();

        if (roleIds != null) {
            for (Long roleId : roleIds) {
                jdbcClient.sql("insert into md_user_roles (user_id, role_id) values (:userId, :roleId)")
                        .param("userId", userId)
                        .param("roleId", roleId)
                        .update();
            }
        }
    }

    public java.util.Map<Long, Integer> countUsersPerRole() {
        return jdbcClient.sql("""
                select role_id, count(*) as cnt
                from md_user_roles ur
                join md_users u on u.id = ur.user_id and u.state = 'A'
                group by role_id
                """)
                .query((rs, rowNum) -> java.util.Map.entry(rs.getLong("role_id"), rs.getInt("cnt")))
                .list()
                .stream()
                .collect(Collectors.toMap(java.util.Map.Entry::getKey, java.util.Map.Entry::getValue));
    }

    public record RoleRecord(
            Long id,
            String name,
            String pcode,
            String state,
            int orderNo,
            Instant createdAt,
            Instant modifiedAt
    ) {}

    public record PermissionPair(
            String formCode,
            String action
    ) {}
}
