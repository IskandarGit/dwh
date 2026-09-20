package com.greenwhite.dwh.instance.md.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Оргструктура экземпляра — дерево произвольной глубины (ADR-0013).
 * Один корень на экземпляр: экземпляр принадлежит одному клиенту (ADR-0004).
 */
@Repository
public class MdOrgUnitRepository {

    private final JdbcClient jdbcClient;

    public MdOrgUnitRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public OrgUnitRecord create(Long parentId, String code, String name, String kind, int orderNo) {
        return jdbcClient.sql("""
                        insert into md_org_units (parent_id, code, name, kind, state, order_no)
                        values (:parentId, :code, :name, :kind, 'A', :orderNo)
                        returning id, parent_id, code, name, kind, state, order_no, created_at, modified_at
                        """)
                .param("parentId", parentId)
                .param("code", code)
                .param("name", name)
                .param("kind", kind)
                .param("orderNo", orderNo)
                .query(this::map)
                .single();
    }

    public void update(Long id, Long parentId, String name, String kind, String state, int orderNo) {
        jdbcClient.sql("""
                        update md_org_units
                        set parent_id = :parentId, name = :name, kind = :kind,
                            state = :state, order_no = :orderNo, modified_at = now()
                        where id = :id
                        """)
                .param("id", id)
                .param("parentId", parentId)
                .param("name", name)
                .param("kind", kind)
                .param("state", state)
                .param("orderNo", orderNo)
                .update();
    }

    public void delete(Long id) {
        jdbcClient.sql("delete from md_org_units where id = :id").param("id", id).update();
    }

    public Optional<OrgUnitRecord> findById(Long id) {
        return jdbcClient.sql("""
                        select id, parent_id, code, name, kind, state, order_no, created_at, modified_at
                        from md_org_units where id = :id
                        """)
                .param("id", id)
                .query(this::map)
                .optional();
    }

    public List<OrgUnitRecord> listAll() {
        return jdbcClient.sql("""
                        select id, parent_id, code, name, kind, state, order_no, created_at, modified_at
                        from md_org_units
                        order by coalesce(parent_id, 0), order_no, id
                        """)
                .query(this::map)
                .list();
    }

    public boolean hasRoot() {
        return jdbcClient.sql("select count(*) from md_org_units where parent_id is null")
                .query(Long.class).single() > 0;
    }

    public boolean existsByCode(String code) {
        return jdbcClient.sql("select exists (select 1 from md_org_units where code = :code)")
                .param("code", code).query(Boolean.class).single();
    }

    public boolean hasChildren(Long id) {
        return jdbcClient.sql("select count(*) from md_org_units where parent_id = :id")
                .param("id", id)
                .query(Long.class).single() > 0;
    }

    public boolean isAssignedToUsers(Long id) {
        return jdbcClient.sql("""
                        select (select count(*) from md_user_org_units where org_unit_id = :id)
                             + (select count(*) from md_users where org_unit_id = :id)
                        """)
                .param("id", id)
                .query(Long.class).single() > 0;
    }

    /**
     * Является ли {@code candidateParentId} потомком {@code nodeId}.
     *
     * Декларативно цикл длиннее одного шага в PostgreSQL запретить нечем,
     * поэтому проверка живёт здесь. Без неё перенос узла под собственного
     * потомка отрезает всю ветку от корня — молча, без ошибки.
     */
    public boolean isDescendant(Long nodeId, Long candidateParentId) {
        if (nodeId == null || candidateParentId == null) {
            return false;
        }
        return jdbcClient.sql("""
                        with recursive subtree as (
                            select id from md_org_units where id = :nodeId
                            union
                            select c.id from md_org_units c join subtree s on c.parent_id = s.id
                        )
                        select count(*) from subtree where id = :candidateId
                        """)
                .param("nodeId", nodeId)
                .param("candidateId", candidateParentId)
                .query(Long.class).single() > 0;
    }

    private OrgUnitRecord map(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        Long parentId = rs.getObject("parent_id") != null ? rs.getLong("parent_id") : null;
        return new OrgUnitRecord(
                rs.getLong("id"),
                parentId,
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("kind"),
                rs.getString("state"),
                rs.getInt("order_no"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("modified_at").toInstant()
        );
    }

    public record OrgUnitRecord(
            Long id,
            Long parentId,
            String code,
            String name,
            String kind,
            String state,
            int orderNo,
            Instant createdAt,
            Instant modifiedAt
    ) {}
}
