package com.greenwhite.dwh.instance.md.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Скоуп данных: правило видимости у роли, позиция пользователя в дереве и
 * материализация эффективного скоупа (ADR-0013).
 *
 * Материализация повторяет механику md_effective_permissions намеренно:
 * проверка «виден ли узел» попадает в каждый запрос списка, а рекурсивный
 * обход дерева на каждый запрос — тот случай, когда правильная модель
 * убивает отзывчивость.
 */
@Repository
public class MdScopeRepository {

    /** Порядок ширины правил: чем больше, тем шире видимость. */
    private static final List<String> RULES_WIDEST_FIRST = List.of("ALL", "SUBTREE", "UNITS", "SELF");

    private final JdbcClient jdbcClient;

    public MdScopeRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    /** Database-local IAM scope writer ordering; released by the caller's transaction. */
    public void lockScopeMutation() {
        jdbcClient.sql("select pg_advisory_xact_lock(129632, 1)")
                .query((rs, rowNum) -> true).single();
    }

    // ------------------------------------------------------------------ роли

    public void setRoleRule(Long roleId, String rule) {
        jdbcClient.sql("""
                        insert into md_role_scope_rules (role_id, rule, modified_at)
                        values (:roleId, :rule, now())
                        on conflict (role_id) do update set rule = excluded.rule, modified_at = now()
                        """)
                .param("roleId", roleId)
                .param("rule", rule)
                .update();
    }

    public String getRoleRule(Long roleId) {
        return jdbcClient.sql("select rule from md_role_scope_rules where role_id = :roleId")
                .param("roleId", roleId)
                .query(String.class)
                .optional()
                .orElse("ALL");
    }

    public boolean roleExists(Long roleId) {
        return jdbcClient.sql("select exists (select 1 from md_roles where id = :roleId)")
                .param("roleId", roleId)
                .query(Boolean.class)
                .single();
    }

    // ----------------------------------------------------------- пользователь

    public Set<Long> getUserOrgUnitIds(Long userId) {
        return Set.copyOf(jdbcClient.sql(
                        "select org_unit_id from md_user_org_units where user_id = :userId order by org_unit_id")
                .param("userId", userId)
                .query(Long.class)
                .list());
    }

    /** Полная замена набора узлов пользователя — та же семантика PUT, что у ролей. */
    public void replaceUserOrgUnits(Long userId, List<Long> orgUnitIds) {
        jdbcClient.sql("delete from md_user_org_units where user_id = :userId")
                .param("userId", userId)
                .update();
        for (Long unitId : orgUnitIds) {
            jdbcClient.sql("""
                            insert into md_user_org_units (user_id, org_unit_id)
                            values (:userId, :unitId)
                            on conflict do nothing
                            """)
                    .param("userId", userId)
                    .param("unitId", unitId)
                    .update();
        }
    }

    public String getUserRule(Long userId) {
        return jdbcClient.sql("select rule from md_user_scope where user_id = :userId")
                .param("userId", userId)
                .query(String.class)
                .optional()
                .orElse("ALL");
    }

    public Set<Long> getEffectiveScope(Long userId) {
        return Set.copyOf(jdbcClient.sql(
                        "select org_unit_id from md_effective_scope where user_id = :userId order by org_unit_id")
                .param("userId", userId)
                .query(Long.class)
                .list());
    }

    // --------------------------------------------------------- материализация

    /**
     * Пересчёт эффективного скоупа. Вызывается в ТОЙ ЖЕ транзакции, что и
     * изменение ролей, позиции или дерева — иначе между изменением и
     * пересчётом существует окно, в котором доступ к данным неверен.
     *
     * @return правило, которое получилось у пользователя
     */
    public String recalculateEffectiveScope(Long userId) {
        String rule = resolveWidestRule(userId);

        jdbcClient.sql("""
                        insert into md_user_scope (user_id, rule, recalculated_at)
                        values (:userId, :rule, now())
                        on conflict (user_id) do update set rule = excluded.rule, recalculated_at = now()
                        """)
                .param("userId", userId)
                .param("rule", rule)
                .update();

        jdbcClient.sql("delete from md_effective_scope where user_id = :userId")
                .param("userId", userId)
                .update();

        // ALL не ограничивает ничего, SELF не опирается на дерево — материализовать нечего.
        switch (rule) {
            case "UNITS" -> jdbcClient.sql("""
                            insert into md_effective_scope (user_id, org_unit_id)
                            select uou.user_id, uou.org_unit_id
                            from md_user_org_units uou
                            join md_org_units u on u.id = uou.org_unit_id and u.state = 'A'
                            where uou.user_id = :userId
                            on conflict do nothing
                            """)
                    .param("userId", userId)
                    .update();

            // Пассивный узел обрывает ветку целиком: узел выключен вместе с тем,
            // что под ним, иначе «выключение филиала» не выключало бы его отделы.
            case "SUBTREE" -> jdbcClient.sql("""
                            with recursive subtree as (
                                select u.id
                                from md_org_units u
                                join md_user_org_units uou on uou.org_unit_id = u.id
                                where uou.user_id = :userId and u.state = 'A'
                                union
                                select c.id
                                from md_org_units c
                                join subtree s on c.parent_id = s.id
                                where c.state = 'A'
                            )
                            insert into md_effective_scope (user_id, org_unit_id)
                            select :userId, id from subtree
                            on conflict do nothing
                            """)
                    .param("userId", userId)
                    .update();

            default -> { /* ALL, SELF — материализация не нужна */ }
        }

        return rule;
    }

    /**
     * Самое широкое правило среди активных ролей пользователя.
     * Роль без явного правила считается ALL: сегодня так ведёт себя весь
     * экземпляр, и сужение должно быть осознанным действием администратора.
     */
    private String resolveWidestRule(Long userId) {
        List<String> rules = jdbcClient.sql("""
                        select coalesce(sr.rule, 'ALL')
                        from md_user_roles ur
                        join md_roles r on r.id = ur.role_id and r.state = 'A'
                        left join md_role_scope_rules sr on sr.role_id = r.id
                        where ur.user_id = :userId
                        """)
                .param("userId", userId)
                .query(String.class)
                .list();

        if (rules.isEmpty()) {
            return "ALL";
        }
        return RULES_WIDEST_FIRST.stream()
                .filter(rules::contains)
                .findFirst()
                .orElse("ALL");
    }

    /** Пользователи роли — кому нужно пересчитать скоуп после смены её правила. */
    public List<Long> getUserIdsByRole(Long roleId) {
        return jdbcClient.sql("select user_id from md_user_roles where role_id = :roleId order by user_id")
                .param("roleId", roleId)
                .query(Long.class)
                .list();
    }

    /** Users assigned to this node, its descendants, or its ancestors (including managers). */
    public List<Long> getUserIdsAffectedByUnit(Long orgUnitId) {
        return jdbcClient.sql("""
                        with recursive subtree as (
                            select id from md_org_units where id = :unitId
                            union
                            select c.id from md_org_units c join subtree s on c.parent_id = s.id
                        ), ancestors as (
                            select id, parent_id from md_org_units where id = :unitId
                            union
                            select p.id, p.parent_id from md_org_units p join ancestors a on p.id = a.parent_id
                        ), affected_units as (
                            select id from subtree
                            union
                            select id from ancestors
                        )
                        select distinct uou.user_id
                        from md_user_org_units uou
                        join affected_units s on s.id = uou.org_unit_id
                        order by uou.user_id
                        """)
                .param("unitId", orgUnitId)
                .query(Long.class)
                .list();
    }

    public Optional<Long> findUserOrgUnit(Long userId) {
        return jdbcClient.sql("select org_unit_id from md_users where id = :userId")
                .param("userId", userId)
                .query(Long.class)
                .optional();
    }

    /** True when at least one target position intersects the viewer's materialized scope. */
    public boolean isUserInEffectiveScope(Long viewerId, Long targetUserId) {
        return jdbcClient.sql("""
                        select exists (
                            select 1
                            from md_users target
                            where target.id = :targetUserId
                              and (
                                   target.org_unit_id in (
                                       select org_unit_id
                                       from md_effective_scope
                                       where user_id = :viewerId
                                   )
                                or exists (
                                       select 1
                                       from md_user_org_units target_uou
                                       join md_effective_scope viewer_scope
                                         on viewer_scope.org_unit_id = target_uou.org_unit_id
                                        and viewer_scope.user_id = :viewerId
                                       where target_uou.user_id = target.id
                                   )
                              )
                        )
                        """)
                .param("viewerId", viewerId)
                .param("targetUserId", targetUserId)
                .query(Boolean.class)
                .single();
    }

    public boolean userExists(Long userId) {
        return jdbcClient.sql("select exists (select 1 from md_users where id = :userId)")
                .param("userId", userId)
                .query(Boolean.class)
                .single();
    }
}
