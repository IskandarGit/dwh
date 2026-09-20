package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.pagination.CursorUtils;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class MdUserService {

    private final MdUserRepository userRepository;
    private final MdRoleRepository roleRepository;
    private final MdCustomFieldService customFieldService;
    private final PasswordHasher passwordHasher;
    private final PasswordValidator passwordValidator;
    private final UserSessionInvalidator sessionInvalidator;
    private final com.greenwhite.dwh.instance.search.SearchChangePublisher searchChangePublisher;
    private final com.greenwhite.dwh.instance.audit.service.AuditLogService auditLogService;
    private final MdScopeService scopeService;

    public MdUserService(
            MdUserRepository userRepository,
            MdRoleRepository roleRepository,
            MdCustomFieldService customFieldService,
            PasswordHasher passwordHasher,
            PasswordValidator passwordValidator,
            UserSessionInvalidator sessionInvalidator,
            com.greenwhite.dwh.instance.search.SearchChangePublisher searchChangePublisher,
            com.greenwhite.dwh.instance.audit.service.AuditLogService auditLogService,
            MdScopeService scopeService) {
        this.sessionInvalidator = sessionInvalidator;
        this.scopeService = scopeService;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.customFieldService = customFieldService;
        this.passwordHasher = passwordHasher;
        this.passwordValidator = passwordValidator;
        this.searchChangePublisher = searchChangePublisher;
        this.auditLogService = auditLogService;
    }



    @Transactional
    public MdUserRepository.UserRecord createUser(
            String name, String login, String email, String phone, String rawPassword,
            Long managerId, String language, String timezone, UUID avatarFileId,
            Map<String, Object> attributes, boolean is2faEnabled, boolean forcePasswordChange,
            List<Long> roleIds, Long createdBy) {

        scopeService.acquireMutationLock();
        if (userRepository.existsByLogin(login)) {
            throw ApiException.conflict(ErrorCode.CODE_ALREADY_EXISTS, "Пользователь с таким логином уже существует");
        }
        if (userRepository.existsByEmail(email)) {
            throw ApiException.conflict(ErrorCode.CODE_ALREADY_EXISTS, "Пользователь с таким email уже существует");
        }
        if (phone != null && !phone.isBlank() && userRepository.existsByPhone(phone)) {
            throw ApiException.conflict(ErrorCode.CODE_ALREADY_EXISTS, "Активный пользователь с таким номером телефона уже существует");
        }

        // FR-USR-2: Password complexity & dictionary check
        if (rawPassword != null && !rawPassword.isBlank()) {
            passwordValidator.validate(rawPassword, login);
        }

        // Validate custom dynamic fields
        customFieldService.validateAttributes("USER", attributes);

        String passwordHash = rawPassword != null && !rawPassword.isBlank()
                ? passwordHasher.hashPassword(rawPassword)
                : null;

        var user = userRepository.create(new MdUserRepository.UserCreateData(
                name, login, email, phone, passwordHash, MdPref.STATE_ACTIVE,
                managerId, language, timezone, avatarFileId, attributes, is2faEnabled, forcePasswordChange
        ), createdBy);

        if (roleIds != null && !roleIds.isEmpty()) {
            roleRepository.assignRolesToUser(user.id(), roleIds);
        } else {
            // Assign default 'user' role
            roleRepository.findByPcode(MdPref.ROLE_USER).ifPresent(r ->
                    roleRepository.assignRolesToUser(user.id(), List.of(r.id()))
            );
        }

        scopeService.recalculateFor(user.id());

        searchChangePublisher.changed("USER", user.id());

        auditLogService.logChange("md_users", String.valueOf(user.id()), "I",
                List.of("name", "login", "email", "phone"),
                null,
                Map.of("id", user.id(), "name", name, "login", login, "email", email));

        return user;
    }

    @Transactional
    public MdUserRepository.UserRecord createUser(
            String name, String login, String email, String phone, String rawPassword,
            Long managerId, String language, String timezone, UUID avatarFileId,
            Map<String, Object> attributes, boolean is2faEnabled, List<Long> roleIds, Long createdBy) {
        return createUser(name, login, email, phone, rawPassword, managerId, language, timezone,
                avatarFileId, attributes, is2faEnabled, false, roleIds, createdBy);
    }

    @Transactional(readOnly = true)
    public MdUserRepository.UserRecord getUserById(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.USER_NOT_FOUND, "Пользователь не найден"));
    }

    @Transactional(readOnly = true)
    public KeysetPage<MdUserRepository.UserRecord> listUsers(
            int limit, String cursor, String search, String state, Long roleId, Long managerId, Boolean is2faEnabled) {
        Long afterId = null;
        if (cursor != null && !cursor.isBlank()) {
            String decoded = CursorUtils.decode(cursor);
            if (decoded != null) {
                try {
                    afterId = Long.parseLong(decoded);
                } catch (NumberFormatException ignored) {}
            }
        }

        int fetchLimit = limit + 1;
        // ADR-0013: список ограничивается скоупом текущего пользователя.
        // Для правила ALL — а его сегодня имеют все роли — предикат пуст
        // и запрос не меняется ни на символ.
        var scope = scopeService.filterFor(
                com.greenwhite.dwh.instance.common.security.SecurityContext.getCurrentUserId(),
                "md_users.org_unit_id", "md_users.id");

        List<MdUserRepository.UserRecord> users = userRepository.listUsers(
                fetchLimit, afterId, search, state, roleId, managerId, is2faEnabled, scope);

        boolean hasMore = users.size() > limit;
        List<MdUserRepository.UserRecord> resultItems = hasMore ? users.subList(0, limit) : users;

        String nextCursor = null;
        if (hasMore && !resultItems.isEmpty()) {
            Long lastId = resultItems.get(resultItems.size() - 1).id();
            nextCursor = CursorUtils.encode(String.valueOf(lastId));
        }

        return KeysetPage.of(resultItems, nextCursor, hasMore, resultItems.size());
    }

    @Transactional(readOnly = true)
    public KeysetPage<MdUserRepository.UserRecord> listUsers(int limit, String cursor, String search, String state) {
        return listUsers(limit, cursor, search, state, null, null, null);
    }


    @Transactional(readOnly = true)
    public List<Long> getUserRoleIds(Long userId) {
        return roleRepository.getUserRoleIds(userId);
    }

    @Transactional(readOnly = true)
    public Map<Long, List<Long>> getUsersRoleIds(List<Long> userIds) {
        return roleRepository.getUsersRoleIds(userIds);
    }

    @Transactional
    public void updateUser(Long userId, String name, String phone, Long managerId,
                           String language, String timezone, UUID avatarFileId,
                           Map<String, Object> attributes, Boolean is2faEnabled,
                           List<Long> roleIds, Long modifiedBy) {

        if (roleIds != null) {
            scopeService.acquireMutationLock();
        }
        var existingUser = getUserById(userId);

        if (phone != null && !phone.isBlank() && !phone.equals(existingUser.phone())) {
            if (userRepository.existsByPhone(phone)) {
                throw ApiException.conflict(ErrorCode.CODE_ALREADY_EXISTS, "Активный пользователь с таким номером телефона уже существует");
            }
        }

        if (attributes != null) {
            customFieldService.validateAttributes("USER", attributes);
        }

        userRepository.update(userId, new MdUserRepository.UserUpdateData(
                name, phone, managerId, language, timezone, avatarFileId, attributes, is2faEnabled
        ), modifiedBy);

        if (roleIds != null) {
            // I-IAM-1: Нельзя снять роль администратора с системного администратора admin
            if (existingUser.login().equalsIgnoreCase("admin")) {
                roleRepository.findByPcode(MdPref.ROLE_ADMIN).ifPresent(adminRole -> {
                    if (!roleIds.contains(adminRole.id())) {
                        throw ApiException.conflict(ErrorCode.SUPERADMIN_IMMUTABLE, "Роль администратора не может быть снята с системного администратора");
                    }
                });
            }
            roleRepository.assignRolesToUser(userId, roleIds);
            scopeService.recalculateFor(userId);
        }

        searchChangePublisher.changed("USER", userId);

        auditLogService.logChange("md_users", String.valueOf(userId), "U",
                List.of("name", "phone", "language", "timezone"),
                Map.of("name", existingUser.name(), "phone", existingUser.phone() != null ? existingUser.phone() : ""),
                Map.of("name", name != null ? name : existingUser.name(), "phone", phone != null ? phone : ""));
    }


    @Transactional
    public void changePassword(Long userId, long authenticatedVersion, String oldPassword, String newPassword) {
        var user = getUserById(userId);

        if (!MdPref.STATE_ACTIVE.equals(user.state()) || user.authenticationVersion() != authenticatedVersion) {
            throw ApiException.invalidCredentials();
        }

        if (user.passwordHash() != null && !passwordHasher.verifyPassword(oldPassword, user.passwordHash())) {
            throw ApiException.badRequest(ErrorCode.INVALID_CREDENTIALS, "Неверный текущий пароль");
        }

        passwordValidator.validate(newPassword, user.login());

        String newHash = passwordHasher.hashPassword(newPassword);
        if (!userRepository.compareAndSetPassword(userId, authenticatedVersion, user.passwordHash(), newHash)) {
            throw ApiException.invalidCredentials();
        }
        sessionInvalidator.invalidateAllAccess(userId);

        auditLogService.logSecurityEvent("PASSWORD_CHANGED", userId, null, null, Map.of("login", user.login()));
    }


    @Transactional
    public void setUserState(Long targetUserId, String newState, Long currentUserId) {
        var targetUser = getUserById(targetUserId);

        // Immutable Superadmin Protection: Admin user cannot be blocked (TRD-01 / I-IAM-1)
        if (targetUser.login().equalsIgnoreCase("admin") && MdPref.STATE_PASSIVE.equals(newState)) {
            throw ApiException.conflict(ErrorCode.SUPERADMIN_IMMUTABLE, "Системный администратор не может быть заблокирован");
        }

        userRepository.setState(targetUserId, newState, currentUserId);

        // I-U1 (FR-USR-4): блокировка атомарно закрывает сессии и отзывает токены —
        // в ТОЙ ЖЕ транзакции, никаких «окон», когда state=P, а сессия жива.
        if (MdPref.STATE_PASSIVE.equals(newState)) {
            sessionInvalidator.invalidateAllAccess(targetUserId);
        }

        searchChangePublisher.changed("USER", targetUserId);

        auditLogService.logChange("md_users", String.valueOf(targetUserId), "U",
                List.of("state"),
                Map.of("state", targetUser.state()),
                Map.of("state", newState));
    }

    @Transactional
    public void setForcePasswordChange(Long targetUserId, boolean force, Long currentUserId) {
        var targetUser = getUserById(targetUserId);
        userRepository.setForcePasswordChange(targetUserId, force, currentUserId);
        if (force) {
            sessionInvalidator.invalidateAllAccess(targetUserId);
        }
        searchChangePublisher.changed("USER", targetUserId);
        auditLogService.logChange("md_users", String.valueOf(targetUserId), "U",
                List.of("force_password_change"),
                Map.of("force_password_change", targetUser.forcePasswordChange()),
                Map.of("force_password_change", force));
    }

    @Transactional
    public void reset2fa(Long targetUserId, Long currentUserId) {
        var targetUser = getUserById(targetUserId);
        userRepository.set2faEnabled(targetUserId, false, currentUserId);
        sessionInvalidator.invalidateAllAccess(targetUserId);
        searchChangePublisher.changed("USER", targetUserId);
        auditLogService.logChange("md_users", String.valueOf(targetUserId), "U",
                List.of("is_2fa_enabled"),
                Map.of("is_2fa_enabled", targetUser.is2faEnabled()),
                Map.of("is_2fa_enabled", false));
    }

    @Transactional
    public void anonymizeUser(Long targetUserId, Long currentUserId) {
        var targetUser = getUserById(targetUserId);

        // I-IAM-1: Системный администратор не может быть удалён или анонимизирован
        if (targetUser.login().equalsIgnoreCase("admin")) {
            throw ApiException.conflict(ErrorCode.SUPERADMIN_IMMUTABLE, "Системный администратор не может быть удалён");
        }

        // FR-USR-8: Анонимизация ПДн с сохранением реляционной целостности для аудита
        userRepository.anonymizeUser(targetUserId, currentUserId);

        // Закрытие всех сессий и отзыв токенов
        sessionInvalidator.invalidateAllAccess(targetUserId);

        searchChangePublisher.changed("USER", targetUserId);

        auditLogService.logChange("md_users", String.valueOf(targetUserId), "D",
                List.of("state", "name", "email", "phone"),
                Map.of("name", targetUser.name(), "login", targetUser.login()),
                Map.of("name", "Deleted User " + targetUserId, "state", "P"));
    }

    public record AuthUser(
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
            long authenticationVersion,
            Instant createdAt,
            Instant modifiedAt
    ) {
        public static AuthUser from(MdUserRepository.UserRecord u) {
            return new AuthUser(
                    u.id(), u.name(), u.login(), u.email(), u.phone(), u.passwordHash(),
                    u.state(), u.managerId(), u.language(), u.timezone(), u.avatarFileId(),
                    u.attributes(), u.is2faEnabled(), u.forcePasswordChange(),
                    u.authenticationVersion(), u.createdAt(), u.modifiedAt()
            );
        }

        public MdUserView toView(List<Long> roleIds) {
            return new MdUserView(
                    id, name, login, email, phone, state, managerId, language,
                    timezone, avatarFileId, attributes, is2faEnabled, forcePasswordChange,
                    roleIds != null ? roleIds : List.of(), createdAt, modifiedAt
            );
        }

        public MdUserView toView() {
            return toView(List.of());
        }
    }

    @Transactional(readOnly = true)
    public Optional<AuthUser> findAuthUserByLogin(String login) {
        return userRepository.findByLogin(login).map(AuthUser::from);
    }

    @Transactional(readOnly = true)
    public Optional<AuthUser> findAuthUserById(Long userId) {
        return userRepository.findById(userId).map(AuthUser::from);
    }

    @Transactional(readOnly = true)
    public Optional<AuthUser> findAuthUserByEmail(String email) {
        return userRepository.findByEmail(email).map(AuthUser::from);
    }

    @Transactional
    public void setPasswordForReset(Long userId, String newPasswordHash) {
        userRepository.updatePassword(userId, newPasswordHash);
    }

    @Transactional
    public void incrementAuthenticationVersion(Long userId) {
        userRepository.incrementAuthenticationVersion(userId);
    }
}
