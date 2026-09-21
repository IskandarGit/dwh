package com.greenwhite.dwh.instance.md.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.repository.MdCustomFieldRepository;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;

@Service
public class MdCustomFieldService {

    private static final Set<String> RESERVED_CODES = Set.of(
            "id", "code", "name", "title", "state", "status", "created_at", "modified_at",
            "created_by", "modified_by", "login", "email", "password", "task_type", "priority",
            "description", "attributes", "options", "values"
    );

    private static final Set<String> VALID_FIELD_TYPES = Set.of(
            "string", "number", "boolean", "date", "select", "user_ref"
    );

    private final MdCustomFieldRepository customFieldRepository;
    private final AuditLogService auditLogService;
    private final ObjectMapper objectMapper;
    private final MdUserRepository userRepository;
    private final ObjectProvider<MdCustomFieldService> selfProvider;

    @Autowired
    public MdCustomFieldService(MdCustomFieldRepository customFieldRepository,
                                AuditLogService auditLogService,
                                ObjectMapper objectMapper,
                                MdUserRepository userRepository,
                                @Lazy ObjectProvider<MdCustomFieldService> selfProvider) {
        this.customFieldRepository = customFieldRepository;
        this.auditLogService = auditLogService;
        this.objectMapper = objectMapper != null ? objectMapper : new ObjectMapper();
        this.userRepository = userRepository;
        this.selfProvider = selfProvider;
    }

    public MdCustomFieldService(MdCustomFieldRepository customFieldRepository,
                                AuditLogService auditLogService,
                                ObjectMapper objectMapper,
                                MdUserRepository userRepository) {
        this(customFieldRepository, auditLogService, objectMapper, userRepository, null);
    }

    public MdCustomFieldService(MdCustomFieldRepository customFieldRepository,
                                AuditLogService auditLogService) {
        this(customFieldRepository, auditLogService, new ObjectMapper(), null, null);
    }

    private MdCustomFieldService getSelf() {
        return selfProvider != null && selfProvider.getIfAvailable() != null ? selfProvider.getIfAvailable() : this;
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "customFields", key = "#entityType != null ? #entityType.toLowerCase() : 'all'")
    public List<MdCustomFieldRepository.CustomFieldRecord> getFields(String entityType) {
        if (entityType == null || entityType.isBlank() || entityType.equalsIgnoreCase("ALL")) {
            return customFieldRepository.findAll();
        }
        return customFieldRepository.findByEntityType(entityType);
    }

    @Transactional
    @CacheEvict(value = "customFields", allEntries = true)
    public MdCustomFieldRepository.CustomFieldRecord createField(
            String entityType, String code, String name, String fieldType,
            boolean isRequired, String defaultValue, Object options, int orderNo) {

        if (entityType == null || !entityType.trim().toUpperCase().matches("^[A-Z][A-Z0-9_]{1,31}$")) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Тип сущности должен содержать от 2 до 32 символов (заглавные латинские буквы, цифры, знак подчеркивания)");
        }

        String normalizedCode = (code != null ? code.trim().toLowerCase() : "");
        if (!normalizedCode.matches("^[a-z][a-z0-9_]{1,63}$")) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Код поля должен начинаться с буквы и содержать только латинские буквы в нижнем регистре, цифры и символ подчеркивания (2-64 символа)");
        }

        if (RESERVED_CODES.contains(normalizedCode)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Код '" + normalizedCode + "' зарезервирован системой и не может использоваться для динамического поля");
        }

        String normalizedFieldType = (fieldType != null ? fieldType.trim().toLowerCase() : "");
        if (!VALID_FIELD_TYPES.contains(normalizedFieldType)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Недопустимый тип поля: " + fieldType + ". Допустимые типы: " + String.join(", ", VALID_FIELD_TYPES));
        }

        if (customFieldRepository.findByCode(entityType, normalizedCode).isPresent()) {
            throw ApiException.conflict(ErrorCode.CODE_ALREADY_EXISTS, "Поле с таким кодом уже существует для сущности " + entityType);
        }

        var field = customFieldRepository.create(entityType, normalizedCode, name, normalizedFieldType, isRequired, defaultValue, options, orderNo);

        // Поле меняет форму данных всех записей сущности — операция уровня схемы,
        // и она обязана быть в журнале (FR-AUD-1).
        auditLogService.logChange("md_custom_fields", String.valueOf(field.id()), "I",
                List.of("entity_type", "code", "name", "field_type", "is_required"),
                null,
                Map.of("entity_type", entityType, "code", normalizedCode, "name", name,
                        "field_type", normalizedFieldType, "is_required", isRequired));

        return field;
    }

    @Transactional
    @CacheEvict(value = "customFields", allEntries = true)
    public void updateField(Long id, String name, Boolean isRequired, String defaultValue, Object options, Integer orderNo) {
        var before = requireField(id);
        customFieldRepository.update(id, name, isRequired, defaultValue, options, orderNo);

        auditLogService.logChange("md_custom_fields", String.valueOf(id), "U",
                List.of("name", "is_required", "default_value", "order_no"),
                Map.of("name", before.name(), "is_required", before.isRequired()),
                Map.of("name", name != null ? name : before.name(),
                        "is_required", isRequired != null ? isRequired : before.isRequired()));
    }

    @Transactional
    @CacheEvict(value = "customFields", allEntries = true)
    public void deleteField(Long id) {
        var before = requireField(id);
        customFieldRepository.delete(id);

        auditLogService.logChange("md_custom_fields", String.valueOf(id), "D",
                List.of("entity_type", "code", "name"),
                Map.of("entity_type", before.entityType(), "code", before.code(), "name", before.name()),
                null);
    }

    private MdCustomFieldRepository.CustomFieldRecord requireField(Long id) {
        return customFieldRepository.findById(id).orElseThrow(() ->
                ApiException.notFound(ErrorCode.NOT_FOUND, "Динамическое поле не найдено"));
    }

    /**
     * Dynamic Attribute Validation against schema definitions in md_custom_fields.
     */
    public void validateAttributes(String entityType, Map<String, Object> attributes) {
        List<MdCustomFieldRepository.CustomFieldRecord> fieldDefs = getSelf().getFields(entityType);
        if (fieldDefs.isEmpty()) {
            return;
        }

        Map<String, Object> safeAttrs = attributes != null ? attributes : Map.of();
        List<FieldErrorItem> errors = new ArrayList<>();

        for (var field : fieldDefs) {
            Object value = safeAttrs.get(field.code());

            if (field.isRequired() && (value == null || value.toString().trim().isEmpty())) {
                errors.add(new FieldErrorItem("attributes." + field.code(), "required", "Поле " + field.name() + " обязательно для заполнения"));
                continue;
            }

            if (value != null) {
                switch (field.fieldType().toLowerCase()) {
                    case "string" -> {
                        if (value.toString().length() > 4000) {
                            errors.add(new FieldErrorItem("attributes." + field.code(), "too_long", "Значение поля " + field.name() + " не должно превышать 4000 символов"));
                        }
                    }
                    case "number" -> {
                        if (!(value instanceof Number)) {
                            try {
                                Double.parseDouble(value.toString());
                            } catch (NumberFormatException e) {
                                errors.add(new FieldErrorItem("attributes." + field.code(), "invalid_number", "Поле " + field.name() + " должно быть числом"));
                            }
                        }
                    }
                    case "boolean" -> {
                        if (!(value instanceof Boolean) && !value.toString().equalsIgnoreCase("true") && !value.toString().equalsIgnoreCase("false")) {
                            errors.add(new FieldErrorItem("attributes." + field.code(), "invalid_boolean", "Поле " + field.name() + " должно быть булевым"));
                        }
                    }
                    case "date" -> {
                        try {
                            LocalDate.parse(value.toString());
                        } catch (DateTimeParseException e) {
                            errors.add(new FieldErrorItem("attributes." + field.code(), "invalid_date", "Поле " + field.name() + " должно содержать корректную дату"));
                        }
                    }
                    case "select" -> {
                        List<String> allowedOptions = parseSelectOptions(field.optionsJson());
                        String valStr = value.toString();
                        if (!allowedOptions.isEmpty() && !allowedOptions.contains(valStr)) {
                            errors.add(new FieldErrorItem("attributes." + field.code(), "invalid_option", "Значение поля " + field.name() + " должно быть одним из вариантов: " + String.join(", ", allowedOptions)));
                        }
                    }
                    case "user_ref" -> {
                        Long userId = null;
                        if (value instanceof Number n) {
                            userId = n.longValue();
                        } else {
                            try {
                                userId = Long.parseLong(value.toString().trim());
                            } catch (NumberFormatException e) {
                                errors.add(new FieldErrorItem("attributes." + field.code(), "invalid_user_ref", "Поле " + field.name() + " должно содержать числовой ID пользователя"));
                            }
                        }
                        if (userId != null && userRepository != null) {
                            var userOpt = userRepository.findById(userId);
                            if (userOpt.isEmpty() || !"A".equals(userOpt.get().state())) {
                                errors.add(new FieldErrorItem("attributes." + field.code(), "user_not_found", "Пользователь с ID " + userId + " не найден или неактивен"));
                            }
                        }
                    }
                }
            }
        }

        if (!errors.isEmpty()) {
            throw ApiException.validation("Ошибка валидации динамических атрибутов", errors);
        }
    }

    public List<String> parseSelectOptions(String optionsJson) {
        if (optionsJson == null || optionsJson.isBlank()) {
            return List.of();
        }
        try {
            JsonNode root = objectMapper.readTree(optionsJson);
            if (!root.isArray()) return List.of();
            List<String> result = new ArrayList<>();
            for (JsonNode node : root) {
                if (node.isTextual() || node.isNumber() || node.isBoolean()) {
                    result.add(node.asText());
                } else if (node.isObject() && node.has("value")) {
                    result.add(node.get("value").asText());
                }
            }
            return result;
        } catch (Exception e) {
            return List.of();
        }
    }
}
