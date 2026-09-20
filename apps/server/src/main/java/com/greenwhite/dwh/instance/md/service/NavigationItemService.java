package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.repository.NavigationItemRepository;
import com.greenwhite.dwh.instance.md.repository.NavigationItemRepository.NavigationItemRecord;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class NavigationItemService {

    private static final Pattern SAFE_URL_PATTERN = Pattern.compile("^(https?://|/).*", Pattern.CASE_INSENSITIVE);
    private static final Pattern DANGEROUS_SCHEME = Pattern.compile("^(javascript|data|vbscript):.*", Pattern.CASE_INSENSITIVE);

    private final NavigationItemRepository navigationRepository;
    private final AuditLogService auditLogService;

    public NavigationItemService(NavigationItemRepository navigationRepository, AuditLogService auditLogService) {
        this.navigationRepository = navigationRepository;
        this.auditLogService = auditLogService;
    }

    public record NavigationItemView(
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
    ) {
        public static NavigationItemView from(NavigationItemRecord r) {
            return new NavigationItemView(
                    r.id(),
                    r.code(),
                    r.title(),
                    r.titleKey(),
                    r.sectionId(),
                    r.parentId(),
                    r.icon(),
                    r.targetType(),
                    r.url(),
                    r.openInIframe(),
                    r.requiredPermission(),
                    r.sortOrder(),
                    r.state(),
                    r.createdBy(),
                    r.modifiedBy(),
                    r.createdAt(),
                    r.modifiedAt()
            );
        }
    }

    public record CreateNavigationItemCommand(
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
            int sortOrder
    ) {}

    public record UpdateNavigationItemCommand(
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
            String state
    ) {}

    @Transactional(readOnly = true)
    @Cacheable(value = "navigationItems", key = "'all'")
    public List<NavigationItemView> getAllItems() {
        return navigationRepository.findAll().stream().map(NavigationItemView::from).toList();
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "navigationItems", key = "'active'")
    public List<NavigationItemView> getActiveItems() {
        return navigationRepository.findActive().stream().map(NavigationItemView::from).toList();
    }

    @Transactional(readOnly = true)
    public Optional<NavigationItemView> getItemById(Long id) {
        return navigationRepository.findById(id).map(NavigationItemView::from);
    }

    @Transactional(readOnly = true)
    public Optional<NavigationItemView> getItemByCode(String code) {
        return navigationRepository.findByCode(code).map(NavigationItemView::from);
    }

    @Transactional
    @CacheEvict(value = "navigationItems", allEntries = true)
    public NavigationItemView createItem(CreateNavigationItemCommand cmd, Long userId) {
        validateUrl(cmd.url());
        String code = cmd.code().trim().toLowerCase().replaceAll("[^a-z0-9_-]", "-");
        if (code.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Код пункта навигации не может быть пустым");
        }

        if (navigationRepository.findByCode(code).isPresent()) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "Пункт навигации с таким кодом уже существует: " + code);
        }

        NavigationItemRecord record = new NavigationItemRecord(
                null,
                code,
                cmd.title().trim(),
                cmd.titleKey() != null && !cmd.titleKey().isBlank() ? cmd.titleKey().trim() : null,
                cmd.sectionId() != null && !cmd.sectionId().isBlank() ? cmd.sectionId().trim() : "custom",
                cmd.parentId(),
                cmd.icon() != null && !cmd.icon().isBlank() ? cmd.icon().trim() : "bar_chart",
                cmd.targetType() != null && !cmd.targetType().isBlank() ? cmd.targetType().trim() : "EMBEDDED_IFRAME",
                cmd.url().trim(),
                cmd.openInIframe(),
                cmd.requiredPermission() != null && !cmd.requiredPermission().isBlank() ? cmd.requiredPermission().trim() : null,
                cmd.sortOrder(),
                "A",
                userId,
                userId,
                null,
                null
        );

        Long id = navigationRepository.insert(record);
        auditLogService.logChange(
                "md_navigation_items",
                String.valueOf(id),
                "I",
                List.of("code", "title", "url", "target_type"),
                null,
                Map.of("code", code, "title", record.title(), "url", record.url(), "target_type", record.targetType())
        );

        return getItemById(id).orElseThrow();
    }

    @Transactional
    @CacheEvict(value = "navigationItems", allEntries = true)
    public NavigationItemView updateItem(Long id, UpdateNavigationItemCommand cmd, Long userId) {
        NavigationItemRecord existing = navigationRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Пункт навигации не найден: " + id));

        validateUrl(cmd.url());
        String code = cmd.code().trim().toLowerCase().replaceAll("[^a-z0-9_-]", "-");

        Optional<NavigationItemRecord> withSameCode = navigationRepository.findByCode(code);
        if (withSameCode.isPresent() && !withSameCode.get().id().equals(id)) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "Пункт навигации с таким кодом уже существует: " + code);
        }

        NavigationItemRecord updated = new NavigationItemRecord(
                id,
                code,
                cmd.title().trim(),
                cmd.titleKey() != null && !cmd.titleKey().isBlank() ? cmd.titleKey().trim() : null,
                cmd.sectionId() != null && !cmd.sectionId().isBlank() ? cmd.sectionId().trim() : "custom",
                cmd.parentId(),
                cmd.icon() != null && !cmd.icon().isBlank() ? cmd.icon().trim() : "bar_chart",
                cmd.targetType() != null && !cmd.targetType().isBlank() ? cmd.targetType().trim() : "EMBEDDED_IFRAME",
                cmd.url().trim(),
                cmd.openInIframe(),
                cmd.requiredPermission() != null && !cmd.requiredPermission().isBlank() ? cmd.requiredPermission().trim() : null,
                cmd.sortOrder(),
                cmd.state() != null ? cmd.state() : existing.state(),
                existing.createdBy(),
                userId,
                existing.createdAt(),
                null
        );

        navigationRepository.update(id, updated);
        auditLogService.logChange(
                "md_navigation_items",
                String.valueOf(id),
                "U",
                List.of("code", "title", "url", "target_type", "state"),
                Map.of("code", existing.code(), "title", existing.title(), "url", existing.url(), "target_type", existing.targetType(), "state", existing.state()),
                Map.of("code", updated.code(), "title", updated.title(), "url", updated.url(), "target_type", updated.targetType(), "state", updated.state())
        );

        return getItemById(id).orElseThrow();
    }

    @Transactional
    @CacheEvict(value = "navigationItems", allEntries = true)
    public NavigationItemView toggleState(Long id, Long userId) {
        NavigationItemRecord existing = navigationRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Пункт навигации не найден: " + id));

        String newState = "A".equals(existing.state()) ? "P" : "A";
        navigationRepository.updateState(id, newState, userId);

        auditLogService.logChange(
                "md_navigation_items",
                String.valueOf(id),
                "U",
                List.of("state"),
                Map.of("state", existing.state()),
                Map.of("state", newState)
        );

        return getItemById(id).orElseThrow();
    }

    @Transactional
    @CacheEvict(value = "navigationItems", allEntries = true)
    public void deleteItem(Long id, Long userId) {
        NavigationItemRecord existing = navigationRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound(ErrorCode.NOT_FOUND, "Пункт навигации не найден: " + id));

        navigationRepository.delete(id);
        auditLogService.logChange(
                "md_navigation_items",
                String.valueOf(id),
                "D",
                List.of("code"),
                Map.of("code", existing.code()),
                null
        );
    }

    private void validateUrl(String url) {
        if (url == null || url.isBlank()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "URL пункта навигации не может быть пустым");
        }
        String trimmed = url.trim();
        if (DANGEROUS_SCHEME.matcher(trimmed).matches()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Недопустимый или опасный протокол в URL");
        }
        if (!SAFE_URL_PATTERN.matcher(trimmed).matches()) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "URL должен начинаться с http://, https:// или /");
        }
    }
}
