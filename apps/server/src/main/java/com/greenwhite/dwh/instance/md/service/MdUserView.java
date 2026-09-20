package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.instance.md.repository.MdUserRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Безопасная проекция пользователя для API-ответов.
 * Репозиторная запись (UserRecord) наружу не отдаётся НИКОГДА:
 * она содержит password_hash (утечка обнаружена live-проверкой 2026-08-28).
 */
public record MdUserView(
        Long id,
        String name,
        String login,
        String email,
        String phone,
        String state,
        Long managerId,
        String language,
        String timezone,
        UUID avatarFileId,
        Map<String, Object> attributes,
        boolean is2faEnabled,
        boolean forcePasswordChange,
        List<Long> roleIds,
        Instant createdAt,
        Instant modifiedAt
) {
    public static MdUserView from(MdUserRepository.UserRecord u, List<Long> roleIds) {
        return new MdUserView(
                u.id(), u.name(), u.login(), u.email(), u.phone(), u.state(),
                u.managerId(), u.language(), u.timezone(), u.avatarFileId(),
                u.attributes(), u.is2faEnabled(), u.forcePasswordChange(),
                roleIds != null ? roleIds : List.of(),
                u.createdAt(), u.modifiedAt());
    }

    public static MdUserView from(MdUserRepository.UserRecord u) {
        return from(u, List.of());
    }

    public static MdUserView from(MdUserService.AuthUser u) {
        return from(u, List.of());
    }

    public static MdUserView from(MdUserService.AuthUser u, List<Long> roleIds) {
        return new MdUserView(
                u.id(), u.name(), u.login(), u.email(), u.phone(), u.state(),
                u.managerId(), u.language(), u.timezone(), u.avatarFileId(),
                u.attributes(), u.is2faEnabled(), u.forcePasswordChange(),
                roleIds != null ? roleIds : List.of(),
                u.createdAt(), u.modifiedAt());
    }
}

